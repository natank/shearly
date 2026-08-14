import { z } from 'zod';

export const IDENTITY_CONTRACT_NAME = 'identity';

export const accountRoleSchema = z.enum(['customer', 'provider', 'admin']);
export const registerRoleSchema = z.enum(['customer', 'provider']);
export const localeSchema = z.enum(['en', 'he']);

export const registerRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string(),
  role: registerRoleSchema,
  locale: localeSchema,
});

export const signInRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string(),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email(),
  locale: localeSchema.default('en'),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  password: z.string(),
});

export const publicAccountSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: accountRoleSchema,
  locale: localeSchema,
});

export type AccountRole = z.infer<typeof accountRoleSchema>;
export type RegisterRole = z.infer<typeof registerRoleSchema>;
export type Locale = z.infer<typeof localeSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type SignInRequest = z.infer<typeof signInRequestSchema>;
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;
export type PublicAccount = z.infer<typeof publicAccountSchema>;
