// ============================================================================
//  THE MEDIA WORKER
//
//  A long-running container that drains media_jobs. Two job types:
//
//    derive        master -> thumb/card/web (images) or poster/preview (video)
//    purge-master  delete an original whose retention window has closed
//
//  DESIGN RULES, ALL OF THEM ABOUT BEING KILLED AT A BAD MOMENT
//  ------------------------------------------------------------
//  This process can be stopped at any instant: a deploy, an OOM, a scale-to-zero
//  timer, a spot instance reclaimed. Everything below assumes that.
//
//    * Claims carry a lease. A job held longer than the lease is reclaimable,
//      so a job whose worker died is picked up rather than stranded.
//    * attempts is incremented on claim, not on failure, so a job that reliably
//      kills its worker still exhausts its retries instead of looping forever.
//    * Every step is idempotent. Rendition keys are deterministic, so a re-run
//      overwrites rather than duplicating, and the upsert means the second run
//      converges on the same rows.
//    * The purge job marks the database BEFORE deleting the object. The other
//      order has a window where the object is gone and the row still claims it
//      exists — every read after that is a 404 with no record of why.
//
//  SAFE TO RUN AS ONE REPLICA OR TEN. Claiming goes through
//  FOR UPDATE SKIP LOCKED, so two workers never take the same job.
// ============================================================================

const os = require('os');
const path = require('path');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');

const store = require('../../backened/src/media/store');
const { archivalVariant } = require('../../backened/src/media/renditions');
const { tempDir, downloadToFile, cleanup } = require('./io');
const { deriveImage, deriveVideo } = require('./derive');

const WORKER_ID   = `${os.hostname()}-${process.pid}`;
const POLL_MS     = Number(process.env.POLL_MS || 5000);
const BATCH       = Number(process.env.BATCH_SIZE || 1);
const SWEEP_MS    = Number(process.env.RETENTION_SWEEP_MS || 60 * 60 * 1000);
const HEALTH_PORT = Number(process.env.PORT || 8080);
const ONCE        = process.argv.includes('--once');

