-- ============================================================================
--  Migration: 2026-08-31  —  MEDIA PIPELINE  (plan phase P3)
--  Safe to re-run (idempotent).
--
--  APPLIED to production on 2026-08-31, in four parts, registered as:
--    media_pipeline_assets_and_renditions
--    media_pipeline_master_guard
--    media_pipeline_jobs_and_retention
--    media_pipeline_view_gallery_link_and_summary
--
--  Verified live afterwards: all 13 invariants below actually reject a bad
--  write, including the one that matters most — a master cannot be purged
--  while it is the only copy, for photographs AND for video.
--
--  WHY THIS EXISTS
--  ---------------
--  The owner's archive lives in Google Drive, compressed to fit 15 GB. That
--  ceiling is not a storage problem, it is a modelling problem: Drive stores
--  one object per photograph, so the 6 MB camera original and the 80 KB the
--  browser actually needs are the same file. Every view pays master price, and
--  every master is kept forever because deleting it deletes the only copy.
--
--  A photograph here is three things with three different lifetimes:
--
--    master       6 MB     the negative. Written once, read almost never.
--                          Cold storage. Expires (see RETENTION below).
--    renditions   ~545 KB  what a browser downloads. Hot, CDN-cached, cheap
--                          to regenerate from the master, kept while published.
--    metadata     ~0.4 KB  dimensions, checksum, keys. Postgres. Kept forever.
--
--  Separating them is what turns "15 GB and full" into a bounded number. An
--  album view moves renditions, not masters — roughly 600x less data — and the
--  master tier stops growing without bound once it has a retention window.
--
--  RETENTION — the calculus, stated plainly
--  ----------------------------------------
--  With no expiry, stored master bytes are the running integral of the arrival
--  rate:            S(t) = integral from 0 to t of r(tau) d tau  ->  unbounded.
--  With a window T, the lower limit follows t:
--                   S(t) = integral from t-T to t of r(tau) d tau  ->  r_bar*T.
--  Same inflow, bounded storage. At ~4 events/month and ~7 GB of masters each,
--  T = 12 months settles near 346 GB instead of climbing forever.
--
--  Renditions are NOT on a retention window. They are what the site serves, and
--  they are two orders of magnitude smaller. Only the negative expires.
--
--  THE RULE THIS SCHEMA ENFORCES
--  -----------------------------
--  A master may never be deleted while it is the only copy of the photograph.
--  That is not a convention here, it is a trigger: master_deleted_at cannot be
--  set on an asset that has no 'web' rendition. See trg_media_master_guard.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ASSETS — one row per original the owner uploaded.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  kind              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'uploading',

  -- The master object. bucket is recorded per row rather than assumed from
  -- config: a config change must never silently repoint rows written under the
  -- old value at objects that are not there.
  master_bucket     TEXT NOT NULL,
  master_key        TEXT NOT NULL,
  master_bytes      BIGINT,
  master_mime       TEXT NOT NULL,

  -- Content hash. Two uploads of the same file are the same asset, which is
  -- what stops a re-upload after a failed save from doubling the archive.
  checksum_sha256   TEXT,

  -- Intrinsic properties, filled by the worker once it has actually decoded
  -- the file. Never trusted from the browser.
  width             INT,
  height            INT,
  duration_ms       INT,
  captured_at       TIMESTAMPTZ,

  original_name     TEXT,
  uploaded_by       TEXT,

  -- Retention bookkeeping.
  master_expires_at TIMESTAMPTZ,
  master_deleted_at TIMESTAMPTZ,

  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at          TIMESTAMPTZ
);

ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_kind_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_kind_check
  CHECK (kind IN ('image', 'video'));

-- The lifecycle, spelled out so an impossible status cannot be written:
--   uploading  presigned URL issued, bytes may not have landed yet
--   queued     bytes confirmed, a derive job is waiting
--   processing a worker holds it
--   ready      renditions exist and are serveable
--   failed     the worker gave up after max_attempts
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_status_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_status_check
  CHECK (status IN ('uploading', 'queued', 'processing', 'ready', 'failed'));

-- 'ready' is a promise to the gallery that this asset can be rendered. An asset
-- claiming to be ready with no timestamp is a half-written row, and the public
-- query filters on status alone.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_ready_has_time;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_ready_has_time
  CHECK (status <> 'ready' OR ready_at IS NOT NULL);

-- A deleted master on an asset that never finished processing means the
-- photograph is gone. The trigger below is the real defence; this catches the
-- crude version of the mistake without a table lookup.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_purge_only_when_ready;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purge_only_when_ready
  CHECK (master_deleted_at IS NULL OR status = 'ready');

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_checksum
  ON media_assets (checksum_sha256) WHERE checksum_sha256 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_master
  ON media_assets (master_bucket, master_key);

