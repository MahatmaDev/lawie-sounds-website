// ============================================================================
//  Tests for the media pipeline's pure parts.
//
//      node worker/test/run.js
//
//  No framework and no network. Everything here is a pure function, which is
//  the reason the ladder and the presigner were written as pure functions in
//  the first place — the alternative is discovering a bad signature as a 403
//  from Cloudflare with no message, or a bad ladder as a sideways thumbnail on
//  the owner's phone.
// ============================================================================

const assert = require('assert');

const { presign, uriEncode, sha256Hex } = require('../../backened/src/media/sigv4');
const { planImage, planVideo, archivalVariant, scaledHeight } = require('../../backened/src/media/renditions');
const store = require('../../backened/src/media/store');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${e.message}`);
  }
}

console.log('\nSigV4 presigner');
console.log('---------------');

// The reference case published by AWS: GET examplebucket/test.txt, presigned
// for 24 hours on 2013-05-24. If this passes, the HMAC chain, the canonical
// request layout, the query ordering and the percent-encoding are all correct.
const VECTOR = {
  accessKeyId:     'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region:          'us-east-1',
  now:             new Date('2013-05-24T00:00:00Z'),
  expected:        'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
  canonicalHash:   '3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04',
};

test('reproduces the published AWS signature', () => {
  const url = presign({
    method: 'GET',
    endpoint: 'https://s3.amazonaws.com',
    bucket: 'examplebucket',
    key: 'test.txt',
    accessKeyId: VECTOR.accessKeyId,
    secretAccessKey: VECTOR.secretAccessKey,
    region: VECTOR.region,
    expiresIn: 86400,
    pathStyle: false,
    now: VECTOR.now,
  });
  const sig = new URL(url).searchParams.get('X-Amz-Signature');
  assert.strictEqual(sig, VECTOR.expected);
});

test('canonical request hashes to the published intermediate value', () => {
  // Rebuilt by hand from the documented canonical request. This isolates a
  // failure to the canonical-request layout rather than the key derivation.
  const canonical = [
    'GET',
    '/test.txt',
    'X-Amz-Algorithm=AWS4-HMAC-SHA256' +
      '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
      '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
    'host:examplebucket.s3.amazonaws.com\n',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  assert.strictEqual(sha256Hex(canonical), VECTOR.canonicalHash);
});

test('virtual-host and path style address the same object differently', () => {
  const common = {
    method: 'GET', endpoint: 'https://s3.amazonaws.com', bucket: 'b', key: 'k.jpg',
    accessKeyId: 'AK', secretAccessKey: 'SK', region: 'us-east-1', now: VECTOR.now,
  };
  assert.ok(presign({ ...common, pathStyle: true  }).startsWith('https://s3.amazonaws.com/b/k.jpg'));
  assert.ok(presign({ ...common, pathStyle: false }).startsWith('https://b.s3.amazonaws.com/k.jpg'));
});

test('encodes the characters encodeURIComponent leaves alone', () => {
  // These five are the ones that make encodeURIComponent unusable here. A
  // caption like "Njeri's (2nd) set" would sign and then be rejected.
  assert.strictEqual(uriEncode("!'()*"), '%21%27%28%29%2A');
  assert.strictEqual(uriEncode('a b'), 'a%20b');
  assert.strictEqual(uriEncode('-_.~'), '-_.~', 'unreserved characters must pass through');
});

test('encodes multi-byte characters as UTF-8 bytes', () => {
  assert.strictEqual(uriEncode('ü'), '%C3%BC');
});

test('path separators survive in the canonical URI but not in query values', () => {
  assert.strictEqual(uriEncode('a/b', false), 'a/b');
  assert.strictEqual(uriEncode('a/b', true), 'a%2Fb');
});

test('refuses an expiry S3 would reject', () => {
  assert.throws(() => presign({
    method: 'GET', endpoint: 'https://s3.amazonaws.com', bucket: 'b', key: 'k',
    accessKeyId: 'AK', secretAccessKey: 'SK', expiresIn: 604801,
  }), /604800/);
});

console.log('\nRendition ladder');
console.log('----------------');

test('a large photograph gets all three steps', () => {
  const plan = planImage(6000, 4000);
  assert.deepStrictEqual(plan.map(p => p.variant), ['thumb', 'card', 'web']);
  assert.deepStrictEqual(plan.map(p => p.width), [480, 1024, 2048]);
});

test('never upscales', () => {
  for (const p of planImage(800, 600)) {
    assert.ok(p.width <= 800, `${p.variant} asked for ${p.width} from an 800px source`);
  }
});

test('does not emit two variants at the same width', () => {
  // Clamping instead of skipping would produce card@800 and web@800 — twice the
  // storage for identical pixels.
  for (const src of [300, 500, 800, 1025, 2049, 6000]) {
    const widths = planImage(src, src).map(p => p.width);
    assert.strictEqual(new Set(widths).size, widths.length, `duplicate widths at source ${src}`);
  }
});

test('always produces the archival variant, however small the source', () => {
  // Without this the master-purge guard can never be satisfied and the
  // retention window silently never applies to small images.
  for (const src of [40, 300, 480, 1024, 9000]) {
    const plan = planImage(src, src);
    assert.ok(plan.some(p => p.variant === archivalVariant('image')),
      `no archival rendition planned for a ${src}px source`);
  }
});

test('preserves aspect ratio', () => {
  const [thumb] = planImage(4000, 3000);
  assert.strictEqual(thumb.width, 480);
  assert.strictEqual(thumb.height, 360);      // 480 * 3000/4000
});

test('portrait sources keep their orientation', () => {
  const [thumb] = planImage(3000, 4000);
  assert.ok(thumb.height > thumb.width);
});

test('rejects a nonsense source width rather than planning nothing', () => {
  assert.throws(() => planImage(0, 100));
  assert.throws(() => planImage(NaN, 100));
});

test('video gets a poster and a preview, and the preview width is even', () => {
  const plan = planVideo(1920, 1080);
  assert.deepStrictEqual(plan.map(p => p.variant), ['poster', 'preview']);
  const preview = plan.find(p => p.variant === 'preview');
  assert.strictEqual(preview.height, 720);
  assert.strictEqual(preview.width % 2, 0, 'H.264 requires even dimensions');
});

test('a portrait clip is not stretched to landscape', () => {
  const preview = planVideo(1080, 1920).find(p => p.variant === 'preview');
  assert.ok(preview.width < preview.height);
});

test('the archival variant is kind-aware', () => {
  // The regression this guards: a hardcoded 'web' meant videos never produced
  // the variant the purge guard required, so video masters — the largest files
  // in the archive — could never be expired.
  assert.strictEqual(archivalVariant('image'), 'web');
  assert.strictEqual(archivalVariant('video'), 'preview');
  const videoVariants = planVideo(1920, 1080).map(p => p.variant);
  assert.ok(videoVariants.includes(archivalVariant('video')));
});

test('scaledHeight is defensive about missing dimensions', () => {
  assert.strictEqual(scaledHeight(0, 100, 50), null);
  assert.strictEqual(scaledHeight(100, 0, 50), null);
  assert.strictEqual(scaledHeight(100, 50, 50), 25);
});

console.log('\nKeys and retention');
console.log('------------------');

test('master keys are unguessable and carry a date prefix', () => {
  const key = store.masterKey('11111111-2222-3333-4444-555555555555', 'image/jpeg', new Date('2026-03-09T00:00:00Z'));
  assert.strictEqual(key, 'masters/2026/03/11111111-2222-3333-4444-555555555555.jpg');
});

test('master keys never contain the original filename', () => {
  // A filename would leak the client's name into a URL and would need escaping
  // at every use site.
  const key = store.masterKey(store.newAssetId(), 'video/mp4');
  assert.ok(!/[^a-zA-Z0-9/._-]/.test(key), `key has characters needing escaping: ${key}`);
});

test('rendition keys are deterministic, so a re-run overwrites', () => {
  const a = store.renditionKey('abc', 'thumb', 'webp');
  const b = store.renditionKey('abc', 'thumb', 'webp');
  assert.strictEqual(a, b);
  assert.strictEqual(a, 'd/abc/thumb.webp');
});

test('unknown mime types do not produce a key with no extension', () => {
  assert.ok(store.masterKey('id', 'application/zip').endsWith('.bin'));
});

test('the retention window lands twelve months out by default', () => {
  const from = new Date('2026-08-31T00:00:00Z');
  const expiry = store.masterExpiry(from);
  assert.strictEqual(expiry.toISOString().slice(0, 7), '2027-08');
});

test('image and video mime types are classified correctly', () => {
  assert.strictEqual(store.kindForMime('image/heic'), 'image');
  assert.strictEqual(store.kindForMime('video/quicktime'), 'video');
  assert.strictEqual(store.kindForMime('application/pdf'), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
