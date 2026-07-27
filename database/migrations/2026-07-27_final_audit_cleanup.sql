-- ============================================================================
--  Migration: 2026-07-27  —  FINAL AUDIT & CLEANUP
--  Applied to production via mcp__supabase__apply_migration on 2026-07-27
--  Run in: Supabase Dashboard → SQL Editor → New query → Run
--  Safe to re-run (fully idempotent).
--
--  WHY THIS EXISTS
--  ---------------
--  A senior-engineer audit of the live DB found the API and schema had drifted:
--    * server.js was writing columns that never existed (bookings.notes,
--      bookings.channel/responded_at/handled_by, events.total_seats/status/
--      booking_count, marketing_banners.name/views/clicks/ctr) — every event
--      create, banner create, and status-change update was silently failing.
--      Postgres logs showed `column bookings.responded_at does not exist` firing
--      on every admin status change.
--    * bookings.email/event_date/event_type were NOT NULL, but the public form
--      treats them as optional — partial submissions were rejected.
--    * Duplicate policies, indexes, triggers, and an updated_at function had
--      accumulated. Supabase advisors flagged an ERROR-level SECURITY DEFINER
--      on the dashboard_stats view.
--
--  This migration supersedes 2026-07-27_bookings_enquiries.sql (which was
--  written but never applied).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. MISSING COLUMNS
-- ---------------------------------------------------------------------------

-- bookings: fix the enquiry pipeline
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes         TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS channel       TEXT DEFAULT 'booking-form';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS responded_at  TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS handled_by    TEXT;

-- events: server writes total_seats, status, booking_count on every insert
ALTER TABLE events   ADD COLUMN IF NOT EXISTS total_seats   INT  DEFAULT 100;
ALTER TABLE events   ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'published';
ALTER TABLE events   ADD COLUMN IF NOT EXISTS booking_count INT  DEFAULT 0;

-- marketing_banners: server writes name/views/clicks/ctr on insert
ALTER TABLE marketing_banners ADD COLUMN IF NOT EXISTS name   TEXT;
ALTER TABLE marketing_banners ADD COLUMN IF NOT EXISTS views  INT   DEFAULT 0;
ALTER TABLE marketing_banners ADD COLUMN IF NOT EXISTS clicks INT   DEFAULT 0;
ALTER TABLE marketing_banners ADD COLUMN IF NOT EXISTS ctr    FLOAT DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. RELAX NOT NULL — the public form treats these as optional
-- ---------------------------------------------------------------------------
ALTER TABLE bookings ALTER COLUMN email      DROP NOT NULL;
ALTER TABLE bookings ALTER COLUMN event_date DROP NOT NULL;
ALTER TABLE bookings ALTER COLUMN event_type DROP NOT NULL;
ALTER TABLE reviews  ALTER COLUMN comment    DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. BOOKING STATUS: constrain to the 4 values the Kanban board renders
-- ---------------------------------------------------------------------------
UPDATE bookings
   SET status = 'pending'
 WHERE status IS NULL
    OR status NOT IN ('pending', 'confirmed', 'completed', 'cancelled');

ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD  CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled'));

-- ---------------------------------------------------------------------------
-- 4. DROP DUPLICATE / REDUNDANT POLICIES
--    Server uses the service_role key which bypasses RLS, so admin policies
--    that key off auth.role() are dead code. Keep one SELECT per table for
--    the public site, plus the two intentional public INSERT policies.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin full access to bookings"    ON bookings;
DROP POLICY IF EXISTS "Admin full access to events"      ON events;
DROP POLICY IF EXISTS "Admin full access to gallery"     ON gallery;
DROP POLICY IF EXISTS "Admin full access to reviews"     ON reviews;

DROP POLICY IF EXISTS "Public can view active events"    ON events;
DROP POLICY IF EXISTS "Public can view gallery"          ON gallery;
DROP POLICY IF EXISTS "Public can view active banners"   ON marketing_banners;
DROP POLICY IF EXISTS "Public can view approved reviews" ON reviews;
DROP POLICY IF EXISTS "Public can view active services"  ON services;

-- Canonical policies (idempotent recreate)
DROP POLICY IF EXISTS "Public reads active services"  ON services;
DROP POLICY IF EXISTS "Public reads active events"    ON events;
DROP POLICY IF EXISTS "Public reads gallery"          ON gallery;
DROP POLICY IF EXISTS "Public reads approved reviews" ON reviews;
DROP POLICY IF EXISTS "Public reads active banners"   ON marketing_banners;
DROP POLICY IF EXISTS "Public reads active posters"   ON posters;
DROP POLICY IF EXISTS "Public can submit bookings"    ON bookings;
DROP POLICY IF EXISTS "Public can submit reviews"     ON reviews;

