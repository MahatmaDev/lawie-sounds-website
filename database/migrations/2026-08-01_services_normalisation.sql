-- ============================================================================
--  Migration: 2026-08-01  —  SERVICES: normalise packages and attribution
--  Run in: Supabase Dashboard → SQL Editor → New query → Run
--  Safe to re-run (fully idempotent).
--
--  WHY NOW
--  -------
--  Services is the engine that generates all revenue, and none of the questions
--  an owner needs to ask of it were answerable:
--
--   1. PACKAGES WERE POSITION-INDEXED JSON. services.packages is a JSONB array,
--      and the dashboard addressed entries by array index — editPackage(idx),
--      deletePackage(idx). No stable identifier, so reordering or two people
--      editing at once modifies the wrong package. Nothing could be joined or
--      aggregated, and a price change left no trace.
--
--   2. ATTRIBUTION WAS A STRING JOIN, AND IT HAD ALREADY FAILED. bookings.services
--      is a text[] of service NAMES. Live data contained "Public Address System"
--      while the service is named "Public Address Systems" — so that booking was
--      invisible to per-service analysis, and the marketing guidance consequently
--      reported that service as having had no enquiries in 90 days. Two bookings
--      in, and revenue attribution was already wrong.
--
--  Packages are currently EMPTY across all nine services, so normalising them
--  costs nothing today. Every package added from here makes it more expensive,
--  which is exactly why it happens now rather than later.
--
--  services.packages (JSONB) is left in place and no longer written to. It stays
--  as a read-only fallback until the deploy is confirmed, then can be dropped.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. PACKAGES AS ROWS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_packages (
  id            UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,
  service_id    UUID          NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name          TEXT          NOT NULL,
  -- NULL price is meaningful: "contact us for a quote" is a legitimate position
  -- for bespoke work, and is different from a price of zero.
  price         NUMERIC(12,2) CHECK (price IS NULL OR (price >= 0 AND price <= 100000000)),
  duration      TEXT,
  features      TEXT[]        DEFAULT '{}',
  display_order INT           DEFAULT 0,
  is_active     BOOLEAN       DEFAULT TRUE,
  -- Exactly one package per service may be highlighted. Enforced by the partial
  -- unique index below rather than by application code.
  is_popular    BOOLEAN       DEFAULT FALSE,
  created_at    TIMESTAMPTZ   DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_packages_service ON service_packages (service_id, display_order);
CREATE INDEX IF NOT EXISTS idx_packages_active  ON service_packages (service_id, is_active);

-- Two packages called "Premium" on one service is a data-entry slip that makes
-- a client's chosen package ambiguous forever.
DROP INDEX IF EXISTS idx_packages_unique_name;
CREATE UNIQUE INDEX idx_packages_unique_name
  ON service_packages (service_id, lower(trim(name)));

-- "Most popular" only means something if it is one of them.
DROP INDEX IF EXISTS idx_packages_one_popular;
CREATE UNIQUE INDEX idx_packages_one_popular
  ON service_packages (service_id) WHERE is_popular;

DROP TRIGGER IF EXISTS trg_packages_updated_at ON service_packages;
CREATE TRIGGER trg_packages_updated_at
  BEFORE UPDATE ON service_packages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. PRICE HISTORY
--    Recorded by trigger, not by the API. A price change made through any path
--    — a bulk SQL update, a future import, a different client — is captured,
--    because the only way to change a price is to pass through this table.
--
--    This is what makes "we raised prices in March, did demand fall?" an
--    answerable question rather than a memory.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS package_price_history (
  id          UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,
  package_id  UUID          NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE,
  old_price   NUMERIC(12,2),
  new_price   NUMERIC(12,2),
  changed_by  TEXT,
  changed_at  TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_pkg ON package_price_history (package_id, changed_at DESC);

CREATE OR REPLACE FUNCTION record_package_price_change()
RETURNS TRIGGER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- IS DISTINCT FROM rather than <>, so a change to or from NULL is recorded.
  -- Moving a package to "contact for a quote" is a pricing decision too.
  IF TG_OP = 'INSERT' THEN
    IF NEW.price IS NOT NULL THEN
      INSERT INTO package_price_history (package_id, old_price, new_price, changed_by)
      VALUES (NEW.id, NULL, NEW.price, current_setting('app.actor', true));
    END IF;
  ELSIF NEW.price IS DISTINCT FROM OLD.price THEN
    INSERT INTO package_price_history (package_id, old_price, new_price, changed_by)
    VALUES (NEW.id, OLD.price, NEW.price, current_setting('app.actor', true));
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_package_price_history ON service_packages;
CREATE TRIGGER trg_package_price_history
  AFTER INSERT OR UPDATE OF price ON service_packages
  FOR EACH ROW EXECUTE FUNCTION record_package_price_change();

-- ---------------------------------------------------------------------------
-- 3. BOOKING → SERVICE ATTRIBUTION, WITH REAL KEYS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_services (
  id           UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,
  booking_id   UUID          NOT NULL REFERENCES bookings(id)         ON DELETE CASCADE,
  service_id   UUID          NOT NULL REFERENCES services(id)         ON DELETE RESTRICT,
  package_id   UUID          REFERENCES service_packages(id)          ON DELETE SET NULL,
  -- The price quoted at the time. Snapshotted because the package price will
  -- change and history must not be rewritten by a later price rise.
  quoted_price NUMERIC(12,2),
  created_at   TIMESTAMPTZ   DEFAULT NOW()
);

-- ON DELETE RESTRICT on service_id is deliberate: deleting a service that has
-- historical bookings would erase the record of revenue it earned. The API
-- refuses the delete and offers deactivation instead.

CREATE INDEX IF NOT EXISTS idx_booking_services_booking ON booking_services (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_services_service ON booking_services (service_id);

DROP INDEX IF EXISTS idx_booking_services_unique;
CREATE UNIQUE INDEX idx_booking_services_unique ON booking_services (booking_id, service_id);

-- ---------------------------------------------------------------------------
-- 4. BACKFILL EXISTING ATTRIBUTION
--    Matches loosely on purpose — exact, then trimmed/case-insensitive, then
--    singular/plural. This is the one time loose matching is correct: we are
--    reconstructing intent from strings that were never constrained. From here
--    the join table is authoritative and matching is by key.
-- ---------------------------------------------------------------------------
INSERT INTO booking_services (booking_id, service_id)
SELECT DISTINCT b.id, s.id
  FROM bookings b
  CROSS JOIN LATERAL unnest(coalesce(b.services, '{}')) AS raw(nm)
  JOIN services s ON (
       lower(trim(s.name)) = lower(trim(raw.nm))
    -- "Public Address System" in a live booking vs "Public Address Systems" in
    -- the services table. Tolerate a trailing s in either direction.
    OR lower(trim(s.name)) = lower(trim(raw.nm)) || 's'
    OR lower(trim(s.name)) || 's' = lower(trim(raw.nm))
  )
 WHERE b.services IS NOT NULL
ON CONFLICT (booking_id, service_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. CONTENT COMPLETENESS
--    Nine services with no description, no image and no price is the current
--    state. Surfacing it as data lets the tab show it rather than the owner
--    discovering it on the live site.
-- ---------------------------------------------------------------------------
ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_by TEXT;

CREATE OR REPLACE VIEW service_content_health
WITH (security_invoker = true) AS
SELECT s.id, s.slug, s.name, s.is_active,
       (coalesce(trim(s.short_desc), '') <> '')                                   AS has_short_desc,
       (coalesce(trim(s.long_desc),  '') <> '')                                   AS has_long_desc,
       (s.image IS NOT NULL AND trim(s.image) <> '')                              AS has_image,
       (SELECT count(*) FROM service_packages p WHERE p.service_id = s.id AND p.is_active) AS package_count,
       (SELECT count(*) FROM service_packages p WHERE p.service_id = s.id AND p.is_active AND p.price IS NOT NULL) AS priced_package_count,
       (SELECT count(*) FROM gallery g WHERE g.service_slug = s.slug AND g.is_published)   AS photo_count,
       jsonb_array_length(coalesce(s.features, '[]'))                             AS feature_count,
       jsonb_array_length(coalesce(s.faqs, '[]'))                                 AS faq_count
  FROM services s;

COMMIT;
