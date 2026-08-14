import { serve } from '@hono/node-server';
import { loadConfig } from '@shearly/shared-config';
import { createApp } from './app.js';

const config = loadConfig();

serve({ fetch: createApp().fetch, port: config.apiPort }, (info) => {
  process.stdout.write(`api listening on ${info.port}\n`);
});
