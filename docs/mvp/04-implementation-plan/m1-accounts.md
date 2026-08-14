# M1 — Accounts

**Milestone ID:** `M1`  
**Master:** [04-implementation-plan.md](./04-implementation-plan.md) — §4 M1, §5 CUS-002/003/004 + PRV-001  
**Design:** `docs/mvp/03-design.md` §2.2 (write-ownership), §6.2 (schema-per-service), §6.5 (errors), §6.7 (sessions, roles, rate limit, enumeration, guest draft), §9.1 (migrate), NFR-SEC-007 cookies  
**Requirements:** CUS-002, CUS-003, CUS-004 (`P1`), PRV-001. NFRs below.  
**Depends on:** M0 complete  
**Unlocks:** M2–M5 authenticated work  
**Status:** Accepted (auto-approved after M0 cadence)  
**Implementation:** not started — this file is the go-ahead for `m1/*` only

---

## 1. Traceability

This file may not add, drop, or move stories. The master map is the source of truth.

| Master claim | This plan |
|---|---|
| Goal: identity is a real security perimeter | §2 |
| Builds: identity service + contract; sessions; register / sign-in / sign-out / reset; rate limit; anti-enumeration; guest-draft cookie; provider vs customer landing | PRs `M1-P1`…`M1-P6` |
| Stories: CUS-002, CUS-003, CUS-004, PRV-001 | §1 table |
| NFRs: SEC-003, SEC-004, SEC-007, SEC-008 on routes that exist | §1 table |
| Exit: two roles on two accounts; cannot be both; reset kills all sessions; failed login does not reveal the email | §6 |
| Not in M1: address book, admin vetting queue, booking draft restore | §7 |

| ID | Pri | Coverage in M1 | Notes |
|---|---|---|---|
| CUS-002 | P0 | register + session + locale captured | Duplicate email uses the same client shape as success-path messaging for unauthenticated observers (NFR-SEC-004). The *authenticated* owner of that email may see “account exists” after they sign in; the public POST does not. |
| CUS-003 | P0 | sign-in, sign-out, generic failure, rate limit | Logout deletes the session row |
| CUS-004 | P1 | request + confirm reset | Token single-use; all sessions deleted |
| PRV-001 | P0 | `role=provider` at register; provider landing | Vetting `DRAFT` is a column default here; the vetting *queue* is M2 |
| NFR-SEC-003 | P0 | in-module counter on register, sign-in, reset | Hole named if `desiredCount` > 1 |
| NFR-SEC-004 | P0 | identical client JSON for exist / not-exist | Timing: dummy hash verify on miss |
| NFR-SEC-007 | P1 | `Secure` (prod), `HttpOnly`, `SameSite=Lax` | Opaque session id; not a JWT |
| NFR-SEC-008 | P1 | `/me` and any `:id` route deny cross-tenant | Few routes exist; test what exists |
| NFR-I18N-004 | P0 | `accounts.locale` written from UI locale | Switcher still URL-first; persist on register / sign-in / explicit save |

CUS-002’s “told the account exists and offered sign-in” is **not** a public oracle. Public responses stay enumeration-safe. After a successful sign-in to that email, the account page may offer the other role’s join path as a *separate account* (PRV-001).

---

## 2. Goal and demo

**Goal.** Identity is a real security perimeter: sessions, not JWTs; cookies per NFR-SEC-007; one role per account.

**Demo at exit.** In Hebrew: register a customer, sign out, sign in, see the customer surface. In a second browser profile: register a provider with a different email, land on the provider surface. Attempt to attach the other role to the first account — rejected. Request a password reset (Mailpit shows the link), set a new password, previous session is dead. A wrong password and an unknown email produce the same message.

---

## 3. PR sequence

Branch per PR: `m1/{slug}` off `main`. One concern per PR. Cite `M1-P#` and story / NFR ids. Merge only when gates 1–8 are green on that PR.

```
M1-P1 schema + migrate
    │
    ▼
M1-P2 register / sign-in / sign-out + cookies + rate + enum
    │
    ▼
M1-P3 password reset
    │
    ▼
M1-P4 guest-draft cookie (write only)
    │
    ▼
M1-P5 account UI + role landing + i18n
    │
    ▼
M1-P6 E2E both locales + SEC-008
```

