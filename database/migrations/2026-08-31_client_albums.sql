-- ============================================================================
--  Migration: 2026-08-31  —  CLIENT ALBUMS  (plan phase P4)
--  Safe to re-run (idempotent).
--
--  APPLIED to production on 2026-08-31 as migration `client_albums`.
--  Verified live: all 13 invariants below actually reject a bad write, and the
--  capability-URL flow was walked end to end against the running API — 32
--  checks including the privilege-separation one (an album session key must
--  never authenticate an admin route).
--
--  WHAT THIS IS FOR
--  ----------------
--  After an event the owner has to hand a client several hundred photographs.
--  Today that is a Google Drive folder link, which has three problems: the link
--  cannot be withdrawn once sent, it shows the client a file manager rather
--  than their evening, and it is a dead end — nobody has ever booked a second
--  event from a Drive folder.
--
--  An album fixes all three. It is revocable, it looks like the work, and it
--  carries the setup that was used so the client's cousin can ask for the same
--  one.
--
--  WHY THERE ARE NO ACCOUNTS
--  -------------------------
--  A client receives exactly one album, once, and will open it perhaps four
--  times over a fortnight. Making them register would lose most of them at the
--  first form field, and it would hand this business a password database to
--  protect for no benefit to anybody.
--
--  So access is a capability URL: /a/<token>, where the token is 96 bits of
--  randomness. Holding the link IS the authorisation. That is the same model as
--  a Google Drive share link, with three differences that matter:
--
--    1. The token is stored HASHED. A dump of this table does not open a single
--       album. A leaked Drive link list opens all of them.
--    2. It can be revoked, and rotated, without touching the photographs.
--    3. It can expire.
--
--  An optional PIN adds a second factor for a link that gets forwarded around a
--  family WhatsApp group. It is deliberately optional: for most events the URL
--  is enough, and a mandatory PIN would mean support calls.
--
--  CONSENT IS EXPLICIT AND THE CLIENT'S TO GIVE
--  --------------------------------------------
--  A wedding album is not marketing material until the couple says it is.
--  public_consent is set from the album page by the client, never by the
--  dashboard, and it is what allows a photograph to be copied into the public
--  gallery. Same principle the reviews consent engine already follows.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ALBUMS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS albums (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SHA-256 of the capability token, hex. The token itself is shown to the
  -- owner once, at creation, and is never recoverable from this table — the
  -- same reasoning that applies to a password. Losing it means rotating it,
  -- which is cheap.
  token_hash      TEXT NOT NULL,
  -- First four characters of the token, so the dashboard can tell two album
  -- links apart without being able to reconstruct either.
  token_hint      TEXT NOT NULL,

  title           TEXT NOT NULL,
  client_name     TEXT,
  event_date      DATE,

  -- What the album is FOR, and what makes the loop back to bookings possible:
  -- the services on this booking are the setup the client already chose.
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,

  cover_asset_id  UUID REFERENCES media_assets(id) ON DELETE SET NULL,

  status          TEXT NOT NULL DEFAULT 'draft',

  -- bcrypt. Optional second factor for a forwarded link.
  pin_hash        TEXT,

  expires_at      TIMESTAMPTZ,

  -- The client's decision, made on the album page. Never set from the admin UI.
  public_consent  BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at      TIMESTAMPTZ,

  -- A short note from the owner that opens the album. This is the difference
  -- between a file listing and a hand-over.
  message         TEXT,

  view_count      INT NOT NULL DEFAULT 0,
  last_viewed_at  TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT
);

ALTER TABLE albums DROP CONSTRAINT IF EXISTS albums_status_check;
ALTER TABLE albums ADD CONSTRAINT albums_status_check
  CHECK (status IN ('draft', 'live', 'revoked'));

-- Consent without a timestamp cannot be evidenced later, and the whole point of
-- recording consent is being able to show when it was given.
ALTER TABLE albums DROP CONSTRAINT IF EXISTS albums_consent_has_time;
ALTER TABLE albums ADD CONSTRAINT albums_consent_has_time
  CHECK (public_consent = FALSE OR consent_at IS NOT NULL);

-- The token is the credential. Two albums sharing one would let either client
-- open the other's photographs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_albums_token_hash ON albums (token_hash);

-- The public lookup: hash the presented token, find a live album.
CREATE INDEX IF NOT EXISTS idx_albums_live
  ON albums (token_hash) WHERE status = 'live';

CREATE INDEX IF NOT EXISTS idx_albums_booking ON albums (booking_id);

