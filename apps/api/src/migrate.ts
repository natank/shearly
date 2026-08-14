import { loadConfig } from '@shearly/shared-config';
import { migrateIdentity } from '@shearly/services-identity';

const config = loadConfig();
const applied = await migrateIdentity(config.databaseUrl);
process.stdout.write(
  applied.length === 0 ? 'identity schema already up to date\n' : `applied ${applied.join(', ')}\n`,
);
