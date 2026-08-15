import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ResetConfirmForm, ResetRequestForm } from '@shearly/feature-account';

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('account');
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
      <h1 className="text-xl font-medium">{t('resetPassword')}</h1>
      {token ? <ResetConfirmForm token={token} /> : <ResetRequestForm />}
    </main>
  );
}
