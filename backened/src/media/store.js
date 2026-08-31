// ============================================================================
//  OBJECT STORE — two buckets, one protocol.
//
//  WHY TWO BUCKETS AND NOT ONE
//  ---------------------------
//  Because they have opposite access rules and opposite lifetimes, and a single
//  bucket cannot hold both without one of them being wrong:
//
//    masters      private, never public, read ~once (by the worker), on a
//                 retention window. Losing one loses a photograph.
//    derivatives  public, CDN-cached, read constantly, kept while published,
//                 and reproducible from a master at any time.
//
//  Putting them together means either the masters are reachable by URL, or the
//  derivatives are not cacheable by the CDN. Two buckets costs nothing — object
//  storage is priced by byte, not by bucket — and makes the retention sweep a
//  bucket-scoped operation, so a bad prefix can never reach the derived copies.
//
//  WHY CLOUDFLARE R2 AND NOT SUPABASE STORAGE
//  ------------------------------------------
//  Egress. Supabase Storage bills roughly $0.09/GB out; R2 bills zero. A
//  gallery is almost pure egress — every visitor downloads, nobody uploads —
//  so egress is the entire bill at scale. At 200 GB of viewing a month that is
//  the difference between ~$18 and ~$0. Storage itself is $0.015/GB-month
//  either way, near enough.
//
//  Supabase Storage is NOT removed. It still holds everything uploaded before
//  this pipeline existed, the driver below falls back to it when R2 is not
//  configured, and nothing already live changes. A storage migration that
//  requires a flag day is a storage migration that does not happen.
// ============================================================================

const crypto = require('crypto');
const { presign } = require('./sigv4');

const MASTER_RETENTION_MONTHS = Number(process.env.MASTER_RETENTION_MONTHS || 12);

// The upload ceiling. Camera RAW and 4K reels are big; 512 MB covers both
// without letting a mistake fill the bucket.
const MAX_UPLOAD_BYTES = Number(process.env.MEDIA_MAX_BYTES || 512 * 1024 * 1024);

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',   // iPhone default. The worker transcodes it; browsers cannot show it.
  'image/tiff': 'tif',
  'video/mp4':  'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

function kindForMime(mime) {
  if (String(mime).startsWith('image/')) return 'image';
  if (String(mime).startsWith('video/')) return 'video';
  return null;
}

function config() {
  return {
    endpoint:        process.env.R2_ENDPOINT || '',
    accessKeyId:     process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    // R2 requires the literal 'auto'. MinIO wants whatever it was started with.
    region:          process.env.R2_REGION || 'auto',
    masters:         process.env.R2_BUCKET_MASTERS || 'lawie-masters',
    derivatives:     process.env.R2_BUCKET_DERIVATIVES || 'lawie-derivatives',
    // The CDN hostname the derivatives bucket is published under. Without it we
    // fall back to presigned GETs, which work but are uncacheable and expire —
    // fine for a smoke test, wrong for a live gallery.
    publicBase:      (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, ''),
    pathStyle:       process.env.R2_PATH_STYLE !== 'false',
  };
}

// One place that decides whether the new pipeline is live. Every route consults
// it, so an unconfigured deploy degrades to the existing Supabase path instead
// of throwing on the first upload.
function isConfigured() {
  const c = config();
  return Boolean(c.endpoint && c.accessKeyId && c.secretAccessKey);
}

function requireConfig() {
  if (!isConfigured()) {
    throw Object.assign(
      new Error('Object storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.'),
      { statusCode: 503 }
    );
  }
  return config();
}

// ---------------------------------------------------------------------------
// KEY NAMING
//
// Keys are derived from a UUID, never from the filename. Two managers
// uploading DSC_0001.jpg in the same minute must not collide, filenames carry
// Kikuyu and Swahili characters that would need escaping at every use site, and
// an unguessable key means a leaked master URL cannot be walked to find the
// rest of the album.
//
// The yyyy/mm prefix exists for humans reading a bucket listing and for
// lifecycle rules scoped by prefix — not for lookup, which always goes through
// Postgres.
// ---------------------------------------------------------------------------
function masterKey(assetId, mime, when = new Date()) {
  const ext = MIME_EXT[mime] || 'bin';
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, '0');
  return `masters/${y}/${m}/${assetId}.${ext}`;
}

