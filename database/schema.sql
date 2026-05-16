-- ============================================================
-- LAWIE SOUNDS — SUPABASE SCHEMA v4.1
-- Safe to re-run: uses IF NOT EXISTS and ALTER COLUMN guards
-- Run this in Supabase → SQL Editor → Run
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== HELPER FUNCTIONS ====================

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-generate booking reference (e.g. LS-2605-A1B2C3) on insert
CREATE OR REPLACE FUNCTION generate_booking_reference()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.booking_reference IS NULL THEN
    NEW.booking_reference := 'LS-' || TO_CHAR(NOW(), 'YYMM') || '-' || UPPER(SUBSTRING(NEW.id::TEXT, 1, 6));
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
  date          TIMESTAMPTZ  NOT NULL,
  venue         TEXT         NOT NULL,
  price         INT          DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS gallery (
  id         UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  title      TEXT        NOT NULL,
  category   TEXT        DEFAULT 'General',
  type       TEXT        DEFAULT 'image',
  image_url  TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_name  TEXT        NOT NULL,
  rating       INT         DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
  comment      TEXT,
  event_type   TEXT,
  event_date   DATE,
  service_id   UUID        REFERENCES services(id) ON DELETE SET NULL,
  client_image TEXT,
  is_approved  BOOLEAN     DEFAULT FALSE,
  is_featured  BOOLEAN     DEFAULT FALSE,
  admin_reply  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

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
  status            TEXT          DEFAULT 'pending',
  notes             TEXT,
  user_ip           TEXT,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ   DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   DEFAULT NOW()
);

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

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_reference TEXT UNIQUE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS event_id          UUID REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS selected_package  TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ticket_quantity   INT DEFAULT 1;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_amount      NUMERIC(10,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS user_ip           TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS user_agent        TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS admin_reply  TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS event_date   DATE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS service_id   UUID REFERENCES services(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS client_image TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_featured  BOOLEAN DEFAULT FALSE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE settings         ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE settings         ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE gallery          ADD COLUMN IF NOT EXISTS type       TEXT        DEFAULT 'image';
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
CREATE POLICY "Public reads gallery"          ON gallery          FOR SELECT USING (TRUE);
CREATE POLICY "Public reads approved reviews" ON reviews          FOR SELECT USING (is_approved = TRUE);
CREATE POLICY "Public reads active banners"   ON marketing_banners FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public reads active posters"   ON posters          FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public can submit bookings"    ON bookings         FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Public can submit reviews"     ON reviews          FOR INSERT WITH CHECK (TRUE);

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
CREATE INDEX IF NOT EXISTS idx_notifs_is_read       ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifs_created_at    ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posters_order        ON posters(display_order);
CREATE INDEX IF NOT EXISTS idx_services_order       ON services(display_order);

-- ==================== DASHBOARD STATS VIEW ====================
CREATE OR REPLACE VIEW dashboard_stats AS
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
