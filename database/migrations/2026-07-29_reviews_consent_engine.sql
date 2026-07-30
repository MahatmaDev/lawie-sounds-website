-- ============================================================================
--  Migration: 2026-07-29  —  REVIEWS: CONSENT, PRIVACY & MODERATION
--  Run in: Supabase Dashboard → SQL Editor → New query → Run
--  Safe to re-run (fully idempotent).
--
--  WHY THIS EXISTS
--  ---------------
--  An audit of the review system found three things:
--
--   1. SECURITY. The RLS policy "Public can submit reviews" was
--      WITH CHECK (TRUE), so the anon role could insert a row with
--      is_approved = true. Verified against the live project: an anonymous
--      insert returned 201 and the row was immediately public. That bypassed
--      the API, the moderation queue and the admin notification. The same
--      policy existed on bookings. Both were dropped in the preceding
--      migration (close_public_insert_rls_bypass).
--
--   2. NO CONSENT RECORD. Reviews stored a client's real name and words and
--      published them, with nothing recording that the person agreed to that,
--      what they were told, or when. There was also no way for them to change
--      their mind.
--
--   3. NO SUBMISSION PATH. POST /api/reviews existed but no page ever called
--      it, which is why the table has never held a row. That emptiness is why
--      the homepage was falling back to hardcoded testimonials.
--
--  DATA PROTECTION POSTURE
--  -----------------------
--   * display_name is what the public sees; client_name (the full legal name)
--     is admin-only and never leaves the API. Default presentation is
--     "First L." — the reviewer opts IN to showing more.
--   * Consent is recorded with the exact notice version agreed to, so we can
--     always answer "what were they actually told?".
--   * A row cannot reach 'published' without consent — enforced by a CHECK
--     constraint, not by application code that might be bypassed.
--   * The submitter's IP is stored only as a salted hash. That supports abuse
--     detection ("is this the same person spamming?") without retaining an
--     identifier that could be used to locate them.
--   * Withdrawal is self-service via a secret token. No account, no email
--     collected — the link is shown once at submission time.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. LIFECYCLE
--    `status` is the single source of truth. `is_approved` is kept as a mirror
--    because the dashboard_stats view and the public RLS policy already read
--    it; a trigger keeps them in step so the two can never disagree — the same
--    two-sources-of-truth bug that had already broken the gallery's category
--    list.
-- ---------------------------------------------------------------------------
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

UPDATE reviews SET status = CASE WHEN is_approved THEN 'published' ELSE 'pending' END
 WHERE status NOT IN ('pending','published','rejected','withdrawn');

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_status_check;
ALTER TABLE reviews ADD  CONSTRAINT reviews_status_check
  CHECK (status IN ('pending','published','rejected','withdrawn'));

-- ---------------------------------------------------------------------------
-- 2. CONSENT
-- ---------------------------------------------------------------------------
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS consent_publish BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS consent_version TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS consented_at    TIMESTAMPTZ;

-- The guarantee that matters: nothing becomes public without a recorded yes.
-- Enforced in the database so no future code path — an admin bulk action, a
-- migration, a direct SQL edit — can quietly publish something unconsented.
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_consent_required;
ALTER TABLE reviews ADD  CONSTRAINT reviews_consent_required
  CHECK (status <> 'published' OR consent_publish = TRUE);

-- ---------------------------------------------------------------------------
-- 3. IDENTITY MINIMISATION
--    client_name holds what they typed (admin-only). display_name holds what
--    the world sees. Keeping them separate is what makes "First L." possible
--    without losing the information the manager needs to recognise a client.
-- ---------------------------------------------------------------------------
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS display_name   TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS show_full_name BOOLEAN DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- 4. WITHDRAWAL (right to retract consent)
-- ---------------------------------------------------------------------------
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS withdrawal_token TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS withdrawn_at     TIMESTAMPTZ;

-- Unique so a token identifies exactly one review; partial so the many legacy
-- NULLs do not collide.
DROP INDEX IF EXISTS idx_reviews_withdrawal_token;
CREATE UNIQUE INDEX idx_reviews_withdrawal_token
  ON reviews (withdrawal_token) WHERE withdrawal_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. VERIFICATION
--    Optional link to a real booking. Present = "Verified client" badge.
--    Absent = the review still stands, it just carries no badge.
-- ---------------------------------------------------------------------------
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- 6. MODERATION AUDIT
-- ---------------------------------------------------------------------------
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderated_at     TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderated_by     TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- ---------------------------------------------------------------------------
-- 7. ABUSE SIGNALS, MINIMISED
--    A salted hash, never the raw address. Enough to spot one device firing off
--    ten reviews; not enough to identify or locate anyone. Bookings still store
--    a raw user_ip — that is a separate decision for a separate table, since an
--    enquiry is a direct commercial contact rather than published speech.
-- ---------------------------------------------------------------------------
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS submitter_hash TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_agent     TEXT;

-- ---------------------------------------------------------------------------
-- 8. RATING INTEGRITY
--    parseInt('abc') is NaN, and the old handler passed it straight through.
-- ---------------------------------------------------------------------------
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_rating_check;
ALTER TABLE reviews ALTER COLUMN rating SET NOT NULL;
ALTER TABLE reviews ADD  CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5);

-- ---------------------------------------------------------------------------
-- 9. KEEP is_approved IN STEP WITH status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_review_approval()
RETURNS TRIGGER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.is_approved := (NEW.status = 'published');
  IF NEW.status = 'withdrawn' AND NEW.withdrawn_at IS NULL THEN
    NEW.withdrawn_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reviews_sync_approval ON reviews;
CREATE TRIGGER trg_reviews_sync_approval
  BEFORE INSERT OR UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION sync_review_approval();

DROP TRIGGER IF EXISTS trg_reviews_updated_at ON reviews;
CREATE TRIGGER trg_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 10. INDEXES — matched to the actual query patterns
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reviews_public_list
  ON reviews (status, is_featured DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_service_status
  ON reviews (service_id, status) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_moderation
  ON reviews (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_submitter
  ON reviews (submitter_hash, created_at DESC) WHERE submitter_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 11. RLS
--     Read published only. No public INSERT policy at all: the Express API
--     holds the service key and is deliberately the single write path, so
--     validation, rate limiting and moderation cannot be routed around.
-- ---------------------------------------------------------------------------
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public reads approved reviews"  ON reviews;
DROP POLICY IF EXISTS "Public reads published reviews" ON reviews;
CREATE POLICY "Public reads published reviews"
  ON reviews FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "Public can submit reviews" ON reviews;

COMMIT;
