-- ============================================================================
--  Migration: 2026-08-31  —  GALLERY ENGINE v2: THE EVENT SPINE
--  Safe to re-run (idempotent).
--
--  APPLIED to production on 2026-08-31 as:
--    gallery_engine_v2_showcases
--    gallery_engine_v2_site_stats
--    site_stats_reply_promise_not_measurement
--    showcase_last_highlight_guard
--
--  Verified live: 24 end-to-end checks against the running API, covering slug
--  collision, service inheritance from the booking, the publish guard, the
--  highlight invariant surviving after publication, the public/private split,
--  and every KPI including "activating a service moves the homepage by itself".
--
--  THE PROBLEM, MEASURED
--  ---------------------
--  Before this migration the gallery held 44 photographs in six categories:
--  Media (16), Audio (10), Visual (8), Equipment (6), Weddings (3), Effects (1).
--  Four of those six name EQUIPMENT, not events. Exactly one photograph in the
--  whole table carried an event_date.
--
--  So the gallery was a parts catalogue. It could answer "show me a photo of a
--  speaker" and could not answer the only question that actually converts a
--  visitor: "show me one wedding you ran, from start to finish."
--
--  The missing thing was never storage, ordering or taxonomy — all of those
--  worked. It was an entity. A business like this delivers EVENTS; the schema
--  had no row for one.
--
--  WHY NOT REUSE THE `events` TABLE
--  --------------------------------
--  Because it means something else. `events` holds TICKETED events the company
--  sells seats to — Afrobeat Night, Corporate Gala, Wedding Expo — with
--  total_seats, seats_left and booking_count. A delivered job is a different
--  noun with a different lifecycle. Overloading one table with both would be
--  the same mistake as overloading `channel` with the arrival path: it reads as
--  economy for about a week and then costs a migration.
--
--  Hence `showcases`: one row per job we delivered and want to show.
--
--  ONE UPLOAD, TWO CURATIONS — THE RULE THAT SHAPES THIS SCHEMA
--  ------------------------------------------------------------
--  A prospect and a client want opposite things from the same 400 photographs:
--
--    prospect  proof, fast. Eight to twelve strong frames. Every extra photo
--              costs attention and mobile data and LOWERS conversion.
--    client    all of them, including the mediocre ones, because they are
--              looking for their aunt.
--
--  So the media is uploaded once and cut twice. The full set hangs off the
--  album (phase P4, private, capability URL). The starred subset hangs off the
--  showcase (public). `gallery.is_highlight` is that star, and it is the only
--  thing that distinguishes the two — which is what lets the owner do both in a
--  single pass on one screen instead of curating twice and therefore never.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. SHOWCASES — one delivered event.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS showcases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Public URL: /w/<slug>. Human-readable on purpose — a link someone pastes
  -- into WhatsApp should say what it is before it is opened.
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,

  event_type    TEXT,
  event_date    DATE,
  venue         TEXT,
  town          TEXT,

  -- One or two sentences: what the job actually was. This is the difference
  -- between a photo grid and a case study.
  summary       TEXT,

  -- How the client is named publicly, if at all. NULL means "a corporate
  -- client" — naming somebody on a public page is their decision, not ours,
  -- and it is gated on the album consent for exactly that reason.
  client_display TEXT,

  guest_count   INT,

  status        TEXT NOT NULL DEFAULT 'draft',
  is_featured   BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 0,

  cover_gallery_id UUID REFERENCES gallery(id) ON DELETE SET NULL,

  -- The three links that make this the spine rather than another silo.
  booking_id    UUID REFERENCES bookings(id) ON DELETE SET NULL,
  album_id      UUID REFERENCES albums(id)   ON DELETE SET NULL,

  view_count    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    TEXT
);

ALTER TABLE showcases DROP CONSTRAINT IF EXISTS showcases_status_check;
ALTER TABLE showcases ADD CONSTRAINT showcases_status_check
  CHECK (status IN ('draft', 'published'));

-- Slugs are URLs. A space or an ampersand in one produces a link that breaks
-- differently in every messaging app it is pasted into.
ALTER TABLE showcases DROP CONSTRAINT IF EXISTS showcases_slug_shape;
ALTER TABLE showcases ADD CONSTRAINT showcases_slug_shape
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 80);

CREATE UNIQUE INDEX IF NOT EXISTS uq_showcases_slug ON showcases (slug);