Nothing is parallel. Each PR must leave CI green (including the M0 locale smoke).

### M1-P1 — Identity schema and migrate

**Does**
- SQL migrations owned by `libs/services/identity` (schema `identity` only).
- Tables:

| Table | Purpose |
|---|---|
| `identity.accounts` | `id`, unique email (citext), password hash, `role` (`customer` \| `provider` \| `admin`), `locale` (`en` \| `he`), `provider_vetting_status` (`draft` for providers, null otherwise), timestamps |
| `identity.sessions` | `id`, `account_id`, `token_hash`, `expires_at`, `created_at` |
| `identity.password_reset_tokens` | `id`, `account_id`, `token_hash`, `expires_at`, `used_at` |
| `identity.auth_rate_limits` | key (ip + action), `window_started_at`, `count` |
| `identity.guest_drafts` | optional server copy; cookie is the source of truth in M1 |

- `pnpm nx run api:migrate` applies pending files in order. Integration CI runs migrate before the existing Postgres smoke.
- README local steps include migrate (design §9.1).
- Config: no new required secrets yet. `SESSION_TTL_HOURS` (default 24), `PASSWORD_MIN_LENGTH` (default 10), `AUTH_RATE_LIMIT_MAX` (default 10), `AUTH_RATE_LIMIT_WINDOW_SEC` (default 60) added to Zod schema with defaults so `.env.example` stays complete.

**Files.** `libs/services/identity/migrations/**`, migrate target on `apps/api`, `libs/shared/config` defaults, README.

**Tests.** Integration: migrate is idempotent; schema `identity` exists; grants are not required until a dedicated DB user exists (single `shearly` user locally — document as a named hole, same class as the rate-limit/Redis hole).

**Out.** HTTP. Hashing. UI.

### M1-P2 — Register, sign-in, sign-out

