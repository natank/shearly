import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SignInForm, SignOutButton } from '@shearly/feature-account';
import { LocaleSwitcher } from '../../src/components/locale-switcher';
import { Link } from '../../src/i18n/navigation';
import { getSession } from '../../src/auth/session';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('common');
  const vettingT = await getTranslations('vetting');
  const adminT = await getTranslations('admin');
  const account = await getSession();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-3 p-4">
      <h1 className="text-xl font-medium">{t('adminAppName')}</h1>
      <LocaleSwitcher />
      {account?.role === 'admin' ? (
        <>
          <p>{account.email}</p>
          <Link href="/vetting">{vettingT('queue')}</Link>
          <Link href="/bookings">{adminT('bookings')}</Link>
          <Link href="/exceptions">{adminT('exceptions')}</Link>
          <Link href="/standing">{adminT('standing')}</Link>
          <SignOutButton />
        </>
      ) : (
        <SignInForm adminOnly />
      )}
    </main>
  );
}
