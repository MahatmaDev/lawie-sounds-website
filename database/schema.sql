-- ============================================================
-- LAWIE SOUNDS — SUPABASE SCHEMA v5.0 (2026-07-27)
-- Safe to re-run: uses IF NOT EXISTS and ALTER COLUMN guards
-- Run this in Supabase → SQL Editor → Run
--
-- For migration history and the exact SQL used to bring an existing
-- database to this state, see database/migrations/*.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== HELPER FUNCTIONS ====================
-- search_path pinned to satisfy Supabase security lint 0011.

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-generate booking reference (e.g. LS-2607-A1B2C3) on insert.
-- REPLACE(id, '-', '') strips UUID dashes so we always get 6 hex chars.
CREATE OR REPLACE FUNCTION generate_booking_reference()
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

-- ==================== TABLES ====================

CREATE TABLE IF NOT EXISTS services (
  id            UUID         DEFAULT uuid_generate_v4() PRIMARY KEY,
  name          TEXT         NOT NULL,
  slug          TEXT         UNIQUE NOT NULL,
  category      TEXT         DEFAULT 'General',
  icon          TEXT         DEFAULT 'fa-star',
  short_desc    TEXT,
  long_desc     TEXT,
  image         TEXT,
  is_active     BOOLEAN      DEFAULT TRUE,
  display_order INT          DEFAULT 0,
  packages      JSONB        DEFAULT '[]',
  features      JSONB        DEFAULT '[]',
  faqs          JSONB        DEFAULT '[]',
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id            UUID         DEFAULT uuid_generate_v4() PRIMARY KEY,
  title         TEXT         NOT NULL,
  date          DATE         NOT NULL,
  venue         TEXT         NOT NULL,
  price         INT          NOT NULL DEFAULT 0,
  total_seats   INT          DEFAULT 100,
  seats_left    INT          DEFAULT 100,
  description   TEXT,
  image         TEXT,
  status        TEXT         DEFAULT 'published',
  is_active     BOOLEAN      DEFAULT TRUE,
  booking_count INT          DEFAULT 0,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW()
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS total_seats   INT  DEFAULT 100;
ALTER TABLE events ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'published';
ALTER TABLE events ADD COLUMN IF NOT EXISTS booking_count INT  DEFAULT 0;

-- Gallery category taxonomy. A table rather than a CHECK constraint or a
-- hardcoded JS array: the same list used to live in the dashboard and in the
-- live data, and the two drifted until only one value overlapped. Both the
-- public page and the dashboard now read this via the API.
CREATE TABLE IF NOT EXISTS gallery_categories (
  slug          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  emoji         TEXT DEFAULT '📸',
  display_order INT  DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO gallery_categories (slug, label, emoji, display_order) VALUES
  ('Weddings','Weddings','💍',10), ('Ruracio','Ruracio','🎎',20),
  ('Corporate','Corporate','🏢',30), ('Parties','Parties','🎉',40),
  ('Audio','Audio','🎧',50), ('Visual','Visual','📺',60),
  ('Equipment','Equipment','🎛️',70), ('Effects','Effects','🎆',80),
  ('Media','Media','🎥',90), ('Behind the Scenes','Behind the Scenes','🎬',100),
  ('General','General','📸',110)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS gallery (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  title         TEXT        NOT NULL,
  category      TEXT        DEFAULT 'General' REFERENCES gallery_categories(slug)
                            ON UPDATE CASCADE ON DELETE SET DEFAULT,
  type          TEXT        DEFAULT 'image' CHECK (type IN ('image','video')),
  image_url     TEXT        NOT NULL,        -- Storage public URL, or a legacy /IMAGES/ path
  service_slug  TEXT,                        -- links image to a specific service (e.g. 'drone-services')
  is_featured   BOOLEAN     DEFAULT FALSE,   -- pinned to top of gallery page
  is_published  BOOLEAN     DEFAULT TRUE,    -- false = draft, hidden from the public page
  display_order INT         DEFAULT 0,
  alt_text      TEXT,                        -- accessibility; distinct from title
  caption       TEXT,
  width         INT,                         -- intrinsic size — prevents layout shift
  height        INT,
  storage_path  TEXT,                        -- key inside the `gallery` bucket; NULL for legacy rows
  mime_type     TEXT,
  file_size     INT,
  thumb_url     TEXT,                        -- poster frame, required for video
  event_date    DATE,                        -- when the event happened, not when it was uploaded
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
-- Replayed as ALTER for existing installs: CREATE TABLE IF NOT EXISTS is a
-- no-op once the table exists, so new columns must be added separately.
-- Migration history: database/migrations/2026-07-28_gallery_engine.sql
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS alt_text     TEXT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS caption      TEXT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS width        INT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS height       INT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS mime_type    TEXT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS file_size    INT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS thumb_url    TEXT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS event_date   DATE;

-- Media lives in the `gallery` Storage bucket, NOT in this table. Creating it:
--   INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   VALUES ('gallery','gallery',true,52428800,
--           ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif',
--                 'video/mp4','video/webm','video/quicktime'])
--   ON CONFLICT (id) DO NOTHING;

-- Reviews hold a real person's words published under their name, so the shape
-- below is as much a privacy design as a data model.
--   * client_name is the full name they typed — ADMIN ONLY, never in a public
--     API response. display_name is what the world sees ("Sarah K." by default).
--   * consent_publish records that they agreed, consent_version records exactly
--     what they agreed to, so we can always answer "what were they told?".
--   * withdrawal_token lets them retract without an account or an email address.
-- Migration history: database/migrations/2026-07-29_reviews_consent_engine.sql
CREATE TABLE IF NOT EXISTS reviews (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_name      TEXT        NOT NULL,               -- admin-only, never published
  display_name     TEXT,                               -- what the public sees
  show_full_name   BOOLEAN     DEFAULT FALSE,
  rating           INT         NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  comment          TEXT,
  event_type       TEXT,
  event_date       DATE,
  service_id       UUID        REFERENCES services(id) ON DELETE SET NULL,
  client_image     TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','published','rejected','withdrawn')),
  is_approved      BOOLEAN     DEFAULT FALSE,          -- mirror of status, kept by trigger
  is_featured      BOOLEAN     DEFAULT FALSE,
  admin_reply      TEXT,
  -- consent
  consent_publish  BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_version  TEXT,
  consented_at     TIMESTAMPTZ,
  -- withdrawal
  withdrawal_token TEXT,
  withdrawn_at     TIMESTAMPTZ,
  -- verification against a real booking
  booking_id       UUID        REFERENCES bookings(id) ON DELETE SET NULL,
  is_verified      BOOLEAN     DEFAULT FALSE,
  -- moderation audit
  moderated_at     TIMESTAMPTZ,
  moderated_by     TEXT,
  rejection_reason TEXT,
  -- abuse signals, minimised: a salted hash, never a raw IP
  submitter_hash   TEXT,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- The guarantee that matters, enforced in the database rather than in
-- application code that a future path might bypass: nothing becomes public
-- without a recorded yes.
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_consent_required;
ALTER TABLE reviews ADD  CONSTRAINT reviews_consent_required
  CHECK (status <> 'published' OR consent_publish = TRUE);

-- status is the single source of truth; is_approved follows it so the
-- dashboard_stats view and older code keep working without a second opinion.
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

DROP INDEX IF EXISTS idx_reviews_withdrawal_token;
CREATE UNIQUE INDEX idx_reviews_withdrawal_token
  ON reviews (withdrawal_token) WHERE withdrawal_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS bookings (
  id                UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,
  booking_reference TEXT          UNIQUE,
  name              TEXT          NOT NULL,
  email             TEXT,
  phone             TEXT          NOT NULL,
  event_date        DATE,
  event_type        TEXT,
  event_id          UUID          REFERENCES events(id) ON DELETE SET NULL,
  guest_count       TEXT,
  budget            TEXT,
  venue             TEXT,
  services          TEXT[],
  selected_package  TEXT,
  ticket_quantity   INT           DEFAULT 1,
  total_amount      NUMERIC(10,2),
  status            TEXT          DEFAULT 'pending'
                                  CHECK (status IN ('pending','confirmed','completed','cancelled')),
  notes             TEXT,
  event_details     TEXT,
  source            TEXT,
  channel           TEXT          DEFAULT 'booking-form',
  responded_at      TIMESTAMPTZ,
  handled_by        TEXT,
  user_ip           TEXT,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ   DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   DEFAULT NOW()
);
-- Existing installs may have these as NOT NULL from earlier schema versions.
-- Public form treats them as optional.
DO $$ BEGIN
  BEGIN ALTER TABLE bookings ALTER COLUMN email      DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE bookings ALTER COLUMN event_date DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE bookings ALTER COLUMN event_type DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

CREATE TABLE IF NOT EXISTS marketing_banners (
  id         UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  type       TEXT        DEFAULT 'banner',
  name       TEXT,
  message    TEXT        NOT NULL,
  cta_text   TEXT        DEFAULT 'Learn More',
  cta_link   TEXT        DEFAULT '/booking.html',
  is_active  BOOLEAN     DEFAULT TRUE,
  start_date DATE,
  end_date   DATE,
  priority   INT         DEFAULT 0,
  views      INT         DEFAULT 0,
  clicks     INT         DEFAULT 0,
  ctr        FLOAT       DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE marketing_banners ADD COLUMN IF NOT EXISTS name   TEXT;
ALTER TABLE marketing_banners ADD COLUMN IF NOT EXISTS views  INT   DEFAULT 0;
ALTER TABLE marketing_banners ADD COLUMN IF NOT EXISTS clicks INT   DEFAULT 0;
ALTER TABLE marketing_banners ADD COLUMN IF NOT EXISTS ctr    FLOAT DEFAULT 0;

-- Promotional posters (seasonal, celebration announcements, offers)
CREATE TABLE IF NOT EXISTS posters (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  title         TEXT        NOT NULL,
  image_url     TEXT        NOT NULL,
  caption       TEXT,
  is_active     BOOLEAN     DEFAULT TRUE,
  start_date    DATE,
  end_date      DATE,
  display_order INT         DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  name         TEXT        NOT NULL,
  role         TEXT,
  phone        TEXT,
  email        TEXT,
  hire_date    DATE,
  status       TEXT        DEFAULT 'active',
  total_events INT         DEFAULT 0,
  avg_rating   FLOAT       DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id   UUID        REFERENCES employees(id) ON DELETE SET NULL,
  employee_name TEXT,
  event_name    TEXT,
  event_date    DATE,
  amount        INT         NOT NULL,
  status        TEXT        DEFAULT 'pending',
  payment_date  DATE,
  rating        INT         DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- In-app notification log (bookings, reviews, system alerts)
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  type            TEXT        NOT NULL,  -- 'booking' | 'review' | 'payroll' | 'system'
  title           TEXT        NOT NULL,
  message         TEXT        NOT NULL,
  is_read         BOOLEAN     DEFAULT FALSE,
  reference_id    UUID,                  -- Related record ID (booking, review, etc.)
  reference_table TEXT,                  -- 'bookings' | 'reviews' | etc.
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Key-value admin configuration store
CREATE TABLE IF NOT EXISTS settings (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  key         TEXT        UNIQUE NOT NULL,
  value       TEXT,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== COLUMN NAME MIGRATIONS ====================
-- v4.0 used 'event_date' for events; current system uses 'date'. Normalize here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'event_date'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'date'
  ) THEN
    ALTER TABLE events RENAME COLUMN event_date TO date;
  END IF;
END $$;

-- v4.0 used 'image_url' for events; current system uses 'image'. Normalize here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'image_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'image'
  ) THEN
    ALTER TABLE events RENAME COLUMN image_url TO image;
  END IF;
END $$;

-- v4.0 used 'main_image' for services; current system uses 'image'. Normalize here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'main_image'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'image'
  ) THEN
    ALTER TABLE services RENAME COLUMN main_image TO image;
  END IF;
END $$;

-- ==================== ADD NEW COLUMNS TO EXISTING TABLES ====================
-- These are idempotent — safe to re-run against an existing database

-- Idempotent add for older installs. Keep new columns HERE too, not only in
-- CREATE TABLE — because CREATE TABLE IF NOT EXISTS is a no-op if the table
-- already exists, so column additions must be replayed via ALTER TABLE.
-- Migration history: database/migrations/2026-07-27_final_audit_cleanup.sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_reference TEXT UNIQUE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS event_id          UUID REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS selected_package  TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ticket_quantity   INT DEFAULT 1;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_amount      NUMERIC(10,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS user_ip           TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS user_agent        TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes             TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS event_details     TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source            TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS channel           TEXT DEFAULT 'booking-form';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS responded_at      TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS handled_by        TEXT;

-- Constrain status to the four values the Kanban board renders.
UPDATE bookings SET status = 'pending'
 WHERE status IS NULL OR status NOT IN ('pending','confirmed','completed','cancelled');
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD  CONSTRAINT bookings_status_check
  CHECK (status IN ('pending','confirmed','completed','cancelled'));

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS admin_reply  TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS event_date   DATE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS service_id   UUID REFERENCES services(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS client_image TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_featured  BOOLEAN DEFAULT FALSE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();
-- Consent / privacy / moderation columns (2026-07-29). Replayed as ALTER for
-- existing installs, since CREATE TABLE IF NOT EXISTS above is a no-op once the
-- table exists.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS display_name     TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS show_full_name   BOOLEAN DEFAULT FALSE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS consent_publish  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS consent_version  TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS consented_at     TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS withdrawal_token TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS withdrawn_at     TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS booking_id       UUID REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_verified      BOOLEAN DEFAULT FALSE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderated_at     TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderated_by     TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS submitter_hash   TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_agent       TEXT;

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_status_check;
ALTER TABLE reviews ADD  CONSTRAINT reviews_status_check
  CHECK (status IN ('pending','published','rejected','withdrawn'));

ALTER TABLE settings         ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE settings         ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE gallery          ADD COLUMN IF NOT EXISTS type          TEXT        DEFAULT 'image';
ALTER TABLE gallery          ADD COLUMN IF NOT EXISTS is_featured   BOOLEAN     DEFAULT FALSE;
ALTER TABLE gallery          ADD COLUMN IF NOT EXISTS service_slug  TEXT;
ALTER TABLE gallery          ADD COLUMN IF NOT EXISTS display_order INT         DEFAULT 0;
ALTER TABLE services         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE events           ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE gallery          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE marketing_banners ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE posters          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE employees        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE payroll          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ==================== ROW LEVEL SECURITY ====================
ALTER TABLE services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery           ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE posters           ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings          ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies (idempotent)
DROP POLICY IF EXISTS "Public reads active services"     ON services;
DROP POLICY IF EXISTS "Public reads active events"       ON events;
DROP POLICY IF EXISTS "Public reads gallery"             ON gallery;
DROP POLICY IF EXISTS "Public reads approved reviews"    ON reviews;
DROP POLICY IF EXISTS "Public reads active banners"      ON marketing_banners;
DROP POLICY IF EXISTS "Public reads active posters"      ON posters;
DROP POLICY IF EXISTS "Public can submit bookings"       ON bookings;
DROP POLICY IF EXISTS "Public can submit reviews"        ON reviews;

CREATE POLICY "Public reads active services"  ON services         FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public reads active events"    ON events           FOR SELECT USING (is_active = TRUE);
-- Published rows only. A blanket USING (TRUE) would leak unpublished drafts the
-- moment is_published started being used.
DROP POLICY IF EXISTS "Public reads published gallery" ON gallery;
CREATE POLICY "Public reads published gallery" ON gallery FOR SELECT USING (is_published = TRUE);
ALTER TABLE gallery_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public reads gallery categories" ON gallery_categories;
CREATE POLICY "Public reads gallery categories" ON gallery_categories FOR SELECT USING (is_active = TRUE);
DROP POLICY IF EXISTS "Public reads published reviews" ON reviews;
CREATE POLICY "Public reads published reviews" ON reviews          FOR SELECT USING (status = 'published');
CREATE POLICY "Public reads active banners"    ON marketing_banners FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public reads active posters"    ON posters          FOR SELECT USING (is_active = TRUE);

-- DELIBERATELY NO PUBLIC INSERT POLICIES.
--
-- These used to exist on both bookings and reviews as WITH CHECK (TRUE), which
-- accepts ANY row from the anon role. Verified against the live project on
-- 2026-07-29: an anonymous insert carrying is_approved = true returned 201 and
-- the row was immediately public — bypassing the API, the moderation queue and
-- the admin notification. The same hole on bookings routed around the honeypot,
-- phone validation and rate limit.
--
-- Nothing legitimate needed them: the frontend never talks to PostgREST, it
-- posts to the Express API, which holds the service key and bypasses RLS. The
-- API is now the only write path, so validation, rate limiting and moderation
-- cannot be avoided.
DROP POLICY IF EXISTS "Public can submit bookings" ON bookings;
DROP POLICY IF EXISTS "Public can submit reviews"  ON reviews;

-- Service role key (used by our backend) bypasses RLS automatically.
-- No additional admin policies needed.

-- ==================== UPDATED_AT TRIGGERS ====================
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

-- ==================== BOOKING REFERENCE TRIGGER ====================
DROP TRIGGER IF EXISTS trg_bookings_reference ON bookings;
CREATE TRIGGER trg_bookings_reference
  BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION generate_booking_reference();

-- ==================== INDEXES ====================
CREATE INDEX IF NOT EXISTS idx_bookings_status      ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_event_date  ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at  ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_date          ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_is_active     ON events(is_active);
CREATE INDEX IF NOT EXISTS idx_reviews_is_approved  ON reviews(is_approved);
CREATE INDEX IF NOT EXISTS idx_reviews_is_featured  ON reviews(is_featured);
-- Matched to the actual query patterns:
CREATE INDEX IF NOT EXISTS idx_reviews_public_list     ON reviews (status, is_featured DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_service_status  ON reviews (service_id, status) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_moderation      ON reviews (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_submitter       ON reviews (submitter_hash, created_at DESC) WHERE submitter_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifs_is_read       ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifs_created_at    ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posters_order        ON posters(display_order);
CREATE INDEX IF NOT EXISTS idx_services_order       ON services(display_order);
CREATE INDEX IF NOT EXISTS idx_gallery_service_slug ON gallery(service_slug);
CREATE INDEX IF NOT EXISTS idx_gallery_is_featured  ON gallery(is_featured);
CREATE INDEX IF NOT EXISTS idx_gallery_created_at   ON gallery(created_at DESC);
-- Matched to the actual query patterns, not added speculatively:
CREATE INDEX IF NOT EXISTS idx_gallery_public_list   ON gallery (is_published, is_featured DESC, display_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gallery_category_pub  ON gallery (category, is_published);
CREATE INDEX IF NOT EXISTS idx_gallery_service_pub   ON gallery (service_slug, is_published) WHERE service_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gallery_storage_path  ON gallery (storage_path) WHERE storage_path IS NOT NULL;
-- Foreign-key covering indexes (Supabase perf lint 0001)
CREATE INDEX IF NOT EXISTS idx_bookings_event_id    ON bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_channel     ON bookings(channel);
CREATE INDEX IF NOT EXISTS idx_reviews_service_id   ON reviews(service_id);
CREATE INDEX IF NOT EXISTS idx_payroll_employee_id  ON payroll(employee_id);

-- ==================== DASHBOARD STATS VIEW ====================
-- security_invoker so the view runs with the caller's permissions, not the
-- creator's (fixes Supabase lint 0010 SECURITY DEFINER VIEW).
DROP VIEW IF EXISTS dashboard_stats;
CREATE VIEW dashboard_stats
WITH (security_invoker = true) AS
SELECT
  (SELECT COUNT(*)                                FROM bookings)                                                              AS total_bookings,
  (SELECT COUNT(*)                                FROM bookings WHERE status = 'pending')                                     AS pending_bookings,
  (SELECT COUNT(*)                                FROM bookings WHERE status = 'confirmed')                                   AS confirmed_bookings,
  (SELECT COUNT(*)                                FROM bookings
   WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()))                                                       AS bookings_this_month,
  (SELECT COUNT(*)                                FROM reviews WHERE is_approved = FALSE)                                     AS pending_reviews,
  (SELECT ROUND(AVG(rating)::NUMERIC, 1)          FROM reviews WHERE is_approved = TRUE)                                     AS avg_rating,
  (SELECT COUNT(*)                                FROM events WHERE is_active = TRUE)                                         AS active_events,
  (SELECT COUNT(*)                                FROM events WHERE date >= NOW() AND is_active = TRUE)                       AS upcoming_events,
  (SELECT COUNT(*)                                FROM employees WHERE status = 'active')                                     AS active_employees,
  (SELECT COALESCE(SUM(total_amount), 0)          FROM bookings
   WHERE status IN ('confirmed', 'completed')
   AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()))                                                         AS revenue_this_month,
  (SELECT COUNT(*)                                FROM notifications WHERE is_read = FALSE)                                   AS unread_notifications;

-- ==================== DEFAULT SETTINGS (seed) ====================
INSERT INTO settings (key, value, description) VALUES
  ('site_name',        'Lawie Sounds',                          'Brand name shown across the site'),
  ('contact_phone',    '+254 700 000 000',                      'Primary contact phone number'),
  ('contact_email',    'info@lawiesounds.co.ke',                'Primary contact email'),
  ('whatsapp_number',  '254700000000',                          'WhatsApp booking number (no + prefix)'),
  ('booking_fee_note', 'Final quote provided after consultation','Note shown on booking form'),
  ('currency',         'KES',                                   'Currency code for price display'),
  ('tax_rate',         '16',                                    'VAT/tax percentage for invoices')
ON CONFLICT (key) DO NOTHING;

-- ==================== SAMPLE SERVICES (uncomment to seed) ====================
/*
INSERT INTO services (name, slug, category, icon, short_desc, is_active, display_order) VALUES
  ('DJ & MC Services',       'dj-mc-services',  'Audio',    'fa-headphones', 'Professional DJ and MC for high-energy events.',        TRUE, 1),
  ('LED Screens',            'led-screens',      'Visual',   'fa-tv',         'High-resolution LED screens for stunning visuals.',     TRUE, 2),
  ('Power & Lighting',       'power-lighting',   'Lighting', 'fa-lightbulb',  'Professional lighting design and power distribution.', TRUE, 3),
  ('Pyrotechnics',           'pyrotechnics',     'Effects',  'fa-fire',       'Spectacular fire effects and confetti cannons.',        TRUE, 4),
  ('Photography',            'photography',      'Media',    'fa-camera',     'Professional event photography.',                       TRUE, 5),
  ('Live Streaming',         'live-streaming',   'Media',    'fa-video',      'Broadcast your event live to the world.',               TRUE, 6),
  ('360 Booth',              '360-booth',        'Media',    'fa-cube',       'Immersive 360-degree photo experience.',                TRUE, 7),
  ('Drone Services',         'drone-services',   'Media',    'fa-drone',      'Stunning aerial cinematography.',                       TRUE, 8),
  ('Public Address Systems', 'public-address',   'Audio',    'fa-volume-up',  'Crystal-clear audio for speeches and events.',         TRUE, 9)
ON CONFLICT (slug) DO NOTHING;
*/
