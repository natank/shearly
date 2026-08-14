export const IDENTITY_SERVICE_NAME = 'identity';
export { IdentityService } from './identity-service.js';
export type { IdentityConfig } from './identity-service.js';
export { assertPasswordPolicy, dummyVerify, hashPassword, verifyPassword } from './password.js';
export { createSmtpMailer } from './mailer.js';
export type { SendMail } from './mailer.js';
