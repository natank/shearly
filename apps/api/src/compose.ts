import pg from 'pg';
import { loadConfig, type AppConfig } from '@shearly/shared-config';
import { createSmtpMailer, IdentityService, type SendMail } from '@shearly/services-identity';
import { CatalogService, FsDocumentStore } from '@shearly/services-provider-catalog';
import { AvailabilityService } from '@shearly/services-availability';
import { AuthorizationService, ConnectService, LedgerService } from '@shearly/services-payments';
import { BookingService } from '@shearly/services-booking';
import { DeterministicRanker, StubRanker, type ProviderRanker } from '@shearly/domain-ranking';
import {
  createSmtpEmailChannel,
  NotificationService,
  type NotificationChannel,
} from '@shearly/services-notifications';

export type AppServices = {
  config: AppConfig;
  identity: IdentityService;
  catalog: CatalogService;
  availability: AvailabilityService;
  payments: ConnectService;
  authorizations: AuthorizationService;
  ledger: LedgerService;
  booking: BookingService;
  notifications: NotificationService;
  ranker: ProviderRanker;
  pool: pg.Pool;
};

export function createRanker(config: AppConfig): ProviderRanker {
  if (config.rankingImpl === 'stub') {
    return new StubRanker();
  }
  return new DeterministicRanker({
    distance: config.rankWeightDistance,
    availability: config.rankWeightAvailability,
    rating: config.rankWeightRating,
    completions: config.rankWeightCompletions,
    newProviderReviewThreshold: config.newProviderReviewThreshold,
  });
}

export type ComposeOverrides = {
  /** Test-only: inject a fake Stripe client so saga tests don't need live Stripe test-mode credentials. */
  stripeClient?: import('stripe').default;
  /** Test-only: inject a fake notification channel so tests can assert without real SMTP. */
  notificationChannel?: NotificationChannel;
};

export function compose(
  source?: NodeJS.ProcessEnv,
  sendMail?: SendMail,
  overrides?: ComposeOverrides,
): AppServices {
  const config = loadConfig(source);
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  return {
    config,
    pool,
    identity: new IdentityService(pool, config, sendMail ?? createSmtpMailer(config.smtpUrl)),
    catalog: new CatalogService(
      pool,
      new FsDocumentStore(config.documentStoreDir),
      config.radiusCapKm,
      config.commissionRate,
      sendMail ?? createSmtpMailer(config.smtpUrl),
    ),
    availability: new AvailabilityService(pool, config.discoveryWindowDays),
    payments: new ConnectService(pool, config.payoutCadenceDays),
    authorizations: new AuthorizationService(
      pool,
      overrides?.stripeClient ?? config.stripeSecretKey,
      config.authHorizonDays,
    ),
    ledger: new LedgerService(pool, config.commissionRate),
    booking: new BookingService(pool),
    notifications: new NotificationService(
      pool,
      overrides?.notificationChannel ?? createSmtpEmailChannel(config.smtpUrl),
    ),
    ranker: createRanker(config),
  };
}
