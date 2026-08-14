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
export type PublicAccount = z.infer<typeof publicAccountSchema>;
