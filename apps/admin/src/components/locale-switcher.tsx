'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@shearly/ui-design-system';
import { Link, usePathname } from '../i18n/navigation';

export function LocaleSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const nextLocale = locale === 'he' ? 'en' : 'he';
  const label = nextLocale === 'he' ? t('switchToHebrew') : t('switchToEnglish');

  return (
    <Button asChild variant="outline" size="sm" className="self-start">
      <Link href={pathname} locale={nextLocale}>
        {label}
      </Link>
    </Button>
  );
}
