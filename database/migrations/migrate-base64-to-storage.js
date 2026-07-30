/**
 * One-off: move base64 data-URI gallery rows out of Postgres into Supabase Storage.
 *
 * WHY: the dashboard's old upload path stored whole images as base64 text in
 * gallery.image_url. One row carries 372 KB of JPEG inside the database, and
 * GET /api/gallery shipped it to every visitor. This lifts any such row into
 * the `gallery` bucket and repoints image_url at the CDN URL.
 *
 * Safe to re-run: rows already migrated no longer match the data: prefix.
 *
 *   node database/migrations/migrate-base64-to-storage.js          (dry run)
 *   node database/migrations/migrate-base64-to-storage.js --commit (writes)
 */
const fs   = require('fs');
const path = require('path');

// Resolve deps and env from backened/ regardless of the cwd this is run from —
// Node resolves modules relative to this file, not the working directory.
const BACKEND = path.join(__dirname, '../../backened');
const { createClient } = require(path.join(BACKEND, 'node_modules/@supabase/supabase-js'));

// Minimal .env reader: avoids depending on dotenv being installed.
const env = Object.fromEntries(
  fs.readFileSync(path.join(BACKEND, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const COMMIT = process.argv.includes('--commit');
const BUCKET = 'gallery';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

/** Read intrinsic dimensions straight from the file header — no image library. */
function readDimensions(buf, mime) {
  try {
    if (mime === 'image/png' && buf.length > 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      // Walk the JPEG marker segments to the Start-Of-Frame, which holds the size.
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const marker = buf[i + 1];
        // SOF0..SOF15, excluding DHT(c4), JPG(c8) and DAC(cc) which are not frames.
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* dimensions are a nice-to-have, never a reason to fail the move */ }
  return { width: null, height: null };
}

function slugify(s) {
  return String(s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
}

(async () => {
  const { data: rows, error } = await supabase
    .from('gallery').select('id, title, image_url, type').like('image_url', 'data:%');

  if (error) { console.error('Query failed:', error.message); process.exit(1); }
  if (!rows.length) { console.log('Nothing to migrate — no base64 rows remain.'); return; }

  console.log(`Found ${rows.length} base64 row(s).${COMMIT ? '' : ' DRY RUN — pass --commit to write.'}\n`);

  let moved = 0;
  for (const row of rows) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(row.image_url);
    if (!m) { console.warn(`  SKIP ${row.id} — malformed data URI`); continue; }

    const [, mime, b64] = m;
    const buf = Buffer.from(b64, 'base64');
    const ext = EXT[mime] || 'bin';
    const { width, height } = readDimensions(buf, mime);
    const path = `${new Date().getFullYear()}/${slugify(row.title)}-${row.id.slice(0, 8)}.${ext}`;

    console.log(`  ${row.title}`);
    console.log(`    ${mime} · ${(buf.length / 1024).toFixed(0)} KB · ${width || '?'}x${height || '?'} → ${BUCKET}/${path}`);

    if (!COMMIT) continue;

    const up = await supabase.storage.from(BUCKET)
      .upload(path, buf, { contentType: mime, upsert: true, cacheControl: '31536000' });
    if (up.error) { console.error(`    UPLOAD FAILED: ${up.error.message}`); continue; }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

    const upd = await supabase.from('gallery').update({
      image_url:    pub.publicUrl,
      storage_path: path,
      mime_type:    mime,
      file_size:    buf.length,
      width, height,
    }).eq('id', row.id);

    if (upd.error) {
      // Row update failed after the object landed — remove it so a re-run is clean.
      console.error(`    DB UPDATE FAILED: ${upd.error.message} — rolling back object`);
      await supabase.storage.from(BUCKET).remove([path]);
      continue;
    }
    console.log(`    OK → ${pub.publicUrl}`);
    moved++;
  }

  if (COMMIT) console.log(`\nMigrated ${moved}/${rows.length} row(s).`);
})();