function renditionKey(assetId, variant, format) {
  // Flat under the asset id: deleting an asset's derivatives is a prefix
  // delete, and the CDN path stays short.
  return `d/${assetId}/${variant}.${format}`;
}

function newAssetId() {
  return crypto.randomUUID();
}

function masterExpiry(from = new Date()) {
  if (!Number.isFinite(MASTER_RETENTION_MONTHS) || MASTER_RETENTION_MONTHS <= 0) return null;
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + MASTER_RETENTION_MONTHS);
  return d;
}

// ---------------------------------------------------------------------------
// SIGNED URLS
// ---------------------------------------------------------------------------
function signed(method, bucket, key, expiresIn, query) {
  const c = requireConfig();
  return presign({
    method, bucket, key, expiresIn, query,
    endpoint:        c.endpoint,
    accessKeyId:     c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    region:          c.region,
    pathStyle:       c.pathStyle,
  });
}

// 15 minutes. Long enough for a 500 MB upload on a Nairobi connection, short
// enough that a URL copied out of devtools is worthless by the time it is used.
const uploadUrl   = (bucket, key) => signed('PUT', bucket, key, 900);
const downloadUrl = (bucket, key, ttl = 900, query) => signed('GET', bucket, key, ttl, query);
const deleteUrl   = (bucket, key) => signed('DELETE', bucket, key, 300);

// A download the browser saves rather than displays, with a filename the client
// will recognise. response-content-disposition is signed along with everything
// else, so it cannot be tampered with after the URL is issued — which matters,
// because the alternative is proxying the file through the API and paying for
// the bytes twice.
function attachmentUrl(bucket, key, filename, ttl = 900) {
  const safe = String(filename || 'photo').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
  return downloadUrl(bucket, key, ttl, {
    'response-content-disposition': `attachment; filename="${safe}"`,
  });
}

// The URL a browser actually loads. Public and cacheable when a CDN base is
// configured; a short-lived signed URL otherwise, so the gallery still renders
// on a half-configured deploy rather than showing broken images.
function publicUrl(key) {
  const c = config();
  if (c.publicBase) return `${c.publicBase}/${key}`;
  return downloadUrl(c.derivatives, key, 3600);
}

// ---------------------------------------------------------------------------
// OPERATIONS
//
// All three go through fetch against a presigned URL rather than a client
// library. The request is the protocol; there is nothing an SDK would add here
// except its own failure modes.
// ---------------------------------------------------------------------------

// Confirm the bytes actually landed before we enqueue work for them. Without
// this an abandoned upload leaves an asset row pointing at nothing, and the
// worker discovers it several minutes later as a failure.
async function head(bucket, key) {
  const res = await fetch(downloadUrl(bucket, key, 300), { method: 'HEAD' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HEAD ${bucket}/${key} failed: ${res.status}`);
  const len = res.headers.get('content-length');
  return {
    bytes: len === null ? null : Number(len),
    mime:  res.headers.get('content-type') || null,
    etag:  res.headers.get('etag') || null,
  };
}

async function getObject(bucket, key) {
  const res = await fetch(downloadUrl(bucket, key, 900));
  if (!res.ok) throw new Error(`GET ${bucket}/${key} failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function putObject(bucket, key, body, { contentType, cacheControl } = {}) {
  const headers = {};
  if (contentType)  headers['Content-Type']  = contentType;
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  const res = await fetch(uploadUrl(bucket, key), { method: 'PUT', body, headers });
  if (!res.ok) {
    throw new Error(`PUT ${bucket}/${key} failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  return { bucket, key, bytes: body.length };
}

async function deleteObject(bucket, key) {
  const res = await fetch(deleteUrl(bucket, key), { method: 'DELETE' });
  // S3 semantics: deleting an absent key is a success. That matters for the
  // purge job, which must be safe to retry after a partial failure.
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE ${bucket}/${key} failed: ${res.status}`);
  }
  return true;
}

module.exports = {
  config, isConfigured, requireConfig,
  masterKey, renditionKey, newAssetId, masterExpiry,
  uploadUrl, downloadUrl, deleteUrl, publicUrl, attachmentUrl,
  head, getObject, putObject, deleteObject,
  kindForMime, MIME_EXT, MAX_UPLOAD_BYTES, MASTER_RETENTION_MONTHS,
};
