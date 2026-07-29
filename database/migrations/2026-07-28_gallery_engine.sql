-- ============================================================================
--  Migration: 2026-07-28  —  GALLERY ENGINE
--  Run in: Supabase Dashboard → SQL Editor → New query → Run
--  Safe to re-run (fully idempotent).
--
--  WHY THIS EXISTS
--  ---------------
--  The gallery had no storage layer. 42 rows pointed at files committed to the
--  git repo (/IMAGES/...), and the one photo the manager actually uploaded was
--  stored as a 372 KB base64 data URI inside a Postgres TEXT column. Adding a
--  photo meant either a git commit + redeploy, or inflating the database.
--
--  This migration prepares the table for Supabase Storage-backed media and
--  fixes three features that shipped with no data behind them:
--
--    * service_slug was NULL on all 43 rows, so the service-detail page's
--      gallery query returned empty every time. Backfilled below.
--    * display_order was 0 on all 43 rows, so ordering was inert.
--    * category was free text with no taxonomy, so the admin dropdown and the
--      live data had drifted to two disjoint sets — editing a seeded photo
--      silently reassigned its category. Now driven by a lookup table.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. CATEGORY TAXONOMY
--    A lookup table, not a CHECK constraint or a hardcoded JS array. The old
--    bug was the same list living in two places and drifting; now both the
--    dashboard and the public page read it from one row source via the API.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gallery_categories (
  slug          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  emoji         TEXT DEFAULT '📸',
  display_order INT  DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seeded as the union of what the live data actually uses and what the
-- dashboard offered. Nothing is renamed, so no existing row is orphaned.
INSERT INTO gallery_categories (slug, label, emoji, display_order) VALUES
  ('Weddings',          'Weddings',          '💍', 10),
  ('Ruracio',           'Ruracio',           '🎎', 20),
  ('Corporate',         'Corporate',         '🏢', 30),
  ('Parties',           'Parties',           '🎉', 40),
  ('Audio',             'Audio',             '🎧', 50),
  ('Visual',            'Visual',            '📺', 60),
  ('Equipment',         'Equipment',         '🎛️', 70),
  ('Effects',           'Effects',           '🎆', 80),
  ('Media',             'Media',             '🎥', 90),
  ('Behind the Scenes', 'Behind the Scenes', '🎬', 100),
  ('General',           'General',           '📸', 110)
ON CONFLICT (slug) DO UPDATE
  SET label = EXCLUDED.label,
      emoji = EXCLUDED.emoji,
      display_order = EXCLUDED.display_order;

-- ---------------------------------------------------------------------------
-- 2. NEW COLUMNS
-- ---------------------------------------------------------------------------

-- Accessibility. Distinct from title: a title is a caption for sighted users,
-- alt_text describes the image for someone who cannot see it.
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS alt_text     TEXT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS caption      TEXT;

-- Intrinsic dimensions. Without these the browser cannot reserve space before
-- the image loads, so every photo shifts the masonry layout as it arrives.
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS width        INT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS height       INT;

-- Staging. Lets the manager upload a batch and review before anything is
-- public. Defaults TRUE so every existing row stays visible.
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE;

-- Supabase Storage bookkeeping. NULL for legacy rows that point at repo-static
-- files under /IMAGES/ — those keep working untouched. Only rows uploaded
-- through the new flow carry a storage_path, and only those get their object
-- deleted from the bucket when the row is deleted.
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS mime_type    TEXT;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS file_size    INT;

-- Poster frame for video. The grid must never download video bytes just to
-- show a thumbnail.
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS thumb_url    TEXT;

-- When the event happened, as opposed to created_at = when it was uploaded.
-- The manager uploads last month's wedding today; clients care about the former.
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS event_date   DATE;

-- ---------------------------------------------------------------------------
-- 3. CONSTRAINTS
-- ---------------------------------------------------------------------------

-- Only two media kinds are renderable by the frontend. Anything else would
-- render as a broken tile.
UPDATE gallery SET type = 'image' WHERE type IS NULL OR type NOT IN ('image','video');
ALTER TABLE gallery DROP CONSTRAINT IF EXISTS gallery_type_check;
ALTER TABLE gallery ADD  CONSTRAINT gallery_type_check CHECK (type IN ('image','video'));

-- Point every row at a real taxonomy entry before adding the FK.
UPDATE gallery SET category = 'General'
 WHERE category IS NULL
    OR category NOT IN (SELECT slug FROM gallery_categories);

ALTER TABLE gallery DROP CONSTRAINT IF EXISTS gallery_category_fk;
ALTER TABLE gallery ADD  CONSTRAINT gallery_category_fk
  FOREIGN KEY (category) REFERENCES gallery_categories(slug)
  ON UPDATE CASCADE ON DELETE SET DEFAULT;

-- A video with no poster frame forces the grid to load video bytes to paint a
-- thumbnail. Not enforced as NOT NULL (legacy rows predate the column), but
-- the API requires it on write.

-- ---------------------------------------------------------------------------
-- 4. BACKFILL — activate the two dead features
-- ---------------------------------------------------------------------------

-- service_slug was NULL on every row, so service-detail pages showed no photos
-- at all. The seeded titles map cleanly onto the nine live service slugs.
UPDATE gallery SET service_slug = 'public-address'  WHERE service_slug IS NULL AND title LIKE 'PA System%';
UPDATE gallery SET service_slug = 'drone-services'  WHERE service_slug IS NULL AND title LIKE 'Drone Aerial%';
UPDATE gallery SET service_slug = '360-booth'       WHERE service_slug IS NULL AND title LIKE '360 Booth%';
UPDATE gallery SET service_slug = 'live-streaming'  WHERE service_slug IS NULL AND title LIKE 'Live Streaming%';
UPDATE gallery SET service_slug = 'photography'     WHERE service_slug IS NULL AND title LIKE 'Photography%';
UPDATE gallery SET service_slug = 'pyrotechnics'    WHERE service_slug IS NULL AND title LIKE 'Pyrotechnics%';
UPDATE gallery SET service_slug = 'power-lighting'  WHERE service_slug IS NULL AND title LIKE 'Power & Lighting%';
UPDATE gallery SET service_slug = 'led-screens'     WHERE service_slug IS NULL AND title LIKE 'LED Screen%';
UPDATE gallery SET service_slug = 'dj-mc-services'  WHERE service_slug IS NULL AND title LIKE 'DJ & MC%';

-- display_order was 0 everywhere, so ordering fell through to created_at and
-- the manager had no way to arrange anything. Seed a deterministic sequence
-- per category so drag-to-reorder has something to work against.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY category ORDER BY created_at DESC) * 10 AS pos
    FROM gallery
   WHERE display_order = 0 OR display_order IS NULL
)
UPDATE gallery g SET display_order = r.pos FROM ranked r WHERE g.id = r.id;

