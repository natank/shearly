import pg from 'pg';
import { loadConfig, type AppConfig } from '@shearly/shared-config';
import { createSmtpMailer, IdentityService, type SendMail } from '@shearly/services-identity';

export type AppServices = {
  config: AppConfig;
  identity: IdentityService;
  pool: pg.Pool;
};

export function compose(source?: NodeJS.ProcessEnv, sendMail?: SendMail): AppServices {
  const config = loadConfig(source);
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  return {
    config,
    pool,
    identity: new IdentityService(pool, config, sendMail ?? createSmtpMailer(config.smtpUrl)),
  };
}
