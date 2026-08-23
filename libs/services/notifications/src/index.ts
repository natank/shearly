export const NOTIFICATIONS_SERVICE_NAME = 'notifications';

export { createSmtpEmailChannel, type EmailMessage, type NotificationChannel } from './channel.js';
export { templates, type BookingSummary, type Locale, type RenderedEmail } from './templates.js';
export { NotificationService } from './notification-service.js';