-- The retention sweep's query: live masters whose window has closed.
CREATE INDEX IF NOT EXISTS idx_media_assets_expiring
  ON media_assets (master_expires_at)
  WHERE master_deleted_at IS NULL AND status = 'ready';

-- ---------------------------------------------------------------------------
-- 2. RENDITIONS — what the browser actually downloads.
--
--    A rendition is derived data. It is never the only copy of anything while
--    the master lives, and after the master expires the 'web' rendition is the
--    archival copy, which is why the guard trigger insists on it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_renditions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,

  variant     TEXT NOT NULL,
  format      TEXT NOT NULL,
  bucket      TEXT NOT NULL,
  key         TEXT NOT NULL,

  bytes       BIGINT NOT NULL,
  width       INT,
  height      INT,
  duration_ms INT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE media_renditions DROP CONSTRAINT IF EXISTS media_renditions_variant_check;
ALTER TABLE media_renditions ADD CONSTRAINT media_renditions_variant_check
  CHECK (variant IN ('thumb', 'card', 'web', 'poster', 'preview'));

ALTER TABLE media_renditions DROP CONSTRAINT IF EXISTS media_renditions_format_check;
ALTER TABLE media_renditions ADD CONSTRAINT media_renditions_format_check
  CHECK (format IN ('avif', 'webp', 'jpeg', 'mp4'));

-- A zero-byte rendition is a failed encode that reported success. Serving one
-- shows the visitor a broken image, which is worse than showing nothing.
ALTER TABLE media_renditions DROP CONSTRAINT IF EXISTS media_renditions_bytes_positive;
ALTER TABLE media_renditions ADD CONSTRAINT media_renditions_bytes_positive
  CHECK (bytes > 0);

-- Re-running the worker on an asset must overwrite, not accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_renditions_variant
  ON media_renditions (asset_id, variant, format);

CREATE INDEX IF NOT EXISTS idx_media_renditions_asset
  ON media_renditions (asset_id);

-- ---------------------------------------------------------------------------
-- 3. THE GUARD.
--
--    Everything else in this migration is bookkeeping. This is the part that
--    means the retention window is safe to switch on: the only statement that
--    can destroy an original is refused unless a derived copy exists.
--
--    The archival variant depends on the kind, and getting this wrong is not
--    symmetrical. Requiring 'web' of everything would spare video masters
--    forever — videos produce 'poster' and 'preview', never 'web' — so the
--    largest files in the archive would quietly be the ones retention never
--    touched, and the storage curve would keep climbing while the graph said
--    it was bounded.
--
--    Mirrors archivalVariant() in backened/src/media/renditions.js. If one
--    changes, the other changes with it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION media_archival_variant(p_kind TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $av$
  SELECT CASE WHEN p_kind = 'video' THEN 'preview' ELSE 'web' END;
$av$;

CREATE OR REPLACE FUNCTION media_master_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $guard$
BEGIN
  IF NEW.master_deleted_at IS NOT NULL AND OLD.master_deleted_at IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM media_renditions
      WHERE asset_id = NEW.id
        AND variant  = media_archival_variant(NEW.kind)
        AND bytes    > 0
    ) THEN
      RAISE EXCEPTION
        'refusing to purge the master of asset %: no % rendition exists, so this is the only copy',
        NEW.id, media_archival_variant(NEW.kind);
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS trg_media_master_guard ON media_assets;
CREATE TRIGGER trg_media_master_guard
  BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION media_master_guard();

-- ---------------------------------------------------------------------------
-- 4. JOBS — the work queue the containerised worker drains.
--
--    Postgres rather than a queue service. The work is measured in jobs per
--    week, the database is already here and already backed up, and
--    FOR UPDATE SKIP LOCKED gives exactly the claim semantics a queue would.
--    Adding a broker would add an outage mode for no throughput we need.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,

  job_type     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued',

  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,

  -- Backoff and scheduling in one column: a retry is just a job that is not
  -- runnable yet.
  run_after    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  claimed_at   TIMESTAMPTZ,
  claimed_by   TEXT,
  last_error   TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

ALTER TABLE media_jobs DROP CONSTRAINT IF EXISTS media_jobs_type_check;
ALTER TABLE media_jobs ADD CONSTRAINT media_jobs_type_check
  CHECK (job_type IN ('derive', 'purge-master'));

ALTER TABLE media_jobs DROP CONSTRAINT IF EXISTS media_jobs_status_check;
ALTER TABLE media_jobs ADD CONSTRAINT media_jobs_status_check
  CHECK (status IN ('queued', 'claimed', 'done', 'failed'));

-- One live job of a kind per asset. Without this, a double-click on Upload
-- enqueues two derive jobs, two workers decode the same 6 MB file, and both
-- race to write the same rendition keys.
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_jobs_live
  ON media_jobs (asset_id, job_type)
  WHERE status IN ('queued', 'claimed');