for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) {
  if (!process.env[name]) {
    console.error(`[worker] ${name} is not set. The worker talks to Postgres directly and cannot start without it.`);
    process.exit(1);
  }
}
if (!store.isConfigured()) {
  console.error('[worker] object storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const stats = { claimed: 0, done: 0, failed: 0, startedAt: new Date().toISOString(), lastPollAt: null, lastError: null };
let stopping = false;
let inFlight = 0;

const log = (...a) => console.log(`[worker ${WORKER_ID}]`, ...a);

// ---------------------------------------------------------------------------
// DERIVE
// ---------------------------------------------------------------------------
async function processDerive(asset) {
  // Someone else finished it while this job sat in the queue. Not an error.
  if (asset.status === 'ready') return;

  await supabase.from('media_assets').update({ status: 'processing' }).eq('id', asset.id);

  const dir = await tempDir();
  try {
    const ext = store.MIME_EXT[asset.master_mime] || 'bin';
    const file = path.join(dir, `master.${ext}`);

    const { bytes, sha256 } = await downloadToFile(asset.master_bucket, asset.master_key, file);

    const result = asset.kind === 'video'
      ? await deriveVideo(asset.id, file, dir)
      : await deriveImage(asset.id, file);

    if (!result.renditions.length) {
      throw new Error('the encoder produced no renditions');
    }

    // Deterministic keys plus an upsert: a re-run replaces its own rows instead
    // of accumulating a second set alongside them.
    const { error: rErr } = await supabase.from('media_renditions').upsert(
      result.renditions.map(r => ({
        asset_id: asset.id,
        variant:  r.variant,
        format:   r.format,
        bucket:   r.bucket,
        key:      r.key,
        bytes:    r.bytes,
        width:    r.width ?? null,
        height:   r.height ?? null,
        duration_ms: r.durationMs ?? null,
      })),
      { onConflict: 'asset_id,variant,format' }
    );
    if (rErr) throw new Error(`writing renditions failed: ${rErr.message}`);

    const patch = {
      status:      'ready',
      ready_at:    new Date().toISOString(),
      width:       result.meta.width,
      height:      result.meta.height,
      duration_ms: result.meta.durationMs,
      captured_at: result.meta.capturedAt ? result.meta.capturedAt.toISOString() : null,
      master_bytes: bytes,
      last_error:  null,
    };
    // The checksum the browser sent was a claim; this one was computed from the
    // bytes that actually arrived. Only fill it if it is still empty — an
    // existing value came from a completed upload and rewriting it would
    // detach the row from its dedupe identity.
    if (!asset.checksum_sha256) patch.checksum_sha256 = sha256;

    let { error: aErr } = await supabase.from('media_assets').update(patch).eq('id', asset.id);

    // Another asset already holds this checksum: the same file was uploaded
    // twice and the dedupe check missed it (the browser did not hash it, or two
    // uploads raced). The renditions are correct either way, so keep them and
    // drop the duplicate hash rather than failing the job.
    if (aErr && aErr.code === '23505') {
      log(`checksum ${sha256.slice(0, 12)} already belongs to another asset; leaving asset ${asset.id} unhashed`);
      delete patch.checksum_sha256;
      ({ error: aErr } = await supabase.from('media_assets').update(patch).eq('id', asset.id));
    }
    if (aErr) throw new Error(`marking asset ready failed: ${aErr.message}`);

    const kb = Math.round(result.renditions.reduce((a, r) => a + r.bytes, 0) / 1024);
    log(`derived ${asset.id} (${asset.kind}) -> ${result.renditions.length} renditions, ${kb} KB from ${Math.round(bytes / 1024)} KB master`);
  } finally {
    await cleanup(dir);
  }
}

// ---------------------------------------------------------------------------
// PURGE
//
// The only code in the system that destroys anything. It is deliberately dull.
// ---------------------------------------------------------------------------
async function processPurge(asset) {
  const wanted = archivalVariant(asset.kind);

  // The trigger will refuse this anyway. Checking here means the refusal is a
  // readable log line and a retry, rather than a raw Postgres exception.
  const { count, error } = await supabase
    .from('media_renditions')
    .select('id', { count: 'exact', head: true })
    .eq('asset_id', asset.id).eq('variant', wanted).gt('bytes', 0);
  if (error) throw new Error(`could not verify renditions: ${error.message}`);
  if (!count) throw new Error(`refusing to purge ${asset.id}: no ${wanted} rendition exists`);

  // Record first, delete second. Reversing these leaves a window where the
  // object is gone and the database still says it is there.
  if (!asset.master_deleted_at) {
    const { error: mErr } = await supabase.from('media_assets')
      .update({ master_deleted_at: new Date().toISOString() }).eq('id', asset.id);
    if (mErr) throw new Error(`could not mark master purged: ${mErr.message}`);
  }

  // Unconditional and idempotent: deleting an absent key succeeds, which is
  // what makes a retry after a half-finished purge safe.
  await store.deleteObject(asset.master_bucket, asset.master_key);
  log(`purged master for ${asset.id} (${Math.round((asset.master_bytes || 0) / 1048576)} MB reclaimed)`);
}

// ---------------------------------------------------------------------------
// THE LOOP
// ---------------------------------------------------------------------------
async function runJob(job) {
  const { data: asset, error } = await supabase
    .from('media_assets').select('*').eq('id', job.asset_id).maybeSingle();
  if (error) throw new Error(`could not load asset: ${error.message}`);
  // The asset was deleted while the job waited. Nothing to do, and retrying
  // will never help.
  if (!asset) return;

  if (job.job_type === 'derive') return processDerive(asset);
  if (job.job_type === 'purge-master') return processPurge(asset);
  throw new Error(`unknown job type ${job.job_type}`);
}

async function drainOnce() {
  const { data: jobs, error } = await supabase.rpc('claim_media_jobs', {
    p_worker: WORKER_ID,
    p_limit:  BATCH,
  });
  stats.lastPollAt = new Date().toISOString();
  if (error) throw new Error(`claim failed: ${error.message}`);
  if (!jobs?.length) return 0;

  for (const job of jobs) {
    if (stopping) break;
    inFlight++;
    stats.claimed++;
    try {
      await runJob(job);
      await supabase.rpc('finish_media_job', { p_job: job.id });
      stats.done++;
    } catch (e) {
      stats.failed++;
      stats.lastError = e.message;
      console.error(`[worker ${WORKER_ID}] job ${job.id} (${job.job_type}) failed:`, e.message);
      // fail_media_job decides between a backoff retry and giving up. The
      // worker deliberately does not make that call itself — the retry policy
      // belongs next to the data, where a second worker sees the same rules.
      await supabase.rpc('fail_media_job', { p_job: job.id, p_error: e.message })
        .then(({ error: fErr }) => { if (fErr) console.error('could not record failure:', fErr.message); });
    } finally {
      inFlight--;
    }
  }
  return jobs.length;
}

// The retention sweep runs here rather than as a scheduled function because
// this is the process that owns deletion. A cron with delete rights and no
// other purpose is a liability; a worker that already holds the credentials and
// the guard logic is not.
async function sweepRetention() {
  const { data, error } = await supabase.rpc('enqueue_expired_masters', { p_limit: 200 });
  if (error) return console.error('[worker] retention sweep failed:', error.message);
  if (data) log(`retention sweep enqueued ${data} master purge(s)`);
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    const healthy = !stopping;
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: healthy, worker: WORKER_ID, inFlight, ...stats }));
  });
  server.listen(HEALTH_PORT, () => log(`health endpoint on :${HEALTH_PORT}`));
  return server;
}

async function main() {
  log(`starting. poll=${POLL_MS}ms batch=${BATCH} retention=${store.MASTER_RETENTION_MONTHS} months`);

  if (ONCE) {
    // Drain and exit — for CI, for a manual catch-up run, and for the
    // docker-compose smoke test.
    let total = 0, n;
    do { n = await drainOnce(); total += n; } while (n > 0);
    log(`--once: processed ${total} job(s)`);
    return;
  }

  const server = startHealthServer();
  const sweepTimer = setInterval(() => { sweepRetention().catch(() => {}); }, SWEEP_MS);
  await sweepRetention();

  // SIGTERM is what a deploy or a scale-to-zero sends. Stop claiming
  // immediately, let the job in hand finish, then exit — anything still queued
  // is picked up by the next worker, and anything abandoned mid-flight is
  // reclaimed when its lease expires.
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received — finishing ${inFlight} job(s) in flight, then exiting`);
    clearInterval(sweepTimer);
    server.close();
    const deadline = Date.now() + 30000;
    while (inFlight > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  while (!stopping) {
    let handled = 0;
    try {
      handled = await drainOnce();
    } catch (e) {
      stats.lastError = e.message;
      console.error('[worker] poll failed:', e.message);
    }
    // Only idle when there was nothing to do. A busy queue is drained back to
    // back rather than one job per poll interval.
    if (!handled && !stopping) await new Promise(r => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error('[worker] fatal:', e);
  process.exit(1);
});