-- ---------------------------------------------------------------------------
-- 2. ITEMS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS album_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id      UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  asset_id      UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  display_order INT NOT NULL DEFAULT 0,
  caption       TEXT,
  -- Hidden rather than deleted: the owner pulls a photograph the client did not
  -- like without losing it, and can put it back.
  is_hidden     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The same photograph twice in one album is always a mistake.
CREATE UNIQUE INDEX IF NOT EXISTS uq_album_items ON album_items (album_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_album_items_order ON album_items (album_id, display_order);

-- ---------------------------------------------------------------------------
-- 3. VIEWS
--
--    So the owner knows the client actually opened it — which is the cue to
--    ask for a review, and the answer to "did they get the photos?".
--
--    The IP is hashed, never stored. The question worth answering is "how many
--    different people opened this", not "who". A raw IP would make this table
--    personal data about the client's guests for no additional insight.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS album_views (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id   UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash    TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_album_views_album ON album_views (album_id, viewed_at DESC);

-- ---------------------------------------------------------------------------
-- 4. THE PUBLISH GUARD
--
--    An album goes live the moment its link is sent. Sending a client a link to
--    an empty page is the worst possible first impression of the hand-over, and
--    it is an easy mistake: create the album, copy the link, forget to add the
--    photographs.
--
--    Same principle as media_master_guard: if it must never happen, it is a
--    trigger, not a habit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION album_publish_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $guard$
BEGIN
  IF NEW.status = 'live' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'live') THEN
    IF NOT EXISTS (
      SELECT 1
        FROM album_items ai
        JOIN media_assets a ON a.id = ai.asset_id
       WHERE ai.album_id = NEW.id
         AND ai.is_hidden = FALSE
         -- A queued asset has no renditions yet, so it would render as a broken
         -- tile. Only what can actually be displayed counts as content.
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

DROP TRIGGER IF EXISTS trg_album_publish_guard ON albums;
CREATE TRIGGER trg_album_publish_guard
  BEFORE INSERT OR UPDATE ON albums
  FOR EACH ROW EXECUTE FUNCTION album_publish_guard();

-- ---------------------------------------------------------------------------
-- 5. RECORDING A VIEW
--
--    One round trip, and the counter and the log cannot disagree.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_album_view(
  p_album   UUID,
  p_ip_hash TEXT DEFAULT NULL,
  p_ua      TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $view$
BEGIN
  INSERT INTO album_views (album_id, ip_hash, user_agent)
  VALUES (p_album, p_ip_hash, left(p_ua, 300));

  UPDATE albums
     SET view_count = view_count + 1,
         last_viewed_at = NOW()
   WHERE id = p_album;
END;
$view$;

-- ---------------------------------------------------------------------------
-- 6. THE READ MODEL
--
--    Everything the album page and the dashboard need about an album, without
--    either of them having to know how items, assets and bookings join.
--
--    NOTE what is absent: token_hash and pin_hash. The view is what the API
--    selects from, so a careless `select *` in a route cannot leak either.
-- ---------------------------------------------------------------------------
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

  -- The setup the client actually booked. This is the loop: album -> the
  -- services that produced it -> a quote for the same thing.
  COALESCE((
    SELECT jsonb_agg(DISTINCT jsonb_build_object('slug', s.slug, 'name', s.name))
      FROM booking_services bs
      JOIN services s ON s.id = bs.service_id
     WHERE bs.booking_id = al.booking_id
  ), '[]'::jsonb) AS services,

  -- When the full-resolution originals stop being available. Derived from the
  -- retention window in phase P3 — the earliest master expiry across the
  -- album's photographs, because that is the first one to go.
  (SELECT MIN(a.master_expires_at)
     FROM album_items ai
     JOIN media_assets a ON a.id = ai.asset_id
    WHERE ai.album_id = al.id AND a.master_deleted_at IS NULL)
    AS originals_until
FROM albums al;

-- ---------------------------------------------------------------------------
-- 7. RLS. Written and read only by the service key. There is no anon path to
--    these tables at all: authorisation is the capability token, checked in the
--    API, and a row-level policy could not express it without putting the token
--    in the request.
-- ---------------------------------------------------------------------------
ALTER TABLE albums      ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_views ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  albums IS 'Private client galleries reached by capability URL. See /a/<token>.';
COMMENT ON COLUMN albums.token_hash IS 'SHA-256 of the capability token. The token is shown once at creation and is not recoverable from this row.';
COMMENT ON COLUMN albums.public_consent IS 'Set by the CLIENT on the album page, never by the dashboard. Gates use of their photographs in the public gallery.';
COMMENT ON FUNCTION album_publish_guard() IS 'Refuses to publish an album with no visible, processed photographs.';

COMMIT;
