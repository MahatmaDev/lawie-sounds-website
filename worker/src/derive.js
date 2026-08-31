// ============================================================================
//  DERIVATION — the part that needs a container.
//
//  WHY THIS CANNOT LIVE IN THE API
//  -------------------------------
//  Everything below is CPU-bound work against two large native binaries:
//  libvips (via sharp) and ffmpeg. That is the exact shape serverless is worst
//  at — a function billed on wall-clock with a cold start that must first page
//  in tens of megabytes of shared objects, to do thirty seconds of solid CPU.
//
//  It is also the exact shape a container is best at: pin the binaries, pin
//  their versions, run it anywhere, scale it to zero between events. The
//  workload is bursty in the extreme — nothing for six days, then four hundred
//  photographs on a Sunday night — so the worker is written to be safe to run
//  as one replica or as ten, and to be killed at any moment.
//
//  ORIENTATION, WHICH IS WHERE THESE PIPELINES USUALLY BREAK
//  ---------------------------------------------------------
//  A phone does not rotate the sensor data; it writes an EXIF orientation tag
//  and leaves the pixels alone. Resize without honouring that tag and every
//  portrait photograph comes out sideways — and because the thumbnail is
//  generated the same wrong way, it looks deliberate. .rotate() with no
//  argument applies the tag; the display dimensions are swapped before planning
//  so the ladder is chosen against what the visitor will actually see.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const sharp = require('sharp');
const exifReader = require('exif-reader');

const store = require('../../backened/src/media/store');
const { planImage, planVideo } = require('../../backened/src/media/renditions');
const { uploadRendition } = require('./io');

const run = promisify(execFile);

const FFMPEG  = process.env.FFMPEG_PATH  || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

const CONTENT_TYPE = { webp: 'image/webp', avif: 'image/avif', jpeg: 'image/jpeg', mp4: 'video/mp4' };

// A single frame of 4K video is 8 MP; a camera RAW can be 100 MP. libvips
// streams tiles rather than decompressing whole images, but a malformed file
// can still ask it to allocate absurdly, so the ceiling is explicit.
sharp.cache(false);
sharp.concurrency(Number(process.env.SHARP_CONCURRENCY || 2));

// EXIF orientations 5..8 are the transposed ones: the stored pixels are
// landscape but the photograph is portrait.
function displayDimensions(meta) {
  const swapped = meta.orientation >= 5 && meta.orientation <= 8;
  return {
    width:  swapped ? meta.height : meta.width,
    height: swapped ? meta.width  : meta.height,
  };
}

// When the photograph was taken, not when it was uploaded. An album sorted by
// upload time is in whatever order the manager happened to drag the files in;
// sorted by capture time it is in the order the evening actually happened.
function capturedAt(meta) {
  if (!meta.exif) return null;
  try {
    const exif = exifReader(meta.exif);
    const raw = exif?.Photo?.DateTimeOriginal || exif?.Image?.DateTime;
    if (!raw) return null;
    const d = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    // A malformed EXIF block is not a reason to fail the whole photograph.
    return null;
  }
}

async function deriveImage(assetId, filePath) {
  const meta = await sharp(filePath).metadata();
  const { width, height } = displayDimensions(meta);
  if (!width || !height) throw new Error('could not read image dimensions');

  const cfg = store.config();
  const out = [];

  for (const step of planImage(width, height)) {
    const buf = await sharp(filePath)
      .rotate()                                   // apply the EXIF tag
      .resize({ width: step.width, withoutEnlargement: true })
      .webp({ quality: step.quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    const key = store.renditionKey(assetId, step.variant, step.format);
    await uploadRendition(cfg.derivatives, key, buf.data, CONTENT_TYPE[step.format]);

    out.push({
      variant: step.variant,
      format:  step.format,
      bucket:  cfg.derivatives,
      key,
      bytes:   buf.data.length,
      // The encoder's own report, not the requested size. withoutEnlargement
      // means a small source silently produces something smaller than asked
      // for, and the database must record what exists rather than what was
      // planned — the browser sizes its layout from these numbers.
      width:   buf.info.width,
      height:  buf.info.height,
    });
  }

  return {
    renditions: out,
    meta: { width, height, durationMs: null, capturedAt: capturedAt(meta) },
  };
}

async function probeVideo(filePath) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_streams', '-show_format',
    filePath,
  ], { maxBuffer: 8 * 1024 * 1024 });

  const info = JSON.parse(stdout);
  const v = (info.streams || []).find(s => s.codec_type === 'video');
  if (!v) throw new Error('file contains no video stream');

  const seconds = Number(info.format?.duration);
  return {
    width:  Number(v.width) || null,
    height: Number(v.height) || null,
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
  };
}

async function deriveVideo(assetId, filePath, workDir) {
  const probe = await probeVideo(filePath);
  const cfg = store.config();
  const steps = planVideo(probe.width, probe.height);
  const out = [];

  // Seek a little way in. Frame zero of a handheld clip is very often a blurred
  // pan or a black fade, and that frame becomes the poster the whole gallery
  // grid is judged on.
  const seekSeconds = probe.durationMs
    ? Math.min(1, probe.durationMs / 2000).toFixed(2)
    : '0';

  for (const step of steps) {
    const key = store.renditionKey(assetId, step.variant, step.format);

    if (step.variant === 'poster') {
      const framePath = path.join(workDir, 'frame.png');
      await run(FFMPEG, [
        '-y', '-loglevel', 'error',
        '-ss', String(seekSeconds),
        '-i', filePath,
        '-frames:v', '1',
        framePath,
      ], { maxBuffer: 8 * 1024 * 1024 });

      const buf = await sharp(framePath)
        .resize({ width: step.width, withoutEnlargement: true })
        .webp({ quality: step.quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });

      await uploadRendition(cfg.derivatives, key, buf.data, CONTENT_TYPE[step.format]);
      out.push({
        variant: step.variant, format: step.format, bucket: cfg.derivatives, key,
        bytes: buf.data.length, width: buf.info.width, height: buf.info.height,
      });
      continue;
    }

    // The web-playable copy. Constant Rate Factor rather than a target
    // bitrate: a static wide shot of a stage should not be given the same
    // bitrate as a strobe-lit dance floor, and CRF spends bits where the
    // picture actually needs them.
    const previewPath = path.join(workDir, 'preview.mp4');
    await run(FFMPEG, [
      '-y', '-loglevel', 'error',
      '-i', filePath,
      // -2 keeps the width even, which H.264 requires, and preserves aspect.
      '-vf', `scale=-2:${step.height}`,
      '-c:v', 'libx264', '-crf', String(step.crf), '-preset', 'veryfast',
      '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      // Without faststart the index sits at the end of the file and the browser
      // must download the whole clip before it can show the first frame.
      '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', `${step.audioKbps}k`,
      previewPath,
    ], { maxBuffer: 8 * 1024 * 1024 });

    const buf = await fs.promises.readFile(previewPath);
    const previewProbe = await probeVideo(previewPath).catch(() => ({}));

    await uploadRendition(cfg.derivatives, key, buf, CONTENT_TYPE[step.format]);
    out.push({
      variant: step.variant, format: step.format, bucket: cfg.derivatives, key,
      bytes: buf.length,
      width: previewProbe.width ?? step.width,
      height: previewProbe.height ?? step.height,
      durationMs: previewProbe.durationMs ?? probe.durationMs,
    });
  }

  return {
    renditions: out,
    meta: { width: probe.width, height: probe.height, durationMs: probe.durationMs, capturedAt: null },
  };
}

module.exports = { deriveImage, deriveVideo, probeVideo, displayDimensions, capturedAt };
