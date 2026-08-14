import { loadConfig } from '@shearly/shared-config';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { compose } from './compose.js';

const config = loadConfig();
const applied = await migrateIdentity(config.databaseUrl);
process.stdout.write(
  applied.length === 0 ? 'identity schema already up to date\n' : `applied ${applied.join(', ')}\n`,
);
const services = compose();
try {
  await services.identity.ensureAdmin(config.adminSeedEmail, config.adminSeedPassword);
  process.stdout.write(`admin seed ready (${config.adminSeedEmail})\n`);
} finally {
  await services.pool.end();
}
