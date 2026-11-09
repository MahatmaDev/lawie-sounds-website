BEGIN;

ALTER TABLE albums
  ADD COLUMN IF NOT EXISTS passcode_type TEXT NOT NULL DEFAULT 'pin',
  ADD COLUMN IF NOT EXISTS passcode_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS consent_version TEXT;

ALTER TABLE albums DROP CONSTRAINT IF EXISTS albums_passcode_type_check;
ALTER TABLE albums ADD CONSTRAINT albums_passcode_type_check
  CHECK (passcode_type IN ('pin', 'password'));

UPDATE albums
   SET status = 'draft'
 WHERE status = 'live' AND passcode_version < 2;

ALTER TABLE gallery
  ADD COLUMN IF NOT EXISTS consent_album_id UUID;

CREATE INDEX IF NOT EXISTS idx_gallery_consent_album
  ON gallery (consent_album_id) WHERE consent_album_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS album_consent_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id        UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  granted         BOOLEAN NOT NULL,
  consent_version TEXT NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash         TEXT,
  user_agent      TEXT
);

CREATE INDEX IF NOT EXISTS idx_album_consent_events_album
  ON album_consent_events (album_id, recorded_at DESC);

ALTER TABLE album_consent_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION record_album_consent(
  p_album       UUID,
  p_granted     BOOLEAN,
  p_version     TEXT,
  p_ip_hash     TEXT DEFAULT NULL,
  p_user_agent  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $consent$
BEGIN
  UPDATE albums
     SET public_consent = p_granted,
         consent_at = CASE WHEN p_granted THEN NOW() ELSE NULL END,
         consent_version = CASE WHEN p_granted THEN p_version ELSE NULL END
   WHERE id = p_album;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'album % not found', p_album;
  END IF;

  IF NOT p_granted THEN
    UPDATE gallery
       SET is_published = FALSE,
           is_featured = FALSE
     WHERE consent_album_id = p_album;
  END IF;

  INSERT INTO album_consent_events (album_id, granted, consent_version, ip_hash, user_agent)
  VALUES (p_album, p_granted, p_version, p_ip_hash, left(p_user_agent, 300));
END;
$consent$;

CREATE OR REPLACE FUNCTION guard_album_gallery_consent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $guard$
BEGIN
  IF NEW.is_published AND NEW.consent_album_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM albums al
     WHERE al.id = NEW.consent_album_id
       AND al.public_consent = TRUE
       AND al.consent_version = 'public-use-v1'
  ) THEN
    RAISE EXCEPTION 'refusing to publish gallery media: the source album has no current client consent';
  END IF;
  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS trg_gallery_album_consent_guard ON gallery;
CREATE TRIGGER trg_gallery_album_consent_guard
  BEFORE INSERT OR UPDATE OF is_published, consent_album_id ON gallery
  FOR EACH ROW EXECUTE FUNCTION guard_album_gallery_consent();

CREATE OR REPLACE FUNCTION album_publish_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $guard$
BEGIN
  IF NEW.status = 'live' AND (NEW.pin_hash IS NULL OR NEW.passcode_version < 2) THEN
    RAISE EXCEPTION 'refusing to publish album %: a client passcode is required', NEW.id;
  END IF;
  IF NEW.status = 'live' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'live') THEN
    IF NOT EXISTS (
      SELECT 1
        FROM album_items ai
        JOIN media_assets a ON a.id = ai.asset_id
       WHERE ai.album_id = NEW.id
         AND ai.is_hidden = FALSE
         AND a.status = 'ready'
    ) THEN
      RAISE EXCEPTION
        'refusing to publish album %: it has no visible, processed photographs yet',
        NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

CREATE OR REPLACE VIEW album_view AS
SELECT
  al.id,
  al.title,
  al.client_name,
  al.event_date,
  al.status,
  al.token_hint,
  al.message,
  al.expires_at,
  al.public_consent,
  al.consent_at,
  al.view_count,
  al.last_viewed_at,
  al.created_at,
  al.created_by,
  al.booking_id,
  al.cover_asset_id,
  (al.pin_hash IS NOT NULL) AS pin_required,
  (SELECT COUNT(*) FROM album_items ai WHERE ai.album_id = al.id AND ai.is_hidden = FALSE)
    AS item_count,
  (SELECT COUNT(*) FROM album_items ai WHERE ai.album_id = al.id AND ai.is_hidden)
    AS hidden_count,
  COALESCE((
    SELECT jsonb_agg(DISTINCT jsonb_build_object('slug', s.slug, 'name', s.name))
      FROM booking_services bs
      JOIN services s ON s.id = bs.service_id
     WHERE bs.booking_id = al.booking_id
  ), '[]'::jsonb) AS services,
  (SELECT MIN(a.master_expires_at)
     FROM album_items ai
     JOIN media_assets a ON a.id = ai.asset_id
    WHERE ai.album_id = al.id AND a.master_deleted_at IS NULL)
    AS originals_until,
  al.passcode_type,
  al.passcode_version,
  al.consent_version
FROM albums al;

COMMENT ON TABLE album_consent_events IS
  'Append-only record of the client granting or withdrawing permission to use album media publicly.';
COMMENT ON COLUMN albums.passcode_type IS
  'Client access code type. The code itself is stored only as a salted scrypt hash in pin_hash.';

COMMIT;