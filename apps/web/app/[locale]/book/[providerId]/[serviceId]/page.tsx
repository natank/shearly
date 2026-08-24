import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BookingConfirm } from '@shearly/feature-booking';

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; providerId: string; serviceId: string }>;
  searchParams: Promise<{ slotStart?: string; lat?: string; lng?: string }>;
}) {
  const { locale, providerId, serviceId } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('booking');

  if (!query.slotStart) {
    return (
      <main id="main-content" className="p-4">
        <p className="text-sm">{t('missingSlot')}</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="p-4">
      <BookingConfirm
        selection={{
          providerId,
          serviceId,
          slotStart: query.slotStart,
          lat: query.lat ? Number(query.lat) : undefined,
          lng: query.lng ? Number(query.lng) : undefined,
        }}
      />
    </main>
  );
}
