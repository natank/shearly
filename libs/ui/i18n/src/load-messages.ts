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

export async function loadProviderMessages(locale: Locale) {
  switch (locale) {
    case 'he':
      return (await import('./messages/he/provider.json')).default;
    case 'en':
    default:
      return (await import('./messages/en/provider.json')).default;
  }
}

export async function loadVettingMessages(locale: Locale) {
  switch (locale) {
    case 'he':
      return (await import('./messages/he/vetting.json')).default;
    case 'en':
    default:
      return (await import('./messages/en/vetting.json')).default;
  }
}

export async function loadDiscoveryMessages(locale: Locale) {
  switch (locale) {
    case 'he':
      return (await import('./messages/he/discovery.json')).default;
    case 'en':
    default:
      return (await import('./messages/en/discovery.json')).default;
  }
}

export async function loadAccountMessages(locale: Locale) {
  switch (locale) {
    case 'he':
      return (await import('./messages/he/account.json')).default;
    case 'en':
    default:
      return (await import('./messages/en/account.json')).default;
  }
}

export async function loadBookingMessages(locale: Locale) {
  switch (locale) {
    case 'he':
      return (await import('./messages/he/booking.json')).default;
    case 'en':
    default:
      return (await import('./messages/en/booking.json')).default;
  }
}
