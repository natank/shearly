import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getSession } from '../../../src/auth/session';
import { VettingQueue } from '@shearly/feature-provider';

export default async function VettingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const account = await getSession();
  if (account?.role !== 'admin') {
    redirect(`/${locale}`);
  }
  const t = await getTranslations('vetting');
  return (
    <main className="flex flex-col gap-4 p-4">
      <h1>{t('queue')}</h1>
      <VettingQueue />
    </main>
  );
}