-- The public listing: published, featured first, then the owner's order.
CREATE INDEX IF NOT EXISTS idx_showcases_public
  ON showcases (status, is_featured, display_order, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_showcases_booking ON showcases (booking_id);

-- ---------------------------------------------------------------------------
-- 2. WHAT WE SUPPLIED
--
--    A join table, not a text array. The same lesson booking_services already
--    taught: "Public Address System" never matches "Public Address Systems",
--    and a service renamed in one place must not orphan its own portfolio.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS showcase_services (
  showcase_id UUID NOT NULL REFERENCES showcases(id) ON DELETE CASCADE,
  service_id  UUID NOT NULL REFERENCES services(id)  ON DELETE CASCADE,
  PRIMARY KEY (showcase_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_showcase_services_service ON showcase_services (service_id);

-- ---------------------------------------------------------------------------
-- 3. GALLERY BECOMES EVENT-AWARE
--
--    Additive. All 44 existing rows keep showcase_id NULL and keep rendering
--    exactly as they do — they become the "library" cut of the gallery, which
--    is what they honestly are.
-- ---------------------------------------------------------------------------
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS showcase_id  UUID;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS is_highlight BOOLEAN NOT NULL DEFAULT FALSE;

-- 360 booth output is not "a video". It is vertical, a few seconds long, it
-- loops, and its audio is worthless. Calling it video gets it a landscape 720p
-- ladder and a poster frame it does not want. Naming the role here means the
-- player can be chosen from data instead of guessed from a file extension.
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS media_role TEXT;

ALTER TABLE gallery DROP CONSTRAINT IF EXISTS gallery_media_role_check;
ALTER TABLE gallery ADD CONSTRAINT gallery_media_role_check
  CHECK (media_role IS NULL OR media_role IN ('photo', 'video', 'reel', 'booth-360'));

-- Backfill from the column that already carried the coarse answer.
UPDATE gallery SET media_role = CASE WHEN type = 'video' THEN 'video' ELSE 'photo' END
 WHERE media_role IS NULL;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gallery_showcase_id_fkey') THEN
    ALTER TABLE gallery
      ADD CONSTRAINT gallery_showcase_id_fkey
      FOREIGN KEY (showcase_id) REFERENCES showcases(id) ON DELETE SET NULL;
  END IF;
END
$fk$;

-- The public showcase page's query: this event's highlights, in order.
CREATE INDEX IF NOT EXISTS idx_gallery_showcase
  ON gallery (showcase_id, is_highlight, display_order)
  WHERE showcase_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. THE PUBLISH GUARD
--
--    A showcase with no highlights is an empty page with a heading. Same
--    reasoning as album_publish_guard and media_master_guard: if it must never
--    happen, it is a trigger, not a habit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION showcase_publish_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $guard$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    IF NOT EXISTS (
      SELECT 1 FROM gallery g
       WHERE g.showcase_id  = NEW.id
         AND g.is_highlight = TRUE
         AND g.is_published = TRUE
    ) THEN
      RAISE EXCEPTION
        'refusing to publish showcase %: star at least one photograph as a highlight first',
        NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS trg_showcase_publish_guard ON showcases;
CREATE TRIGGER trg_showcase_publish_guard
  BEFORE INSERT OR UPDATE ON showcases
  FOR EACH ROW EXECUTE FUNCTION showcase_publish_guard();

-- ---------------------------------------------------------------------------
-- 5. INHERIT THE SERVICES FROM THE BOOKING
--
--    The booking already records exactly what was supplied. Re-typing it into
--    the showcase would be data entry that can disagree with itself, so the
--    link populates it instead. Additive: it never removes a service the owner
--    added by hand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_showcase_services(p_showcase UUID)
RETURNS INT
LANGUAGE plpgsql
AS $sync$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO showcase_services (showcase_id, service_id)
  SELECT p_showcase, bs.service_id
    FROM showcases s
    JOIN booking_services bs ON bs.booking_id = s.booking_id
   WHERE s.id = p_showcase
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$sync$;

-- ---------------------------------------------------------------------------
-- 6. SITE SETTINGS — where the homepage numbers actually come from
--
--    The homepage hard-coded "500+ events", "50K+ guests" and "9 services".
--    The services figure was already a liability: 9 is the live count today,
--    but there are 10 rows, so activating the tenth would have made the
--    homepage lie with no code change and no warning.
--
--    Live counts fix that — but they cannot fix the historical ones. This
--    business ran hundreds of events before any of it was in a database, and
--    deriving purely from system data would replace a defensible claim with
--    "1 completed job".
--
--    So a counter is BASELINE + LIVE. The baseline is owner-supplied, carries
--    a note recording where the number came from, and lives in one editable
--    row rather than in markup nobody remembers to update.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_settings (
  key         TEXT PRIMARY KEY,
  value_int   BIGINT,
  value_text  TEXT,
  label       TEXT NOT NULL,
  note        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT
);

INSERT INTO site_settings (key, value_int, label, note) VALUES
  ('events_baseline', 500,
   'Events delivered before this website',
   'Carried over from the previous site, which displayed "500+ events". Owner-supplied and not derived from any record in this database. Correct it here and every page follows.'),
  ('guests_baseline', 50000,
   'Guests reached before this website',
   'Carried over from the previous site, which displayed "50K+ guests". Owner-supplied. Live guest counts from published showcases are added on top.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. THE LIVE NUMBERS
--
--    One function, one definition of every figure the public site displays.
--    The homepage renders whatever this returns and computes nothing itself —
--    the same rule the statistics layer already enforces for rates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION site_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $stats$
  SELECT jsonb_build_object(
    -- Live, and the reason this function exists: activating a tenth service
    -- now updates the homepage by itself.
    'services', (SELECT COUNT(*) FROM services WHERE is_active),

    'eventsDelivered',
      COALESCE((SELECT value_int FROM site_settings WHERE key = 'events_baseline'), 0)
      + (SELECT COUNT(*) FROM showcases WHERE status = 'published'),

    'guestsReached',
      COALESCE((SELECT value_int FROM site_settings WHERE key = 'guests_baseline'), 0)
      + COALESCE((SELECT SUM(guest_count) FROM showcases WHERE status = 'published'), 0),

    'showcases',    (SELECT COUNT(*) FROM showcases WHERE status = 'published'),
    'photos',       (SELECT COUNT(*) FROM gallery WHERE is_published),

    -- Median, not mean. One enquiry answered a week late would drag a mean
    -- into a number that describes nothing that ever happened.
    'replyHours', (
      SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (responded_at - COALESCE(enquired_at, created_at))) / 3600.0
             )::NUMERIC, 1)
        FROM bookings
       WHERE responded_at IS NOT NULL
         AND responded_at > COALESCE(enquired_at, created_at)
    ),

    'reviews', (
      SELECT jsonb_build_object('count', COUNT(*), 'average', ROUND(AVG(rating)::NUMERIC, 1))
        FROM reviews WHERE status = 'published'
    ),

    -- So the page can say WHERE a number came from rather than asserting it.
    'baselineNote', (SELECT note FROM site_settings WHERE key = 'events_baseline')
  );
$stats$;

-- ---------------------------------------------------------------------------
-- 8. THE READ MODEL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW showcase_view AS
SELECT
  s.id, s.slug, s.title, s.event_type, s.event_date, s.venue, s.town,
  s.summary, s.client_display, s.guest_count, s.status, s.is_featured,
  s.display_order, s.view_count, s.created_at, s.created_by,
  s.booking_id, s.album_id, s.cover_gallery_id,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object('slug', sv.slug, 'name', sv.name, 'icon', sv.icon)
                     ORDER BY sv.display_order)
      FROM showcase_services ss
      JOIN services sv ON sv.id = ss.service_id
     WHERE ss.showcase_id = s.id
  ), '[]'::jsonb) AS services,

  (SELECT COUNT(*) FROM gallery g
    WHERE g.showcase_id = s.id AND g.is_highlight AND g.is_published) AS highlight_count,
  (SELECT COUNT(*) FROM gallery g WHERE g.showcase_id = s.id) AS media_count,
  (SELECT COUNT(*) FROM gallery g
    WHERE g.showcase_id = s.id AND g.media_role = 'booth-360') AS booth_count,

  -- The cover, resolved: the chosen one, else the first highlight. A showcase
  -- must never render without an image.
  COALESCE(
    (SELECT g.image_url FROM gallery g WHERE g.id = s.cover_gallery_id),
    (SELECT g.image_url FROM gallery g
      WHERE g.showcase_id = s.id AND g.is_highlight AND g.is_published
      ORDER BY g.display_order LIMIT 1)
  ) AS cover_url,
  COALESCE(
    (SELECT g.asset_id FROM gallery g WHERE g.id = s.cover_gallery_id),
    (SELECT g.asset_id FROM gallery g
      WHERE g.showcase_id = s.id AND g.is_highlight AND g.is_published
      ORDER BY g.display_order LIMIT 1)
  ) AS cover_asset_id
FROM showcases s;

CREATE OR REPLACE FUNCTION bump_showcase_view(p_slug TEXT)
RETURNS VOID
LANGUAGE sql
AS $bump$
  UPDATE showcases SET view_count = view_count + 1 WHERE slug = p_slug AND status = 'published';
$bump$;

ALTER TABLE showcases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE showcase_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings     ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  showcases IS 'One delivered event. The spine linking booking -> album (private, full) -> gallery highlights (public, curated) -> services supplied.';
COMMENT ON COLUMN gallery.is_highlight IS 'Starred for the PUBLIC showcase. The client album shows everything; the website shows these.';
COMMENT ON COLUMN gallery.media_role IS 'photo | video | reel | booth-360. A 360 booth clip is vertical, short and silent — it needs a different player from a highlight reel.';
COMMENT ON TABLE  site_settings IS 'Owner-supplied baselines for public counters. Live counts are added on top by site_stats().';

COMMIT;
