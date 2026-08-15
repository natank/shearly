import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { SignOutButton } from '@shearly/feature-account';
import { AddressBook } from '@shearly/feature-discovery';
import { getSession } from '../../../src/auth/session';

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const account = await getSession();
  if (!account) {
    redirect(`/${locale}/sign-in`);
  }
  if (account.role === 'provider') {
    redirect(`/${locale}/provider`);
  }
  const t = await getTranslations('account');
  return (
    <main className="flex flex-col gap-4 p-4">
      <h1>{t('customerHome')}</h1>
      <p>{account.email}</p>
      <AddressBook />
      <SignOutButton />
    </main>
  );
}
