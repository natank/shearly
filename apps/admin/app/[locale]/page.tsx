import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleSwitcher } from '../../src/components/locale-switcher';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('common');
  return (
    <main className="p-4">
      <h1>{t('adminAppName')}</h1>
      <LocaleSwitcher />
    </main>
  );
}
