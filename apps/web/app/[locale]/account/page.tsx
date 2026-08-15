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
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
      <h1 className="text-xl font-medium">{t('customerHome')}</h1>
      <p>{account.email}</p>
      <AddressBook />
      <SignOutButton />
    </main>
  );
}
