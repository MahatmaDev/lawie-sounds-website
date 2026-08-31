// ============================================================================
//  STREAMING I/O FOR THE WORKER
//
//  The API's store module buffers objects into memory, which is right for a
//  request handler that only ever touches small things. The worker is the one
//  process that handles 400 MB reels, and buffering one of those means a
//  container sized for the worst upload rather than the typical one.
//
//  So the worker streams to disk, and hashes as the bytes go past — the file
//  has to be read once anyway, and getting the checksum for free is what makes
//  content dedupe cheap enough to always be on.
// ============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const store = require('../../backened/src/media/store');

async function tempDir() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'lawie-media-'));
}

/**
 * Stream an object to a local file, returning its size and SHA-256.
 * The hash is computed in the same pass, not by re-reading the file.
 */
async function downloadToFile(bucket, key, destPath) {
  const res = await fetch(store.downloadUrl(bucket, key, 1800));
  if (!res.ok) throw new Error(`GET ${bucket}/${key} failed: ${res.status}`);
  if (!res.body) throw new Error(`GET ${bucket}/${key} returned no body`);

  const hash = crypto.createHash('sha256');
  let bytes = 0;

  const source = Readable.fromWeb(res.body);
  source.on('data', (chunk) => { bytes += chunk.length; hash.update(chunk); });

  await pipeline(source, fs.createWriteStream(destPath));

  return { bytes, sha256: hash.digest('hex') };
}

/**
 * Upload a rendition. Derivatives are immutable — a re-run writes the same key
 * with the same content — so they get a one-year immutable cache header. That
 * header is the whole reason the CDN can serve an album view without touching
 * the origin twice.
 */
async function uploadRendition(bucket, key, buffer, contentType) {
  await store.putObject(bucket, key, buffer, {
    contentType,
    cacheControl: 'public, max-age=31536000, immutable',
  });
  return { bucket, key, bytes: buffer.length };
}

async function cleanup(dir) {
  if (!dir) return;
  await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
}

module.exports = { tempDir, downloadToFile, uploadRendition, cleanup };
