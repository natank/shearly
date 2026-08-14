import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SignInForm } from '@shearly/feature-account';
import { Link } from '../../../src/i18n/navigation';

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account');
  return (
    <main className="flex flex-col gap-4 p-4">
      <h1>{t('signIn')}</h1>
      <SignInForm />
      <Link href="/register">{t('needAccount')}</Link>
      <Link href="/reset-password">{t('resetPassword')}</Link>
    </main>
  );
}