**Does**
- Replace the identity stub with a real service. Web/admin still must not import it (`type:app-web` → `type:service` remains illegal).
- `libs/contracts/identity`: Zod for register, sign-in, session public DTO (`id`, `role`, `locale`, `email`). No password, no hash.
- Password: Node `scrypt` (no extra native dep). Policy: length ≥ `PASSWORD_MIN_LENGTH`; fail with `ValidationError` + `translationKey` listing the unmet rule (`errors.passwordTooShort`).
- Session: opaque 32-byte id; store **SHA-256** of the id; cookie value is the raw id. Flags: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` iff `nodeEnv === 'production'`. Cookie name from config (`SESSION_COOKIE_NAME`, default `shearly_session`).
- Logout deletes that session row and clears the cookie.
- Rate limit: `identity.auth_rate_limits` on register, sign-in. Exceed → `429` + `errors.rateLimited`. Same limit applies to reset in P3.
- Enumeration: sign-in with unknown email still runs a dummy verify. Response body `{ ok: false, translationKey: 'auth.invalidCredentials' }` is **byte-identical** to a wrong password. Register of an existing email returns `{ ok: true, translationKey: 'auth.registerAccepted' }` — the same shape as a new account — and **does not** set a session for the existing account. New accounts set a session. (Test: two responses to “email already used” vs “fresh email” may differ *only* in `Set-Cookie` presence; JSON `ok`/`translationKey` match. The UI always says “check your email / you can sign in” using that one key.)
- Roles: register accepts `customer` \| `provider` only. One role column; no second role. Provider rows get `provider_vetting_status = 'draft'`.
- Locale: taken from request body (UI locale), persisted.
- `apps/api` composition root constructs `IdentityService`. Routes:
  - `POST /auth/register`
  - `POST /auth/sign-in`
  - `POST /auth/sign-out`
  - `GET /me` (401 if no/invalid session)
- Same-origin cookies: `apps/web` and `apps/admin` **rewrite** `/api/*` → `apps/api` so the browser talks to `:3000` / `:4300` only. Hono mounts routes at `/` **and** `/api` (or strips the prefix) so the rewrite works.
- CORS is not the cookie plan. Do not set `Access-Control-Allow-Origin: *` with credentials.

**Files.** `libs/services/identity/**`, `libs/contracts/identity/**`, `apps/api/src/**`, Next `rewrites` in web + admin, `.env.example`.

**Tests.**
- Unit: password policy; dummy verify on unknown email; one role.
- Integration (real Postgres): register → `GET /me`; wrong password vs unknown email same JSON; second register same email no new row; sign-out deletes session; `GET /me` 401 after logout; rate limit trips; `type:app-web` still cannot import the service (existing architecture fixture).

**Out.** Reset. Guest draft. Feature screens.

### M1-P3 — Password reset

**Does**
- `POST /auth/password-reset/request` `{ email }` — always `{ ok: true, translationKey: 'auth.resetRequested' }`. If the account exists, insert a hashed token (1h TTL) and send mail via `SMTP_URL` (Mailpit locally). If not, no mail.
- Mail body: absolute URL to `/{locale}/reset-password?token=...` (web origin from config `WEB_ORIGIN`, default `http://localhost:3000`). Token in the query is the **raw** token, stored hashed.
- `POST /auth/password-reset/confirm` `{ token, password }` — policy check; set hash; `used_at`; **delete all sessions** for that account; do not auto sign-in (user signs in with the new password).
- Expired / used / unknown token → `ValidationError` `auth.resetInvalid` (same key for all three).
- Rate-limit the request endpoint.

**Files.** identity service + contract, a tiny SMTP sender inside identity (not `libs/services/notifications` — that service is M5). No SES.

**Tests.** Integration: request unknown email → no row, same JSON; request known email → Mailpit or captured transport has one message; confirm rotates password; old session 401; token reuse fails.

**Out.** Full notification templates / i18n email HTML (plain text is enough). SES.

### M1-P4 — Guest-draft cookie (write)

**Does**
- `POST /auth/guest-draft` body: `{ slotId?, providerId?, addressLabel? }` (loose; booking will tighten in M4). Signed payload (`HMAC-SHA256` with `GUEST_DRAFT_SECRET`, default a dev string in `.env.example`). Cookie: `shearly_guest_draft`, `HttpOnly`, `SameSite=Lax`, `Secure` in prod, TTL 2h.
- `GET /auth/guest-draft` returns the payload if valid, else empty. **No** restore onto a booking (M4).
- Signing key in `libs/shared/config`.

**Tests.** Unit: tampered cookie rejected. Integration: set then get.

**Out.** Mid-flow auth restore.

### M1-P5 — Account UI and role landing

**Does**
- `libs/ui/feature-account`: register, sign-in, sign-out, request-reset, confirm-reset forms. All strings in `libs/ui/i18n` (`account` namespace). Design-system `Button` + tokens only. No hex, no physical CSS.
- `apps/web` routes (locale prefix): `/register`, `/sign-in`, `/reset-password`, `/account` (customer home), `/provider` (provider home).
- After customer register/sign-in → `/{locale}/account`. After provider → `/{locale}/provider`. Wrong-role visit to the other home redirects to the right one.
- Shell: sign-in / register links when anonymous; email + sign-out when authenticated.
- `apps/admin`: sign-in only (admin role). Non-admin session → sign-out + error `auth.adminOnly`. No admin self-register. Seed one admin in migrate (`admin@shearly.local` / password from `ADMIN_SEED_PASSWORD`, default `change-me-admin-10`) so the surface is demoable. Seed is skipped if the email exists.
- Register form: role toggle customer | provider; password policy shown before submit (client) and enforced again in identity.
- Duplicate-email public copy uses `auth.registerAccepted` (same as success).

**Files.** `libs/ui/feature-account/**`, `libs/ui/i18n/**/{en,he}/account.json`, `apps/web/app/[locale]/**`, `apps/admin/**`, design-system `Input` if missing.

**Tests.** Unit: role → path helper. i18n/RTL scripts still pass. Typecheck. No service import from feature-account.

**Out.** Address book. Vetting docs. Discovery.

### M1-P6 — E2E and SEC-008

**Does**
- Playwright, both locales (extend `apps/web-e2e`, keep the M0 smoke):
  1. Register customer in `he` → `/he/account`, sign out, sign in.
  2. Register provider in `en` → `/en/provider`.
  3. Reset password (read token from Mailpit API `http://localhost:8025` when Compose is up; in CI start Mailpit or assert via API test already in P3 and keep E2E to UI + API confirm).
  4. Invalid sign-in copy is the generic key, not “unknown email”.
- SEC-008: integration test — session A cannot `GET /me` as session B; if any `/accounts/:id` exists it 403/404s for the other id.
- CI: start Mailpit **or** keep reset E2E hitting the API confirm with a token created in a setup request. Prefer API setup so CI does not need Mailpit. Compose Mailpit remains for the human demo.

**Files.** `apps/web-e2e/**`, identity integration tests.

**Out.** Booking-path E2E (M4).

---

## 4. Layout at M1 exit

M0 layout, plus:

```
libs/services/identity/src/          # real
libs/services/identity/migrations/
libs/contracts/identity/src/         # Zod
libs/ui/feature-account/src/         # forms
libs/ui/i18n/src/messages/{en,he}/account.json
apps/api/src/migrate.ts
apps/web/app/[locale]/{register,sign-in,reset-password,account,provider}/
```

---

## 5. Local at M1 exit

```bash
pnpm install
cp -n .env.example .env
docker compose up -d
pnpm nx run api:migrate
pnpm nx run-many -t serve -p web,api,admin
```

- web: `/en/register`, `/he/register`, `/en/sign-in`, `/en/account`, `/en/provider`
- admin: `/en` sign-in (seed admin)
- api: `/health`, `/auth/*`, `/me`
- Mailpit: `http://localhost:8025` for reset mail

---

## 6. Exit checklist

- [ ] Customer account can be created, signed in, signed out (CUS-002/003)
- [ ] Provider account on a **second** email lands on the provider surface (PRV-001)
- [ ] An account cannot hold both roles
- [ ] Password reset invalidates every session (CUS-004)
- [ ] Failed sign-in / reset-request JSON does not reveal whether the email exists (NFR-SEC-004)
- [ ] Auth endpoints rate-limit (NFR-SEC-003)
- [ ] Session cookie is HttpOnly + SameSite=Lax; Secure in production (NFR-SEC-007)
- [ ] `GET /me` is the caller only (NFR-SEC-008)
- [ ] Locale stored on the account from the UI locale (NFR-I18N-004)
- [ ] Guest-draft cookie can be written and read back; booking does not consume it
- [ ] `/he` and `/en` auth flows work; M0 smoke still passes
- [ ] CI 1–8 green on every M1 PR; no `type:app-web` → `type:service` import
- [ ] No identity tables outside schema `identity`; no JWT

Master demo: “Register, sign in/out, reset; customer vs provider land on different surfaces.”

---

## 7. Explicitly not M1

| Item | Belongs |
|---|---|
| Address book, out-of-area (CUS-005) | M3 |
| Admin vetting queue, ID docs (OPS-001, PRV-002+) | M2 |
| Booking draft restore after mid-flow auth | M4 |
| Notifications service, SES, outbox | M5 |
| Discovery, slots, ranking | M3 |
| Stripe / Connect | M2 (PAY-005) / M4 |
| Dedicated per-schema DB users | named hole; same `shearly` role locally |

Do not implement booking or catalog “just because” the session exists.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| CUS-002 vs NFR-SEC-004 fight | Public JSON never enumerates; see §1 note |
| Cookie not sent (split ports) | Next rewrite `/api` → api process; no CORS cookie plan |
| Reset mail blocks M1 on SES | SMTP to Mailpit; identity-local sender; notifications stay M5 |
| Coverage on new identity code | 80% service threshold already in Vitest; do not drop it |

---

## 9. Open on M1

| # | Question | Default if unanswered |
|---|---|---|
| **M1-Q1** | Public register of an existing email: identical `ok: true` or identical `ok: false`? | `ok: true` + `auth.registerAccepted` for both new and existing (session only on new). Matches “do not confirm registration status to an unauthenticated party.” |
| **M1-Q2** | Auto sign-in after reset confirm? | No. Sign-in is a separate step so session invalidation is observable. |
| **M1-Q3** | Admin seed in migrate? | Yes, local/dev only when `ADMIN_SEED_PASSWORD` is set (`.env.example` has the default). |

None changes the master cuts.

---

## 10. Next

This plan is accepted. Implement `M1-P1`…`M1-P6` in order, CI green on each merge. After M1 exit, write [`m2-supply.md`](./m2-supply.md). Do not write M2–M5 plans during M1 implementation.
