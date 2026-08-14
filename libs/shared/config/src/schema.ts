import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  GEOCODER_URL: z.string().url(),
  SMTP_URL: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  CURRENCY: z.string().min(1).default('ILS'),
  RADIUS_CAP_KM: z.coerce.number().positive().default(15),
  COMMISSION_RATE: z.coerce.number().min(0).max(1).default(0.2),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(24),
  SESSION_COOKIE_NAME: z.string().min(1).default('shearly_session'),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  RESET_TOKEN_TTL_HOURS: z.coerce.number().positive().default(1),
});

export type Env = z.infer<typeof envSchema>;

export type AppConfig = {
  nodeEnv: Env['NODE_ENV'];
  apiPort: number;
  databaseUrl: string;
  geocoderUrl: string;
  smtpUrl: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  currency: string;
  radiusCapKm: number;
  commissionRate: number;
  sessionTtlHours: number;
  sessionCookieName: string;
  passwordMinLength: number;
  authRateLimitMax: number;
  authRateLimitWindowSec: number;
  webOrigin: string;
  resetTokenTtlHours: number;
};

export function toAppConfig(env: Env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    apiPort: env.API_PORT,
    databaseUrl: env.DATABASE_URL,
    geocoderUrl: env.GEOCODER_URL,
    smtpUrl: env.SMTP_URL,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    currency: env.CURRENCY,
    radiusCapKm: env.RADIUS_CAP_KM,
    commissionRate: env.COMMISSION_RATE,
    sessionTtlHours: env.SESSION_TTL_HOURS,
    sessionCookieName: env.SESSION_COOKIE_NAME,
    passwordMinLength: env.PASSWORD_MIN_LENGTH,
    authRateLimitMax: env.AUTH_RATE_LIMIT_MAX,
    authRateLimitWindowSec: env.AUTH_RATE_LIMIT_WINDOW_SEC,
    webOrigin: env.WEB_ORIGIN,
    resetTokenTtlHours: env.RESET_TOKEN_TTL_HOURS,
  };
}
