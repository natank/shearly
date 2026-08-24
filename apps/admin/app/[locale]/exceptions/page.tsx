import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getSession } from '../../../src/auth/session';
import { ExceptionsView } from '@shearly/feature-admin';

export default async function ExceptionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const account = await getSession();
  if (account?.role !== 'admin') {
    redirect(`/${locale}`);
  }
  const t = await getTranslations('admin');
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
      <h1 className="text-xl font-medium">{t('exceptions')}</h1>
      <ExceptionsView />
    </main>
  );
}
