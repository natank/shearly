import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { getTextDirection, isLocale, locales } from '@shearly/ui-i18n';
import { notFound } from 'next/navigation';
import '@shearly/ui-design-system/styles';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// A11Y-004 (WCAG 2.4.2): every page needs a non-empty <title> — axe-core's
// document-title rule was firing across the whole core flow before this.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  setRequestLocale(locale);
  const t = await getTranslations('common');
  return { title: t('appName') };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();
  const dir = getTextDirection(locale);
  const t = await getTranslations('common');

  return (
    <html lang={locale} dir={dir}>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:underline"
        >
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
