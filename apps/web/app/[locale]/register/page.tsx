import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RegisterForm } from '@shearly/feature-account';
import { Link } from '../../../src/i18n/navigation';

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account');
  return (
    <main className="flex flex-col gap-4 p-4">
      <h1>{t('register')}</h1>
      <RegisterForm />
      <Link href="/sign-in">{t('haveAccount')}</Link>
    </main>
  );
}
