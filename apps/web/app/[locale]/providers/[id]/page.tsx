import { setRequestLocale } from 'next-intl/server';
import { DiscoveryProfile } from '@shearly/feature-discovery';

export default async function ProviderPublicPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <main className="p-4">
      <DiscoveryProfile providerId={id} />
    </main>
  );
}
