import { config as loadDotenv } from 'dotenv';
import { envSchema, toAppConfig, type AppConfig } from './schema.js';

if (process.env.NODE_ENV !== 'production') {
  loadDotenv();
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${detail}`);
  }
  return toAppConfig(parsed.data);
}
