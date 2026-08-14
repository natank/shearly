import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { AppError, ValidationError } from '@shearly/shared-errors';
import type { Locale, PublicAccount, RegisterRole } from '@shearly/contracts-identity';
import type { AppConfig } from '@shearly/shared-config';
import type { SendMail } from './mailer.js';
import { assertPasswordPolicy, dummyVerify, hashPassword, verifyPassword } from './password.js';

export type IdentityConfig = Pick<
  AppConfig,
  | 'passwordMinLength'
  | 'sessionTtlHours'
  | 'authRateLimitMax'
  | 'authRateLimitWindowSec'
  | 'webOrigin'
  | 'resetTokenTtlHours'
>;

type AccountRow = {
  id: string;
  email: string;
  password_hash: string;
  role: PublicAccount['role'];
  locale: Locale;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toPublic(row: Pick<AccountRow, 'id' | 'email' | 'role' | 'locale'>): PublicAccount {
  return { id: row.id, email: row.email, role: row.role, locale: row.locale };
}

export class IdentityService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: IdentityConfig,
    private readonly sendMail: SendMail = async () => undefined,
  ) {}

  async register(input: {
    email: string;
    password: string;
    role: RegisterRole;
    locale: Locale;
    ip: string;
  }): Promise<{ sessionToken: string | null }> {
    await this.enforceRateLimit('register', input.ip);
    try {
      assertPasswordPolicy(input.password, this.config.passwordMinLength);
    } catch {
      throw new ValidationError('errors.passwordTooShort');
    }

    const existing = await this.findByEmail(input.email);
    if (existing) {
      await dummyVerify(input.password);
      return { sessionToken: null };
    }

    const passwordHash = await hashPassword(input.password);
    const vetting = input.role === 'provider' ? 'draft' : null;
    try {
      const inserted = await this.pool.query<AccountRow>(
        `INSERT INTO identity.accounts (email, password_hash, role, locale, provider_vetting_status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, password_hash, role, locale`,
        [input.email.trim(), passwordHash, input.role, input.locale, vetting],
      );
      const account = inserted.rows[0];
      const sessionToken = await this.createSession(account.id);
      return { sessionToken };
    } catch (error) {
      if (isUniqueViolation(error)) {
        await dummyVerify(input.password);
        return { sessionToken: null };
      }
      throw error;
    }
  }

  async signIn(input: {
    email: string;
    password: string;
    ip: string;
  }): Promise<{ sessionToken: string | null }> {
    await this.enforceRateLimit('sign-in', input.ip);
    const account = await this.findByEmail(input.email);
    if (!account) {
      await dummyVerify(input.password);
      return { sessionToken: null };
    }
    const ok = await verifyPassword(input.password, account.password_hash);
    if (!ok) {
      return { sessionToken: null };
    }
    const sessionToken = await this.createSession(account.id);
    return { sessionToken };
  }

  async signOut(sessionToken: string | undefined): Promise<void> {
    if (!sessionToken) {
      return;
    }
    await this.pool.query('DELETE FROM identity.sessions WHERE token_hash = $1', [
      hashToken(sessionToken),
    ]);
  }

  async requestPasswordReset(input: { email: string; locale: Locale; ip: string }): Promise<void> {
    await this.enforceRateLimit('reset', input.ip);
    const account = await this.findByEmail(input.email);
    if (!account) {
      return;
    }
    const token = randomBytes(32).toString('base64url');
    await this.pool.query(
      `INSERT INTO identity.password_reset_tokens (account_id, token_hash, expires_at)
       VALUES ($1, $2, now() + ($3::text || ' hours')::interval)`,
      [account.id, hashToken(token), String(this.config.resetTokenTtlHours)],
    );
    const resetUrl = `${this.config.webOrigin.replace(/\/$/, '')}/${input.locale}/reset-password?token=${token}`;
    await this.sendMail({
      to: account.email,
      subject: 'Shearly password reset',
      text: `Reset your password: ${resetUrl}`,
    });
  }

  async confirmPasswordReset(input: { token: string; password: string }): Promise<void> {
    try {
      assertPasswordPolicy(input.password, this.config.passwordMinLength);
    } catch {
      throw new ValidationError('errors.passwordTooShort');
    }
    const result = await this.pool.query<{ id: string; account_id: string }>(
      `SELECT id, account_id FROM identity.password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [hashToken(input.token)],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ValidationError('auth.resetInvalid');
    }
    const passwordHash = await hashPassword(input.password);
    await this.pool.query('BEGIN');
    try {
      await this.pool.query(
        `UPDATE identity.accounts SET password_hash = $1, updated_at = now() WHERE id = $2`,
        [passwordHash, row.account_id],
      );
      await this.pool.query(
        `UPDATE identity.password_reset_tokens SET used_at = now() WHERE id = $1`,
        [row.id],
      );
      await this.pool.query('DELETE FROM identity.sessions WHERE account_id = $1', [
        row.account_id,
      ]);
      await this.pool.query('COMMIT');
    } catch (error) {
      await this.pool.query('ROLLBACK');
      throw error;
    }
  }

  async accountFromSession(sessionToken: string | undefined): Promise<PublicAccount | null> {
    if (!sessionToken) {
      return null;
    }
    const result = await this.pool.query<AccountRow>(
      `SELECT a.id, a.email, a.password_hash, a.role, a.locale
       FROM identity.sessions s
       JOIN identity.accounts a ON a.id = s.account_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(sessionToken)],
    );
    const row = result.rows[0];
    return row ? toPublic(row) : null;
  }

  private async findByEmail(email: string): Promise<AccountRow | undefined> {
    const result = await this.pool.query<AccountRow>(
      `SELECT id, email, password_hash, role, locale
       FROM identity.accounts WHERE lower(email) = lower($1)`,
      [email.trim()],
    );
    return result.rows[0];
  }

  private async createSession(accountId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hours = this.config.sessionTtlHours;
    await this.pool.query(
      `INSERT INTO identity.sessions (account_id, token_hash, expires_at)
       VALUES ($1, $2, now() + ($3::text || ' hours')::interval)`,
      [accountId, hashToken(token), String(hours)],
    );
    return token;
  }

  private async enforceRateLimit(action: string, ip: string): Promise<void> {
    const key = `${action}:${ip}`;
    const windowSec = this.config.authRateLimitWindowSec;
    const max = this.config.authRateLimitMax;
    const result = await this.pool.query<{ count: number; window_started_at: Date }>(
      `INSERT INTO identity.auth_rate_limits (key, window_started_at, count)
       VALUES ($1, now(), 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE
           WHEN identity.auth_rate_limits.window_started_at < now() - ($2::text || ' seconds')::interval
           THEN 1
           ELSE identity.auth_rate_limits.count + 1
         END,
         window_started_at = CASE
           WHEN identity.auth_rate_limits.window_started_at < now() - ($2::text || ' seconds')::interval
           THEN now()
           ELSE identity.auth_rate_limits.window_started_at
         END
       RETURNING count, window_started_at`,
      [key, String(windowSec)],
    );
    if ((result.rows[0]?.count ?? 0) > max) {
      throw new AppError('RATE_LIMITED', 'errors.rateLimited', 429);
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
