import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RegisterForm } from '@shearly/feature-account';
import { Link } from '../../../src/i18n/navigation';

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account');
  return (
    <main id="main-content" className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
      <h1 className="text-xl font-medium">{t('register')}</h1>
      <RegisterForm />
      <Link href="/sign-in">{t('haveAccount')}</Link>
    </main>
  );
}
