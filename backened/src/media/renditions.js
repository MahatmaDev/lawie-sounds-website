// ============================================================================
//  THE RENDITION LADDER
//
//  Pure functions. No sharp, no ffmpeg, no I/O — this module decides *what* to
//  produce, the worker decides *how*. Keeping the decision separate from the
//  encoder is what makes it testable without a 40 MB native dependency, and it
//  means the API can predict an asset's rendition keys before the worker has
//  run.
//
//  WHY THESE SIZES
//  ---------------
//  Three steps, each roughly 2x the last, chosen against how the gallery
//  actually renders rather than against round numbers:
//
//    thumb  480px   the masonry grid. Two columns on a phone at DPR 2 is
//                   ~370 CSS px of real estate; 480 covers it with headroom.
//    card   1024px  the lightbox on a phone, and the grid on a desktop.
//    web    2048px  the lightbox on a laptop at DPR 2. Past this the eye
//                   stops paying and the bytes do not.
//
//  Nothing here serves a master. A 6 MB original in a lightbox is 6 MB of a
//  client's bundle to look at one photograph — that is the Google Drive
//  failure mode, reproduced on a website.
//
//  WHY WEBP
//  --------
//  ~30% smaller than JPEG at matched quality, supported by every browser in
//  use since 2020 (including Safari 14+, which is the constraint that used to
//  rule it out). AVIF is smaller still but encodes an order of magnitude
//  slower, and at four events a month the archive is not large enough for that
//  trade to pay. The schema already accepts 'avif', so adding it later is a
//  worker change and not a migration.
//
//  NEVER UPSCALE
//  -------------
//  A 400px logo asked for a 2048px rendition produces a blurry 2048px file that
//  is larger than the original and looks worse. Variants above the source width
//  are skipped — except 'web', which is always produced because it is the
//  archival copy the master-purge guard requires. For a small source, 'web' is
//  simply the source size.
// ============================================================================

const IMAGE_LADDER = [
  { variant: 'thumb', width: 480,  quality: 62 },
  { variant: 'card',  width: 1024, quality: 68 },
  { variant: 'web',   width: 2048, quality: 74 },
];

// The variant that must exist before a master may be deleted — the copy that
// becomes the archive once the negative is gone.
//
// It differs by kind, and the asymmetry matters: a video never produces a 'web'
// rendition, so a single hardcoded 'web' would mean video masters could never
// be purged. The largest files in the archive would be exactly the ones
// retention never reached.
//
// Mirrors media_archival_variant() in the 2026-08-31 migration. Both must
// change together.
function archivalVariant(kind) {
  return kind === 'video' ? 'preview' : 'web';
}

const VIDEO_PREVIEW_HEIGHT = 720;
const VIDEO_POSTER_WIDTH   = 1024;

function scaledHeight(srcW, srcH, outW) {
  if (!srcW || !srcH) return null;
  return Math.max(1, Math.round((srcH * outW) / srcW));
}

/**
 * What to produce for a still image.
 * @param {number} srcW source width in pixels
 * @param {number} srcH source height in pixels
 * @returns {Array<{variant,format,quality,width,height}>}
 */
function planImage(srcW, srcH) {
  if (!Number.isFinite(srcW) || srcW < 1) {
    throw new Error(`planImage: source width must be a positive number, got ${srcW}`);
  }
  const plan = [];
  for (const step of IMAGE_LADDER) {
    const archival = step.variant === archivalVariant('image');
    // Skipped rather than clamped: clamping would emit two variants at the same
    // width, doubling storage for identical pixels.
    if (!archival && srcW <= step.width) continue;

    const width = Math.min(step.width, srcW);
    plan.push({
      variant: step.variant,
      format:  'webp',
      quality: step.quality,
      width,
      height:  scaledHeight(srcW, srcH, width),
    });
  }
  return plan;
}

/**
 * What to produce for a video.
 *
 * A poster is not optional. Without one the gallery grid downloads video bytes
 * to paint a still frame, which is the single most expensive thing a gallery
 * page can do — and iOS refuses to autoplay under Low Power Mode, so the poster
 * is what most phone visitors see anyway.
 */
function planVideo(srcW, srcH) {
  const posterW = Math.min(VIDEO_POSTER_WIDTH, srcW || VIDEO_POSTER_WIDTH);
  const previewH = Math.min(VIDEO_PREVIEW_HEIGHT, srcH || VIDEO_PREVIEW_HEIGHT);

  return [
    {
      variant: 'poster',
      format:  'webp',
      quality: 68,
      width:   posterW,
      height:  scaledHeight(srcW, srcH, posterW),
    },
    {
      variant: 'preview',
      format:  'mp4',
      // Height-driven, because video ladders are conventionally named by height
      // (720p) and because portrait phone footage is the common case here.
      height:  previewH,
      width:   srcW && srcH ? Math.round((srcW * previewH) / srcH / 2) * 2 : null,
      crf:     28,
      audioKbps: 96,
    },
  ];
}

function plan(kind, srcW, srcH) {
  if (kind === 'video') return planVideo(srcW, srcH);
  return planImage(srcW, srcH);
}

// Which variant the browser should ask for in a given context. Kept here so the
// gallery, the lightbox and the album page cannot drift apart on it.
const VARIANT_FOR = {
  grid:     'thumb',
  card:     'card',
  lightbox: 'web',
  video:    'preview',
  poster:   'poster',
};

module.exports = {
  IMAGE_LADDER, archivalVariant, VARIANT_FOR,
  VIDEO_PREVIEW_HEIGHT, VIDEO_POSTER_WIDTH,
  planImage, planVideo, plan, scaledHeight,
};
