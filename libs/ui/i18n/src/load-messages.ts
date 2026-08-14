import type { Locale } from './locales';

export async function loadCommonMessages(locale: Locale) {
  switch (locale) {
    case 'he':
      return (await import('./messages/he/common.json')).default;
    case 'en':
    default:
      return (await import('./messages/en/common.json')).default;
  }
}
