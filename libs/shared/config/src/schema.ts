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
  GUEST_DRAFT_SECRET: z.string().min(8).default('dev-guest-draft-secret'),
  GUEST_DRAFT_TTL_HOURS: z.coerce.number().positive().default(2),
  GUEST_DRAFT_COOKIE_NAME: z.string().min(1).default('shearly_guest_draft'),
  ADMIN_SEED_EMAIL: z.string().email().default('admin@shearly.local'),
  ADMIN_SEED_PASSWORD: z.string().min(10).default('change-me-admin-10'),
  DOCUMENT_STORE_DIR: z.string().min(1).default('var/private-docs'),
  RANK_WEIGHT_DISTANCE: z.coerce.number().min(0).default(0.4),
  RANK_WEIGHT_AVAILABILITY: z.coerce.number().min(0).default(0.3),
  RANK_WEIGHT_RATING: z.coerce.number().min(0).default(0.2),
  RANK_WEIGHT_COMPLETIONS: z.coerce.number().min(0).default(0.1),
  NEW_PROVIDER_REVIEW_THRESHOLD: z.coerce.number().int().positive().default(3),
  RANKING_IMPL: z.enum(['deterministic', 'stub']).default('deterministic'),
  RANKING_TIMEOUT_MS: z.coerce.number().int().positive().default(200),
  DISCOVERY_WINDOW_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_HORIZON_DAYS: z.coerce.number().positive().default(6),
  BOOKING_RESPONSE_WINDOW_HOURS: z.coerce.number().positive().default(2),
  AUTO_COMPLETE_WINDOW_HOURS: z.coerce.number().positive().default(2),
  CANCEL_FULL_REFUND_HOURS: z.coerce.number().positive().default(12),
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
  guestDraftSecret: string;
  guestDraftTtlHours: number;
  guestDraftCookieName: string;
  adminSeedEmail: string;
  adminSeedPassword: string;
  documentStoreDir: string;
  rankWeightDistance: number;
  rankWeightAvailability: number;
  rankWeightRating: number;
  rankWeightCompletions: number;
  newProviderReviewThreshold: number;
  rankingImpl: 'deterministic' | 'stub';
  rankingTimeoutMs: number;
  discoveryWindowDays: number;
  authHorizonDays: number;
  bookingResponseWindowHours: number;
  autoCompleteWindowHours: number;
  cancelFullRefundHours: number;
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
    guestDraftSecret: env.GUEST_DRAFT_SECRET,
    guestDraftTtlHours: env.GUEST_DRAFT_TTL_HOURS,
    guestDraftCookieName: env.GUEST_DRAFT_COOKIE_NAME,
    adminSeedEmail: env.ADMIN_SEED_EMAIL,
    adminSeedPassword: env.ADMIN_SEED_PASSWORD,
    documentStoreDir: env.DOCUMENT_STORE_DIR,
    rankWeightDistance: env.RANK_WEIGHT_DISTANCE,
    rankWeightAvailability: env.RANK_WEIGHT_AVAILABILITY,
    rankWeightRating: env.RANK_WEIGHT_RATING,
    rankWeightCompletions: env.RANK_WEIGHT_COMPLETIONS,
    newProviderReviewThreshold: env.NEW_PROVIDER_REVIEW_THRESHOLD,
    rankingImpl: env.RANKING_IMPL,
    rankingTimeoutMs: env.RANKING_TIMEOUT_MS,
    discoveryWindowDays: env.DISCOVERY_WINDOW_DAYS,
    authHorizonDays: env.AUTH_HORIZON_DAYS,
    bookingResponseWindowHours: env.BOOKING_RESPONSE_WINDOW_HOURS,
    autoCompleteWindowHours: env.AUTO_COMPLETE_WINDOW_HOURS,
    cancelFullRefundHours: env.CANCEL_FULL_REFUND_HOURS,
  };
}
