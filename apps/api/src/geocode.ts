export type GeocodedPoint = { lat: number; lng: number; label: string };

export async function geocodeAddress(
  geocoderUrl: string,
  query: string,
): Promise<GeocodedPoint | null> {
  const url = new URL('/geocode', geocoderUrl);
  url.searchParams.set('q', query);
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error('geocode.unavailable');
  }
  return (await response.json()) as GeocodedPoint;
}