-- Alt text defaults to the title. Not ideal copy, but a real description beats
-- an empty alt attribute, and the manager can refine it in the dashboard.
UPDATE gallery SET alt_text = title WHERE alt_text IS NULL OR alt_text = '';

-- Mark legacy repo-static rows so the API knows not to try deleting a Storage
-- object that was never there.
UPDATE gallery SET mime_type = 'image/jpeg'
 WHERE mime_type IS NULL AND image_url LIKE '/IMAGES/%';

-- ---------------------------------------------------------------------------
-- 5. INDEXES — matched to the actual query patterns
-- ---------------------------------------------------------------------------

-- The public list query: published rows, featured first, then display_order.
CREATE INDEX IF NOT EXISTS idx_gallery_public_list
  ON gallery (is_published, is_featured DESC, display_order, created_at DESC);

-- Category filter pills on the public page.
CREATE INDEX IF NOT EXISTS idx_gallery_category_pub
  ON gallery (category, is_published);

-- The service-detail page lookup, now that service_slug actually has values.
CREATE INDEX IF NOT EXISTS idx_gallery_service_pub
  ON gallery (service_slug, is_published) WHERE service_slug IS NOT NULL;

-- Storage reconciliation: find orphaned objects.
CREATE INDEX IF NOT EXISTS idx_gallery_storage_path
  ON gallery (storage_path) WHERE storage_path IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. RLS — public sees published rows only
-- ---------------------------------------------------------------------------
ALTER TABLE gallery            ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_categories ENABLE ROW LEVEL SECURITY;

-- Deliberately NO SELECT policy on storage.objects for the `gallery` bucket.
-- A public bucket serves object URLs without one; adding a policy only enables
-- *listing*, which would let anyone enumerate every uploaded file
-- (Supabase lint 0025, public_bucket_allows_listing).
DROP POLICY IF EXISTS "Public reads gallery bucket" ON storage.objects;

-- Replaces the old blanket "Public reads gallery" USING (TRUE), which would
-- have leaked unpublished drafts the moment is_published started being used.
DROP POLICY IF EXISTS "Public reads gallery"           ON gallery;
DROP POLICY IF EXISTS "Public reads published gallery" ON gallery;
CREATE POLICY "Public reads published gallery"
  ON gallery FOR SELECT USING (is_published = TRUE);

DROP POLICY IF EXISTS "Public reads gallery categories" ON gallery_categories;
CREATE POLICY "Public reads gallery categories"
  ON gallery_categories FOR SELECT USING (is_active = TRUE);

-- ---------------------------------------------------------------------------
-- 7. updated_at trigger (the table had the column but no trigger)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_gallery_updated_at ON gallery;
CREATE TRIGGER trg_gallery_updated_at
  BEFORE UPDATE ON gallery
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