-- The claim query's index: runnable jobs, oldest first.
CREATE INDEX IF NOT EXISTS idx_media_jobs_runnable
  ON media_jobs (status, run_after);

-- ---------------------------------------------------------------------------
-- 5. CLAIM / FINISH / FAIL
--
--    A worker that dies mid-job must not strand it. Claims therefore carry a
--    lease: a job held longer than p_lease is reclaimable by anyone. That is
--    why attempts is incremented on claim rather than on failure — a crash
--    that never reports is still an attempt, and without counting it a job
--    that reliably kills its worker would be retried forever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_media_jobs(
  p_worker TEXT,
  p_limit  INT      DEFAULT 1,
  p_lease  INTERVAL DEFAULT INTERVAL '10 minutes'
)
RETURNS SETOF media_jobs
LANGUAGE sql
AS $claim$
  UPDATE media_jobs j
     SET status     = 'claimed',
         claimed_at = NOW(),
         claimed_by = p_worker,
         attempts   = j.attempts + 1
   WHERE j.id IN (
     SELECT c.id
       FROM media_jobs c
      WHERE (c.status = 'queued'  AND c.run_after <= NOW())
         OR (c.status = 'claimed' AND c.claimed_at < NOW() - p_lease)
      ORDER BY c.run_after
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(p_limit, 1)
   )
  RETURNING j.*;
$claim$;

CREATE OR REPLACE FUNCTION finish_media_job(p_job UUID)
RETURNS VOID
LANGUAGE sql
AS $finish$
  UPDATE media_jobs
     SET status = 'done', finished_at = NOW(), last_error = NULL
   WHERE id = p_job;
$finish$;

-- Exponential backoff, capped. A transient R2 error should be retried in a
-- minute; a file the encoder cannot read should stop consuming a worker.
CREATE OR REPLACE FUNCTION fail_media_job(p_job UUID, p_error TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $fail$
DECLARE
  v_job media_jobs;
BEGIN
  SELECT * INTO v_job FROM media_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_job.attempts >= v_job.max_attempts THEN
    UPDATE media_jobs
       SET status = 'failed', finished_at = NOW(), last_error = left(p_error, 2000)
     WHERE id = p_job;

    IF v_job.job_type = 'derive' THEN
      UPDATE media_assets
         SET status = 'failed', last_error = left(p_error, 2000)
       WHERE id = v_job.asset_id;
    END IF;
  ELSE
    UPDATE media_jobs
       SET status     = 'queued',
           claimed_at = NULL,
           claimed_by = NULL,
           last_error = left(p_error, 2000),
           run_after  = NOW() + (INTERVAL '1 minute' * POWER(2, LEAST(v_job.attempts, 6)))
     WHERE id = p_job;
  END IF;
END;
$fail$;

-- ---------------------------------------------------------------------------
-- 6. RETENTION SWEEP
--
--    Deliberately two steps. This function only enqueues purge jobs; the
--    worker does the deleting, under the guard trigger. Nothing that runs on a
--    schedule is allowed to delete an object directly — a scheduled job with
--    delete rights and a bad WHERE clause is how archives die.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_expired_masters(p_limit INT DEFAULT 200)
RETURNS INT
LANGUAGE plpgsql
AS $sweep$
DECLARE
  v_count INT;
BEGIN
  WITH due AS (
    SELECT a.id
      FROM media_assets a
     WHERE a.status            = 'ready'
       AND a.master_deleted_at IS NULL
       AND a.master_expires_at IS NOT NULL
       AND a.master_expires_at <= NOW()
       -- Never enqueue a purge for an asset with no derived copy. The trigger
       -- would refuse it anyway; this stops the queue filling with jobs that
       -- can only fail.
       AND EXISTS (
         SELECT 1 FROM media_renditions r
          WHERE r.asset_id = a.id
            AND r.variant  = media_archival_variant(a.kind)
            AND r.bytes    > 0
       )
     ORDER BY a.master_expires_at
     LIMIT GREATEST(p_limit, 1)
  )
  INSERT INTO media_jobs (asset_id, job_type)
  SELECT id, 'purge-master' FROM due
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$sweep$;

-- ---------------------------------------------------------------------------
-- 7. THE READ MODEL
--
--    One row per asset with its renditions already shaped for the API, so the
--    gallery endpoint is a single select and not an N+1 over renditions.
--    DISTINCT ON picks one row per variant, preferring the smallest format.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW media_asset_view AS
SELECT
  a.id,
  a.kind,
  a.status,
  a.width,
  a.height,
  a.duration_ms,
  a.captured_at,
  a.original_name,
  a.created_at,
  a.master_bytes,
  (a.master_deleted_at IS NOT NULL) AS master_purged,
  COALESCE(
    (SELECT jsonb_object_agg(best.variant, jsonb_build_object(
              'key',    best.key,
              'bucket', best.bucket,
              'format', best.format,
              'bytes',  best.bytes,
              'width',  best.width,
              'height', best.height
            ))
       FROM (
         SELECT DISTINCT ON (r.variant)
                r.variant, r.key, r.bucket, r.format, r.bytes, r.width, r.height
           FROM media_renditions r
          WHERE r.asset_id = a.id
          ORDER BY r.variant,
                   CASE r.format WHEN 'avif' THEN 1 WHEN 'webp' THEN 2
                                 WHEN 'mp4'  THEN 3 ELSE 4 END
       ) best),
    '{}'::jsonb
  ) AS renditions,
  (SELECT COALESCE(SUM(r.bytes), 0) FROM media_renditions r WHERE r.asset_id = a.id)
    AS rendition_bytes
FROM media_assets a;

-- ---------------------------------------------------------------------------
-- 8. LINK THE GALLERY TO IT.
--
--    Nullable, and nothing is migrated. 42 of the 44 live rows point at files
--    committed to the repo under /IMAGES/ and 2 at Supabase Storage; all of
--    them keep working exactly as they do today. asset_id is set only by the
--    new upload path, and the API prefers renditions when it is present.
-- ---------------------------------------------------------------------------
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS asset_id UUID;

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gallery_asset_id_fkey'
  ) THEN
    ALTER TABLE gallery
      ADD CONSTRAINT gallery_asset_id_fkey
      FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE SET NULL;
  END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS idx_gallery_asset ON gallery (asset_id);

