-- ============================================================================
--  Migration: 2026-07-31  —  MARKETING: offers, redemptions, real tracking
--  Run in: Supabase Dashboard → SQL Editor → New query → Run
--  Safe to re-run (fully idempotent).
--
--  WHY THIS EXISTS
--  ---------------
--  Three gaps in the marketing section:
--
--   1. NOTHING WAS MEASURABLE. marketing_banners carried views, clicks and ctr,
--      but no endpoint anywhere incremented them and no page reported either
--      event. They were permanently 0, and the admin card hid the metrics line
--      behind `views > 0` - so the marketer saw no performance data at all and
--      had no basis for deciding anything.
--
--   2. THERE WAS NO DISCOUNT MODEL. A banner could say "10% off" as free text,
--      but nothing recorded that an offer existed, who used it, or what it cost.
--      Discount guidance was therefore impossible to ground in anything.
--
--   3. cta_link WAS NEVER VALIDATED and is assigned straight to href on the
--      public homepage, so a javascript: URL would execute on click.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. OFFERS
--    A structured discount, not a sentence in a banner. This is what makes
--    "did the August promotion work?" an answerable question.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS offers (
  id               UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,
  code             TEXT          NOT NULL,          -- what the client types
  label            TEXT          NOT NULL,          -- internal name, e.g. "August weddings push"
  description      TEXT,                            -- shown to the client on success
  discount_type    TEXT          NOT NULL DEFAULT 'percent'
                                 CHECK (discount_type IN ('percent','fixed')),
  discount_value   NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  -- A percentage over 100 would produce negative revenue; a fixed amount has a
  -- different sane ceiling. Enforced together so one constraint covers both.
  CONSTRAINT offers_discount_sane CHECK (
    (discount_type = 'percent' AND discount_value <= 100) OR
    (discount_type = 'fixed'   AND discount_value <= 10000000)
  ),
  min_amount       NUMERIC(12,2),                   -- only applies above this job value
  applies_to       TEXT[],                          -- service slugs; NULL/empty = everything
  starts_on        DATE          NOT NULL DEFAULT CURRENT_DATE,
  ends_on          DATE,
  -- A cap is the difference between a promotion and an open-ended liability.
  max_redemptions  INT           CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  times_redeemed   INT           NOT NULL DEFAULT 0,
  is_active        BOOLEAN       DEFAULT TRUE,
  created_by       TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ   DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   DEFAULT NOW(),
  CONSTRAINT offers_dates_sane CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

-- Codes are matched case-insensitively — a client typing "aug10" must hit
-- "AUG10" — so uniqueness has to be enforced case-insensitively too, otherwise
-- two offers could both match one input and redemption becomes ambiguous.
DROP INDEX IF EXISTS idx_offers_code_unique;
CREATE UNIQUE INDEX idx_offers_code_unique ON offers (upper(trim(code)));

CREATE INDEX IF NOT EXISTS idx_offers_live ON offers (is_active, starts_on, ends_on);

DROP TRIGGER IF EXISTS trg_offers_updated_at ON offers;
CREATE TRIGGER trg_offers_updated_at
  BEFORE UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. REDEMPTIONS
--    A ledger, for the same reason payments are a ledger: times_redeemed alone
--    cannot answer "which bookings came from this campaign?", which is the
--    whole point of attributing revenue to marketing spend.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS offer_redemptions (
  id           UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,
  offer_id     UUID          NOT NULL REFERENCES offers(id)   ON DELETE CASCADE,
  booking_id   UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  code_used    TEXT          NOT NULL,          -- exactly what they typed, for support
  discount_type  TEXT,                          -- snapshot: the offer may change later
  discount_value NUMERIC(10,2),
  redeemed_at  TIMESTAMPTZ   DEFAULT NOW()
);

-- One booking cannot redeem the same offer twice, and cannot stack two offers.
DROP INDEX IF EXISTS idx_redemption_one_per_booking;
CREATE UNIQUE INDEX idx_redemption_one_per_booking ON offer_redemptions (booking_id);

CREATE INDEX IF NOT EXISTS idx_redemptions_offer ON offer_redemptions (offer_id, redeemed_at DESC);

-- Keep offers.times_redeemed in step with the ledger. Maintained by trigger so
-- the counter cannot drift from the rows it is meant to count - the two-sources
-- -of-truth problem that had already broken the gallery category list.
CREATE OR REPLACE FUNCTION sync_offer_redemption_count()
RETURNS TRIGGER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE offers o
     SET times_redeemed = (SELECT count(*) FROM offer_redemptions r WHERE r.offer_id = o.id)
   WHERE o.id = COALESCE(NEW.offer_id, OLD.offer_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_redemption_count ON offer_redemptions;
CREATE TRIGGER trg_redemption_count
  AFTER INSERT OR DELETE ON offer_redemptions
  FOR EACH ROW EXECUTE FUNCTION sync_offer_redemption_count();

-- ---------------------------------------------------------------------------
-- 3. BANNERS: link to an offer, and make the metrics real
-- ---------------------------------------------------------------------------
ALTER TABLE marketing_banners ADD COLUMN IF NOT EXISTS offer_id UUID REFERENCES offers(id) ON DELETE SET NULL;
ALTER TABLE marketing_banners ADD COLUMN IF NOT EXISTS style    TEXT DEFAULT 'bar';

ALTER TABLE marketing_banners ALTER COLUMN views  SET DEFAULT 0;
ALTER TABLE marketing_banners ALTER COLUMN clicks SET DEFAULT 0;
UPDATE marketing_banners SET views = 0  WHERE views  IS NULL;
UPDATE marketing_banners SET clicks = 0 WHERE clicks IS NULL;

-- ctr is derived. It was a stored column that nothing ever computed, so it
-- could only ever disagree with views and clicks. Keeping it as a generated
-- column means it is always right and can never be written to incorrectly.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'marketing_banners' AND column_name = 'ctr'
                AND is_generated = 'NEVER') THEN
    ALTER TABLE marketing_banners DROP COLUMN ctr;
  END IF;
END $$;

ALTER TABLE marketing_banners
  ADD COLUMN IF NOT EXISTS ctr NUMERIC(5,2)
  GENERATED ALWAYS AS (
    CASE WHEN coalesce(views,0) > 0
         THEN round((coalesce(clicks,0)::numeric / views::numeric) * 100, 2)
         ELSE 0 END
  ) STORED;

-- Counters must only ever move forward, and a click without a view is a bug in
-- the caller rather than something to average over.
ALTER TABLE marketing_banners DROP CONSTRAINT IF EXISTS banners_counts_sane;
ALTER TABLE marketing_banners ADD  CONSTRAINT banners_counts_sane
  CHECK (coalesce(views,0) >= 0 AND coalesce(clicks,0) >= 0);

-- Atomic increment. Doing this as read-then-write in the API would lose counts
-- under concurrent traffic, which is precisely when the number matters.
CREATE OR REPLACE FUNCTION bump_banner_metric(p_id UUID, p_metric TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_metric = 'view' THEN
    UPDATE marketing_banners SET views = coalesce(views,0) + 1 WHERE id = p_id;
  ELSIF p_metric = 'click' THEN
    UPDATE marketing_banners SET clicks = coalesce(clicks,0) + 1 WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'unknown metric: %', p_metric;
  END IF;
END;
$$;

-- SECURITY DEFINER above is required so the increment can run without granting
-- anon UPDATE on the whole table. Execution is granted narrowly below.
REVOKE ALL ON FUNCTION bump_banner_metric(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bump_banner_metric(UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. cta_link SAFETY
--    Assigned directly to href on the homepage, so javascript: and data: URLs
--    would execute. Enforced in the database as well as the API, because the
--    database is the one place every write path must pass through.
-- ---------------------------------------------------------------------------
UPDATE marketing_banners
   SET cta_link = '/booking.html'
 WHERE cta_link IS NOT NULL
   AND lower(trim(cta_link)) ~ '^(javascript|data|vbscript|file):';

ALTER TABLE marketing_banners DROP CONSTRAINT IF EXISTS banners_cta_link_safe;
ALTER TABLE marketing_banners ADD  CONSTRAINT banners_cta_link_safe
  CHECK (cta_link IS NULL OR lower(trim(cta_link)) !~ '^(javascript|data|vbscript|file):');

-- ---------------------------------------------------------------------------
-- 5. RLS
--    Offers are read publicly only through the API's validation endpoint, which
--    checks a code the client already knows. Listing every live code is a
--    different thing entirely - it would let anyone harvest unpublished
--    discounts - so there is no public SELECT policy.
-- ---------------------------------------------------------------------------
ALTER TABLE offers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public reads offers" ON offers;
DROP POLICY IF EXISTS "Public reads redemptions" ON offer_redemptions;
-- (no policies: service key only)

COMMIT;
