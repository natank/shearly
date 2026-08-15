import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SignOutButton } from '@shearly/feature-account';
import { DiscoverySearch } from '@shearly/feature-discovery';
import { LocaleSwitcher } from '../../src/components/locale-switcher';
import { Link } from '../../src/i18n/navigation';
import { getSession } from '../../src/auth/session';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('common');
  const accountT = await getTranslations('account');
  const account = await getSession();
  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
        <h1>{t('appName')}</h1>
        <LocaleSwitcher />
        {account ? (
          <>
            <p className="text-sm">{account.email}</p>
            <Link href={account.role === 'provider' ? '/provider' : '/account'}>
              {account.role === 'provider' ? accountT('providerHome') : accountT('customerHome')}
            </Link>
            <SignOutButton />
          </>
        ) : (
          <>
            <Link href="/sign-in">{accountT('signIn')}</Link>
            <Link href="/register">{accountT('register')}</Link>
          </>
        )}
      </div>
      <DiscoverySearch />
    </main>
  );
}