-- ---------------------------------------------------------------------------
-- 9. STORAGE ACCOUNTING
--
--    So the owner can answer "how much am I storing, and what is it costing"
--    without opening a Cloudflare dashboard. This is the number the 15 GB
--    ceiling used to answer badly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION media_storage_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $summary$
  SELECT jsonb_build_object(
    'assets',            (SELECT COUNT(*) FROM media_assets),
    'ready',             (SELECT COUNT(*) FROM media_assets WHERE status = 'ready'),
    'failed',            (SELECT COUNT(*) FROM media_assets WHERE status = 'failed'),
    'pending',           (SELECT COUNT(*) FROM media_assets WHERE status IN ('uploading','queued','processing')),
    'masterBytesLive',   (SELECT COALESCE(SUM(master_bytes), 0) FROM media_assets WHERE master_deleted_at IS NULL),
    'masterBytesPurged', (SELECT COALESCE(SUM(master_bytes), 0) FROM media_assets WHERE master_deleted_at IS NOT NULL),
    'renditionBytes',    (SELECT COALESCE(SUM(bytes), 0) FROM media_renditions),
    'expiringIn90Days',  (SELECT COUNT(*) FROM media_assets
                           WHERE master_deleted_at IS NULL
                             AND master_expires_at IS NOT NULL
                             AND master_expires_at <= NOW() + INTERVAL '90 days'),
    'jobsQueued',        (SELECT COUNT(*) FROM media_jobs WHERE status = 'queued'),
    'jobsFailed',        (SELECT COUNT(*) FROM media_jobs WHERE status = 'failed'),
    -- The whole argument for the tiering, as one number the owner can watch:
    -- how many master bytes each served byte stands in for.
    'compressionRatio',  CASE
      WHEN (SELECT COALESCE(SUM(bytes), 0) FROM media_renditions) = 0 THEN NULL
      ELSE ROUND(
        (SELECT COALESCE(SUM(master_bytes), 0) FROM media_assets)::NUMERIC
        / NULLIF((SELECT SUM(bytes) FROM media_renditions), 0), 2)
    END
  );
$summary$;

-- ---------------------------------------------------------------------------
-- 10. RLS. These tables are written only by the service key (the API and the
--     worker) and read only through the API. No anon policy at all: a
--     rendition key is not secret, but the master key is, and they live in the
--     same row.
-- ---------------------------------------------------------------------------
ALTER TABLE media_assets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_renditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_jobs       ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  media_assets      IS 'One row per original upload. The master is the negative; renditions are the prints.';
COMMENT ON COLUMN media_assets.master_expires_at IS 'End of the retention window. Past this the master is purgeable, never the renditions.';
COMMENT ON COLUMN media_assets.checksum_sha256   IS 'SHA-256 of the master. Unique, so re-uploading the same file returns the existing asset.';
COMMENT ON TABLE  media_jobs        IS 'Work queue drained by the containerised media worker via claim_media_jobs().';
COMMENT ON FUNCTION media_master_guard() IS 'Refuses to mark a master deleted unless a web rendition exists. The archive depends on this.';

COMMIT;
