/**
 * Backfill gallery.width / gallery.height for rows that point at repo-static
 * files under /IMAGES/ or /Gallery/.
 *
 * WHY: without intrinsic dimensions the browser cannot reserve space for an
 * image before it loads, so every photo shoves the masonry layout down as it
 * arrives. That is the Cumulative Layout Shift metric, and it is the single
 * most visible quality problem on a photo-heavy page.
 *
 * Reads the files straight off disk — they are committed to the repo — so this
 * must be run from a checkout, not from a serverless function.
 *
 *   node database/migrations/backfill-image-dimensions.js          (dry run)
 *   node database/migrations/backfill-image-dimensions.js --commit (writes)
 */
const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '../..');
const BACKEND = path.join(ROOT, 'backened');
const { createClient } = require(path.join(BACKEND, 'node_modules/@supabase/supabase-js'));

const env = Object.fromEntries(
  fs.readFileSync(path.join(BACKEND, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const COMMIT = process.argv.includes('--commit');
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

/** Dimensions from the file header — no image library needed. */
function readDimensions(buf) {
  try {
    // PNG: IHDR width/height at fixed offsets.
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504E47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // JPEG: walk marker segments to the Start-Of-Frame.
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    // WebP: VP8X / VP8L / VP8 chunk headers.
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: (buf.readUIntLE(24, 3) & 0xFFFFFF) + 1, height: (buf.readUIntLE(27, 3) & 0xFFFFFF) + 1 };
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF };
    }
  } catch { /* a missing dimension is not worth failing the run over */ }
  return { width: null, height: null };
}

(async () => {
  const { data: rows, error } = await supabase
    .from('gallery').select('id, title, image_url, width, height')
    .is('width', null);

  if (error) { console.error('Query failed:', error.message); process.exit(1); }

  const local = rows.filter(r => /^\/(IMAGES|Gallery)\//i.test(r.image_url || ''));
  console.log(`${rows.length} row(s) missing dimensions · ${local.length} resolvable from disk.` +
              `${COMMIT ? '' : ' DRY RUN — pass --commit to write.'}\n`);

  let ok = 0, missing = 0, unreadable = 0;

  for (const row of local) {
    // DB stores a URL path; decode it back to a filesystem path. The live data
    // contains spaces and ampersands ("Power & Lighting"), so this matters.
    const rel  = decodeURIComponent(row.image_url).replace(/^\//, '');
    const file = path.join(ROOT, rel);

    if (!fs.existsSync(file)) {
      console.warn(`  MISSING ON DISK  ${row.image_url}`);
      missing++;
      continue;
    }

    const { width, height } = readDimensions(fs.readFileSync(file));
    if (!width || !height) {
      console.warn(`  UNREADABLE       ${row.image_url}`);
      unreadable++;
      continue;
    }

    if (COMMIT) {
      const { error: upErr } = await supabase.from('gallery')
        .update({ width, height, file_size: fs.statSync(file).size }).eq('id', row.id);
      if (upErr) { console.error(`  FAILED ${row.id}: ${upErr.message}`); continue; }
    }
    console.log(`  ${String(width).padStart(5)}x${String(height).padEnd(5)}  ${row.title}`);
    ok++;
  }

  console.log(`\n${ok} sized · ${missing} missing on disk · ${unreadable} unreadable`);
  if (missing) console.log('Rows missing on disk point at files that are not in this checkout — they will 404 for visitors too.');
})();
