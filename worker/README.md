# Media worker — cloud storage for the archive

Plan phase **P3**. This is the piece that replaces "compress everything so it
fits in Google Drive's 15 GB".

## The idea in one paragraph

A photograph is not one file. It is a **master** (the 6 MB camera original — the
negative), a set of **renditions** (the 40–380 KB copies a browser actually
downloads), and a row of **metadata** (0.4 KB in Postgres). Google Drive stores
one object per photograph and so conflates all three: every view pays master
price, and no master can ever be deleted because it is the only copy. Splitting
them apart is what makes the storage bill small and, more importantly, bounded.

## Why the master tier stops growing

With no expiry, stored master bytes are the running integral of the arrival
rate — `S(t) = ∫₀ᵗ r(τ)dτ`, which diverges. Give the window a moving lower
limit and it converges:

```
S(t) = ∫_{t−T}^{t} r(τ) dτ   →   r̄·T
```

Same inflow, bounded storage. At roughly four events a month and ~7 GB of
masters each, a 12-month window settles near 346 GB instead of climbing
forever. Renditions are **not** on a window — they are what the site serves and
they are two orders of magnitude smaller. Only the negative expires.

**What you give up:** once a master is purged, the largest surviving copy is the
2048px `web` rendition for photographs, or the 720p `preview` for video. That is
the bargain. Set `MASTER_RETENTION_MONTHS=0` to keep every original forever and
accept the unbounded curve.

## Where Docker belongs, and where it does not

- **Not around the object store.** Running MinIO or Ceph to "own our storage"
  means owning disk failure, replication, backups and durability for the one
  thing in this business that cannot be regenerated. R2 does that for
  $0.015/GB-month.
- **Not around the API.** Request/response, no native dependencies, already
  runs on Vercel for nothing.
- **Here.** Derivation is CPU-bound work against two heavy native binaries
  (libvips, ffmpeg) with a violently bursty load — nothing for six days, then
  four hundred photographs on a Sunday night. That is the worst possible shape
  for serverless and the best possible shape for a scale-to-zero container.
- **And as the local fixture.** `docker compose up` runs the same image against
  MinIO standing in for R2, so the encoder that produced a rendition on a laptop
  is the one that produces it in production. ffmpeg output differs between
  versions; that reproducibility is not a small thing on a media pipeline.

## Why Cloudflare R2 and not Supabase Storage

Egress. A gallery is almost pure egress — everyone downloads, nobody uploads.
Supabase bills roughly $0.09/GB out; R2 bills zero. At 200 GB of viewing a
month that is about $18 against about $0. Storage itself costs the same either
way.

Supabase Storage is **not** removed. It still holds everything uploaded before
this pipeline, the API falls back to it when R2 is unconfigured, and no existing
row changes.

## Setup

### 1. Buckets

In the Cloudflare dashboard → R2, create two:

| Bucket               | Access                         | Holds                        |
| -------------------- | ------------------------------ | ---------------------------- |
| `lawie-masters`      | **private — never public**     | originals, on the window     |
| `lawie-derivatives`  | public, via a custom domain    | what the website serves       |

Connect a domain (e.g. `media.lawiesounds.com`) to the derivatives bucket and
put it in `R2_PUBLIC_BASE`. Without it the API falls back to signed URLs, which
work but cannot be cached — fine for a smoke test, wrong for a live gallery.

Then R2 → **Manage API tokens** → an *Object Read & Write* token.

### 2. Environment

Set these on Vercel (for the API) and on the worker host. See `.env.example`.

| Variable | Notes |
| --- | --- |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from the token above |
| `R2_REGION` | `auto` for R2; `us-east-1` for MinIO |
| `R2_BUCKET_MASTERS`, `R2_BUCKET_DERIVATIVES` | |
| `R2_PUBLIC_BASE` | the derivatives CDN domain |
| `MASTER_RETENTION_MONTHS` | default `12`; `0` disables purging |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | worker only — it writes rendition rows |

Leave them unset and nothing changes: `/api/admin/media/*` answers 503 and the
dashboard uploader silently uses the old Supabase path.

### 3. Run it

Locally, with MinIO instead of R2:

```bash
docker compose up          # minio + bucket bootstrap + worker
```

In production, anywhere that runs a container and scales to zero — Fly.io is the
cheapest fit for this load:

```bash
docker build -f worker/Dockerfile -t lawie-media-worker .   # context is the REPO ROOT
```

One replica is enough. It is safe to run several: claims go through
`FOR UPDATE SKIP LOCKED`, so two workers never take the same job.

## How an upload flows

```
browser                     API (Vercel)              R2                worker
   |  1. upload-url  ------>  writes media_assets      |                   |
   |     (+ SHA-256)          row, status=uploading    |                   |
   |  <-- presigned PUT ----                           |                   |
   |  2. PUT the ORIGINAL ---------------------------> masters             |
   |  3. complete    ------>  HEAD confirms bytes,     |                   |
   |                          enqueues a derive job    |                   |
   |                                                   |  <-- claim -------|
   |                                                   |  <-- GET master --|
   |                                                   |  --- PUT ------>  derivatives
   |                          rendition rows, ready    |  <-- write -------|
```

The bytes never pass through the API — Vercel caps a request body at 4.5 MB, so
a 6 MB original could not be proxied even once.

Rendition keys are deterministic (`d/<assetId>/<variant>.<format>`), which is
why the dashboard can save the gallery row immediately instead of waiting for
the encode, and why re-running the worker overwrites rather than accumulating.

## The rule the schema enforces

**A master is never deleted while it is the only copy.** Not a convention — a
trigger. `media_master_guard()` refuses to set `master_deleted_at` on an asset
with no archival rendition, and the archival variant is kind-aware (`web` for
photographs, `preview` for video). Hardcoding `web` would have meant video
masters — the largest files in the archive — could never be expired at all,
while the storage graph claimed to be bounded.

The retention sweep only *enqueues* purge jobs; the worker does the deleting.
Nothing on a schedule is allowed to delete an object directly.

## Tests

```bash
node worker/test/run.js
```

24 checks with no network and no framework. The presigner is verified against
the signature test vector published by AWS — both the final signature and the
intermediate canonical-request hash, so a regression is localised rather than
appearing as an unexplained 403 from Cloudflare.
