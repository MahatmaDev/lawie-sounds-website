// ============================================================================
//  AWS Signature Version 4 — presigned URLs, no dependencies.
//
//  WHY NOT THE AWS SDK
//  -------------------
//  @aws-sdk/client-s3 plus its presigner is tens of megabytes and hundreds of
//  modules, and this codebase needs exactly one thing from it: a URL the
//  browser can PUT to. That URL is a deterministic function of five strings and
//  an HMAC chain. The whole algorithm is below, it is stable (v4 has not
//  changed since 2012), and it costs one require of node:crypto — which matters
//  on a serverless function that cold-starts on the first enquiry of the day.
//
//  It also means the same code signs for Cloudflare R2, for MinIO in the local
//  docker-compose stack, and for S3 itself. They are the same protocol; only
//  the endpoint and the region string differ.
//
//  Verified against the signature test vector published in the AWS
//  documentation ("Example: signature calculation for a presigned URL",
//  examplebucket / test.txt / 20130524). See worker/test/sigv4.test.js —
//  both the intermediate canonical-request hash and the final signature are
//  checked, so a change that breaks either is caught rather than producing
//  URLs that fail opaquely at the storage provider with 403 SignatureDoesNotMatch.
// ============================================================================

const crypto = require('crypto');

const ALGORITHM = 'AWS4-HMAC-SHA256';

// A presigned URL cannot cover the body: the browser has not sent it yet, and
// requiring a content hash up front would mean reading the whole file twice.
// S3 accepts this literal in place of the payload hash.
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

// RFC 3986 percent-encoding, byte by byte.
//
// encodeURIComponent is NOT a substitute: it leaves ! ' ( ) * unescaped, and
// AWS requires them escaped. A photo captioned "Njeri's (2nd) set" would sign
// correctly and then be rejected, which is the kind of bug that only shows up
// on the manager's files and never on ours.
function uriEncode(input, encodeSlash = true) {
  const bytes = Buffer.from(String(input), 'utf8');
  let out = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    const unreserved =
      (b >= 0x41 && b <= 0x5a) ||   // A-Z
      (b >= 0x61 && b <= 0x7a) ||   // a-z
      (b >= 0x30 && b <= 0x39) ||   // 0-9
      ch === '-' || ch === '_' || ch === '.' || ch === '~';

    if (unreserved) out += ch;
    else if (ch === '/') out += encodeSlash ? '%2F' : '/';
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

// 20130524T000000Z / 20130524
function amzDates(when) {
  const iso = new Date(when).toISOString();
  const amzDate = iso.replace(/[:-]|\.\d{3}/g, '');   // 2013-05-24T00:00:00.000Z -> 20130524T000000Z
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

// The four-step key derivation. Each step narrows the key's scope, which is why
// a leaked signing key is only good for one region, one service, one day.
function signingKey(secret, dateStamp, region, service) {
  const kDate    = hmac('AWS4' + secret, dateStamp);
  const kRegion  = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Build a presigned URL.
 *
 * Two addressing styles, because both are real deployments:
 *
 *   pathStyle: true   https://endpoint/{bucket}/{key}   R2's S3 API, MinIO
 *   pathStyle: false  https://{bucket}.endpoint/{key}   S3, R2 custom domains
 *
 * Path-style is the default: MinIO in the local stack only speaks it, and it
 * keeps bucket names out of DNS, so a bucket named with a dot does not break
 * TLS certificate matching.
 *
 * @param {object}  o
 * @param {string}  o.method            GET | PUT | DELETE | HEAD
 * @param {string}  o.endpoint          https://<account>.r2.cloudflarestorage.com
 * @param {string}  o.bucket
 * @param {string}  o.key
 * @param {string}  o.accessKeyId
 * @param {string}  o.secretAccessKey
 * @param {string}  [o.region='auto']   R2 requires 'auto'; MinIO usually us-east-1
 * @param {string}  [o.service='s3']
 * @param {number}  [o.expiresIn=900]   seconds, max 604800
 * @param {boolean} [o.pathStyle=true]
 * @param {Date}    [o.now]             injected for testing
 * @param {object}  [o.query]           extra query params to sign
 * @param {string}  [o.sessionToken]    STS only; R2 does not use it
 * @returns {string} an absolute URL
 */
function presign(o) {
  const {
    method, endpoint, bucket, key,
    accessKeyId, secretAccessKey,
    region = 'auto', service = 's3',
    expiresIn = 900, now = new Date(),
    pathStyle = true,
    query = {}, sessionToken,
  } = o;

  const required = { method, endpoint, key, accessKeyId, secretAccessKey };
  // In virtual-host style the bucket may already be part of the endpoint host,
  // so it is only mandatory when we have to place it in the path ourselves.
  if (pathStyle) required.bucket = bucket;
  for (const [name, value] of Object.entries(required)) {
    if (!value) throw new Error(`presign: ${name} is required`);
  }
  // S3 refuses anything longer; better to fail here with a readable message
  // than to hand out a URL the provider rejects.
  if (expiresIn < 1 || expiresIn > 604800) {
    throw new Error(`presign: expiresIn must be 1..604800 seconds, got ${expiresIn}`);
  }

  const url = new URL(endpoint);
  const { amzDate, dateStamp } = amzDates(now);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  // host includes :port, which MinIO needs and which must appear in the signed
  // header exactly as the browser will send it.
  const host = pathStyle || !bucket ? url.host : `${bucket}.${url.host}`;

  // Canonical URI. Each segment is encoded, the separators are not — S3 is the
  // one service that does NOT double-encode the path.
  const basePath = url.pathname.replace(/\/+$/, '');
  const objectPath = pathStyle && bucket ? `${basePath}/${bucket}/${key}` : `${basePath}/${key}`;
  const canonicalUri = uriEncode(objectPath, false);

  const params = {
    ...query,
    'X-Amz-Algorithm':     ALGORITHM,
    'X-Amz-Credential':    `${accessKeyId}/${scope}`,
    'X-Amz-Date':          amzDate,
    'X-Amz-Expires':       String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  };
  if (sessionToken) params['X-Amz-Security-Token'] = sessionToken;

  // Sorted by encoded key, byte order. Object key order in JS is not it.
  const canonicalQuery = Object.keys(params)
    .map(k => [uriEncode(k), uriEncode(params[k])])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  // Only host is signed. Everything else the browser sends — Content-Type,
  // Cache-Control — travels unsigned, which is what lets the existing
  // putToStorage() in the dashboard work against this URL unchanged.
  const canonicalHeaders = `host:${host}\n`;

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = hmac(signingKey(secretAccessKey, dateStamp, region, service), stringToSign)
    .toString('hex');

  return `${url.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

module.exports = { presign, uriEncode, sha256Hex, signingKey, amzDates, ALGORITHM, UNSIGNED_PAYLOAD };
