CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE catalog.providers
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS rating_sum integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_count integer NOT NULL DEFAULT 0;

ALTER TABLE catalog.providers
  ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

UPDATE catalog.providers
SET location = ST_SetSRID(ST_MakePoint(base_lng, base_lat), 4326)::geography
WHERE base_lat IS NOT NULL
  AND base_lng IS NOT NULL
  AND location IS NULL;

CREATE INDEX IF NOT EXISTS providers_location_gix ON catalog.providers USING GIST (location);

CREATE TABLE IF NOT EXISTS catalog.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES catalog.providers (id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reviews_provider_id ON catalog.reviews (provider_id);
