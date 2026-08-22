import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import {
  loadAccountMessages,
  loadBookingMessages,
  loadCommonMessages,
  loadDiscoveryMessages,
  loadProviderMessages,
  routing,
} from '@shearly/ui-i18n';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: {
      common: await loadCommonMessages(locale),
      account: await loadAccountMessages(locale),
      provider: await loadProviderMessages(locale),
      discovery: await loadDiscoveryMessages(locale),
      booking: await loadBookingMessages(locale),
    },
  };
});
