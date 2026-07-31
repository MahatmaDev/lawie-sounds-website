-- ============================================================================
--  Migration: 2026-08-04  —  POSTER MEDIA ENGINE
--  Applied to production on 2026-08-04. Safe to re-run.
--
--  WHY: "Create New Poster" could not accept a video from the manager's
--  computer. Choosing "Video / Reel" hid the upload control entirely and left
--  only a URL box, so the only way to post a reel was to host it somewhere else
--  first. Images could be uploaded, but were base64-encoded into image_url —
--  stored inside Postgres and re-sent, in full, to every homepage visitor.
--
--  Posters now use the same storage-backed shape as the gallery: the browser
--  uploads straight to Supabase Storage with a signed URL, and only the
--  resulting public URL is stored here.
-- ============================================================================

BEGIN;

ALTER TABLE posters
  ADD COLUMN IF NOT EXISTS media_type   TEXT DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS thumb_url    TEXT,
  ADD COLUMN IF NOT EXISTS thumb_path   TEXT,
  ADD COLUMN IF NOT EXISTS mime_type    TEXT,
  ADD COLUMN IF NOT EXISTS file_size    BIGINT,
  ADD COLUMN IF NOT EXISTS width        INT,
  ADD COLUMN IF NOT EXISTS height       INT;

-- A poster is either a still or a moving image. The homepage needs to know
-- which without parsing the URL — and a YouTube link has no file extension to
-- parse in the first place.
ALTER TABLE posters DROP CONSTRAINT IF EXISTS posters_media_type_check;
ALTER TABLE posters ADD CONSTRAINT posters_media_type_check
  CHECK (media_type IN ('image', 'video'));

-- Stop base64 coming back. One such row in the gallery table reached 431 KB and
-- was 98% of that endpoint's entire response. Enforcing it here means no future
-- code path can reintroduce it quietly.
ALTER TABLE posters DROP CONSTRAINT IF EXISTS posters_image_url_not_inline;
ALTER TABLE posters ADD CONSTRAINT posters_image_url_not_inline
  CHECK (image_url NOT LIKE 'data:%');

-- A hosted video needs a still to show before it decodes, and as the fallback
-- when autoplay is refused — which it is by default on iOS Low Power Mode and
-- whenever the visitor has data saver on. Embeds carry their own.
ALTER TABLE posters DROP CONSTRAINT IF EXISTS posters_video_needs_thumb;
ALTER TABLE posters ADD CONSTRAINT posters_video_needs_thumb
  CHECK (media_type <> 'video' OR thumb_url IS NOT NULL OR image_url ~* '(youtube|youtu\.be|vimeo)');

-- The public homepage query is "active posters, in order, within their window".
CREATE INDEX IF NOT EXISTS idx_posters_live
  ON posters (is_active, display_order, start_date, end_date);

COMMENT ON COLUMN posters.storage_path IS
  'Key inside the gallery bucket under posters/. Kept so deleting a poster can remove its object instead of orphaning it.';
COMMENT ON COLUMN posters.thumb_path IS
  'Key of the frame captured from a video. thumb_url is a public CDN URL and cannot be used to delete the object.';

COMMIT;

-- Poster media lives in the existing `gallery` bucket under a posters/ prefix
-- rather than in a bucket of its own. That bucket already has the correct MIME
-- allow-list, the 50 MB ceiling and a proven public-read policy; a second bucket
-- would duplicate all three and add new policy surface for no functional gain.
-- Listings are always driven by this table, never by enumerating the bucket, so
-- the two sets never mix.
