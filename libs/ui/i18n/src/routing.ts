import { defineRouting } from 'next-intl/routing';
import { defaultLocale, locales } from './locales.js';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
});
