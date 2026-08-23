import { serve } from '@hono/node-server';
import { compose } from './compose.js';
import { createApp } from './app.js';
import { startDueWorkPoller } from './due-work-poller.js';
import { startNotificationDispatcher } from './notification-dispatcher.js';

const services = compose();

serve({ fetch: createApp(services).fetch, port: services.config.apiPort }, (info) => {
  process.stdout.write(`api listening on ${info.port}\n`);
});

startDueWorkPoller(services);
startNotificationDispatcher(services);
