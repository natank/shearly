import { loadConfig } from '@shearly/shared-config';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { migrateCatalog } from '@shearly/services-provider-catalog/migrate';
import { migrateAvailability } from '@shearly/services-availability/migrate';
import { migratePayments } from '@shearly/services-payments/migrate';
import { compose } from './compose.js';

const config = loadConfig();
for (const [name, run] of [
  ['identity', migrateIdentity],
  ['catalog', migrateCatalog],
  ['availability', migrateAvailability],
  ['payments', migratePayments],
] as const) {
  const applied = await run(config.databaseUrl);
  process.stdout.write(
    applied.length === 0
      ? `${name} schema already up to date\n`
      : `${name} applied ${applied.join(', ')}\n`,
  );
}
const services = compose();
try {
  await services.identity.ensureAdmin(config.adminSeedEmail, config.adminSeedPassword);
  process.stdout.write(`admin seed ready (${config.adminSeedEmail})\n`);
} finally {
  await services.pool.end();
}
