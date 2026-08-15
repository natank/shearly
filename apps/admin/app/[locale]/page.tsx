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
  const account = await getSession();
  return (
    <main className="flex flex-col gap-3 p-4">
      <h1>{t('adminAppName')}</h1>
      <LocaleSwitcher />
      {account?.role === 'admin' ? (
        <>
          <p>{account.email}</p>
          <Link href="/vetting">{vettingT('queue')}</Link>
          <SignOutButton />
        </>
      ) : (
        <SignInForm adminOnly />
      )}
    </main>
  );
}