CREATE POLICY "Public reads active services"  ON services          FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public reads active events"    ON events            FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public reads gallery"          ON gallery           FOR SELECT USING (TRUE);
CREATE POLICY "Public reads approved reviews" ON reviews           FOR SELECT USING (is_approved = TRUE);
CREATE POLICY "Public reads active banners"   ON marketing_banners FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public reads active posters"   ON posters           FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public can submit bookings"    ON bookings          FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Public can submit reviews"     ON reviews           FOR INSERT WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- 5. DROP DUPLICATE INDEXES (flagged by advisors)
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_events_active;    -- kept: idx_events_is_active
DROP INDEX IF EXISTS idx_reviews_approved; -- kept: idx_reviews_is_approved

-- ---------------------------------------------------------------------------
-- 6. DROP DUPLICATE / LEGACY TRIGGERS, CONSOLIDATE ON set_updated_at()
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
DROP TRIGGER IF EXISTS update_events_updated_at   ON events;
DROP TRIGGER IF EXISTS update_services_updated_at ON services;
DROP TRIGGER IF EXISTS update_users_updated_at    ON users;

-- Rebuild the canonical updated_at triggers on every managed table
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'services','events','gallery','reviews','bookings',
    'marketing_banners','posters','employees','payroll','settings'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- Legacy function is no longer referenced by any trigger
DROP FUNCTION IF EXISTS public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 7. PIN search_path ON TRIGGER FUNCTIONS (security lint)
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.set_updated_at()             SET search_path = pg_catalog, public;

-- ---------------------------------------------------------------------------
-- 8. BOOKING REFERENCE — recreate with pinned search_path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_booking_reference()
RETURNS TRIGGER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.booking_reference IS NULL THEN
    NEW.booking_reference := 'LS-' || TO_CHAR(NOW(), 'YYMM') || '-' ||
                             UPPER(SUBSTRING(REPLACE(NEW.id::TEXT, '-', ''), 1, 6));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_reference ON bookings;
CREATE TRIGGER trg_bookings_reference
  BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION generate_booking_reference();

-- Backfill any pre-existing rows that never got a reference
UPDATE bookings
   SET booking_reference = 'LS-' || TO_CHAR(created_at, 'YYMM') || '-' ||
                           UPPER(SUBSTRING(REPLACE(id::TEXT, '-', ''), 1, 6))
 WHERE booking_reference IS NULL;

-- ---------------------------------------------------------------------------
-- 9. dashboard_stats VIEW — recreate as SECURITY INVOKER (fix ERROR lint)
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.dashboard_stats;
CREATE VIEW public.dashboard_stats
WITH (security_invoker = true) AS
SELECT
  (SELECT COUNT(*)                       FROM bookings)                                                                          AS total_bookings,
  (SELECT COUNT(*)                       FROM bookings WHERE status = 'pending')                                                 AS pending_bookings,
  (SELECT COUNT(*)                       FROM bookings WHERE status = 'confirmed')                                               AS confirmed_bookings,
  (SELECT COUNT(*)                       FROM bookings
   WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()))                                                           AS bookings_this_month,
  (SELECT COUNT(*)                       FROM reviews WHERE is_approved = FALSE)                                                 AS pending_reviews,
  (SELECT ROUND(AVG(rating)::NUMERIC, 1) FROM reviews WHERE is_approved = TRUE)                                                  AS avg_rating,
  (SELECT COUNT(*)                       FROM events   WHERE is_active = TRUE)                                                   AS active_events,
  (SELECT COUNT(*)                       FROM events   WHERE date >= NOW() AND is_active = TRUE)                                 AS upcoming_events,
  (SELECT COUNT(*)                       FROM employees WHERE status = 'active')                                                 AS active_employees,
  (SELECT COALESCE(SUM(total_amount), 0) FROM bookings
   WHERE status IN ('confirmed', 'completed')
     AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()))                                                           AS revenue_this_month,
  (SELECT COUNT(*)                       FROM notifications WHERE is_read = FALSE)                                               AS unread_notifications;

-- ---------------------------------------------------------------------------
-- 10. MISSING FOREIGN-KEY INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bookings_event_id   ON bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_reviews_service_id  ON reviews(service_id);
CREATE INDEX IF NOT EXISTS idx_payroll_employee_id ON payroll(employee_id);
CREATE INDEX IF NOT EXISTS idx_gallery_uploaded_by ON gallery(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_bookings_channel    ON bookings(channel);

COMMIT;

-- Reload PostgREST schema cache so the API sees the new columns immediately.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
--  VERIFICATION — every row must return present = true.
-- ============================================================================
SELECT c.table_name, c.column_name,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = c.table_name AND column_name = c.column_name
       ) AS present
FROM (VALUES
  ('bookings','notes'), ('bookings','channel'), ('bookings','responded_at'), ('bookings','handled_by'),
  ('events','total_seats'), ('events','status'), ('events','booking_count'),
  ('marketing_banners','name'), ('marketing_banners','views'),
  ('marketing_banners','clicks'), ('marketing_banners','ctr')
) AS c(table_name, column_name)
ORDER BY table_name, column_name;
