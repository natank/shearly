import pg from 'pg';
import { loadConfig, type AppConfig } from '@shearly/shared-config';
import { createSmtpMailer, IdentityService, type SendMail } from '@shearly/services-identity';
import { CatalogService, FsDocumentStore } from '@shearly/services-provider-catalog';
import { AvailabilityService } from '@shearly/services-availability';

export type AppServices = {
  config: AppConfig;
  identity: IdentityService;
  catalog: CatalogService;
  availability: AvailabilityService;
  pool: pg.Pool;
};

export function compose(source?: NodeJS.ProcessEnv, sendMail?: SendMail): AppServices {
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
    ),
    availability: new AvailabilityService(pool),
  };
}
