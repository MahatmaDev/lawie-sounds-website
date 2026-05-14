-- ============================================================
-- LAWIE SOUNDS — SUPABASE SCHEMA
-- Run this in your Supabase project → SQL Editor → Run
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== TABLES ====================

CREATE TABLE IF NOT EXISTS services (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  category TEXT DEFAULT 'General',
  icon TEXT DEFAULT 'fa-star',
  short_desc TEXT,
  long_desc TEXT,
  image TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  display_order INT DEFAULT 0,
  packages JSONB DEFAULT '[]',
  features JSONB DEFAULT '[]',
  faqs JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  venue TEXT NOT NULL,
  price INT DEFAULT 0,
  total_seats INT DEFAULT 100,
  seats_left INT DEFAULT 100,
  description TEXT,
  image TEXT,
  status TEXT DEFAULT 'published',
  is_active BOOLEAN DEFAULT TRUE,
  booking_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gallery (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  type TEXT DEFAULT 'image',
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_name TEXT NOT NULL,
  rating INT DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  event_type TEXT,
  is_approved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  event_date DATE,
  event_type TEXT,
  guest_count TEXT,
  budget TEXT,
  venue TEXT,
  services TEXT[],
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_banners (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  type TEXT DEFAULT 'banner',
  name TEXT,
  message TEXT NOT NULL,
  cta_text TEXT DEFAULT 'Learn More',
  cta_link TEXT DEFAULT '/booking.html',
  is_active BOOLEAN DEFAULT TRUE,
  start_date DATE,
  end_date DATE,
  priority INT DEFAULT 0,
  views INT DEFAULT 0,
  clicks INT DEFAULT 0,
  ctr FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Promotional posters (seasonal, celebration announcements, offers)
CREATE TABLE IF NOT EXISTS posters (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  caption TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  start_date DATE,
  end_date DATE,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  email TEXT,
  hire_date DATE,
  status TEXT DEFAULT 'active',
  total_events INT DEFAULT 0,
  avg_rating FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  employee_name TEXT,
  event_name TEXT,
  event_date DATE,
  amount INT NOT NULL,
  status TEXT DEFAULT 'pending',
  payment_date DATE,
  rating INT DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== ROW LEVEL SECURITY ====================
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE posters ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;

-- Public read (visitors)
CREATE POLICY "Public reads active services"     ON services         FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public reads active events"       ON events           FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public reads gallery"             ON gallery          FOR SELECT USING (TRUE);
CREATE POLICY "Public reads approved reviews"    ON reviews          FOR SELECT USING (is_approved = TRUE);
CREATE POLICY "Public reads active banners"      ON marketing_banners FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public reads active posters"      ON posters          FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public can submit bookings"       ON bookings         FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Public can submit reviews"        ON reviews          FOR INSERT WITH CHECK (TRUE);

-- Service role key (used by our backend) bypasses RLS automatically.
-- No additional policies needed for admin operations.

-- ==================== SEED DATA (optional) ====================
-- Uncomment to insert sample services:
/*
INSERT INTO services (name, slug, category, icon, short_desc, is_active, display_order) VALUES
  ('DJ & MC Services',       'dj-mc-services',  'Audio',    'fa-headphones', 'Professional DJ and MC for high-energy events.',     TRUE, 1),
  ('LED Screens',            'led-screens',      'Visual',   'fa-tv',         'High-resolution LED screens for stunning visuals.',  TRUE, 2),
  ('Power & Lighting',       'power-lighting',   'Lighting', 'fa-lightbulb',  'Professional lighting design and power distribution.', TRUE, 3),
  ('Pyrotechnics',           'pyrotechnics',     'Effects',  'fa-fire',       'Spectacular fire effects and confetti cannons.',     TRUE, 4),
  ('Photography',            'photography',      'Media',    'fa-camera',     'Professional event photography.',                    TRUE, 5),
  ('Live Streaming',         'live-streaming',   'Media',    'fa-video',      'Broadcast your event live to the world.',           TRUE, 6),
  ('360 Booth',              '360-booth',        'Media',    'fa-cube',       'Immersive 360-degree photo experience.',             TRUE, 7),
  ('Drone Services',         'drone-services',   'Media',    'fa-drone',      'Stunning aerial cinematography.',                    TRUE, 8),
  ('Public Address Systems', 'public-address',   'Audio',    'fa-volume-up',  'Crystal-clear audio for speeches and events.',      TRUE, 9);
*/
