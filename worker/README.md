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

## Where Docker belongs

- **Not around the object store.** Running MinIO or Ceph to "own our storage"
  means owning disk failure, replication, backups and durability for the one
  thing in this business that cannot be regenerated. AWS S3 provides the
  managed durability; storage and data-transfer charges still apply.
- **Not around the API.** Request/response, no native dependencies, already
  runs on Vercel for nothing.
- **Here.** Derivation is CPU-bound work against two heavy native binaries
  (libvips, ffmpeg) with a violently bursty load — nothing for six days, then
  four hundred photographs on a Sunday night. That is the worst possible shape
  for serverless and the best possible shape for a scale-to-zero container.
- **And as the local fixture.** `docker compose up` runs the same image against
  MinIO standing in for S3, so the encoder that produced a rendition on a laptop
  is the one that produces it in production. ffmpeg output differs between
  versions; that reproducibility is not a small thing on a media pipeline.

## Storage layout

New media uses two private S3 buckets. Originals stay private for their entire
lifetime. Renditions also stay private: the API returns short-lived S3 URLs only
after checking the album capability and, when configured, the client passcode.
Public gallery APIs issue their own short-lived URLs for published rows. Do not
enable S3 Block Public Access exceptions or make either bucket website-readable.

S3 storage is not free egress. This first AWS rollout serves signed object URLs
directly from S3; watch data-transfer costs in AWS Budgets. A private CloudFront
distribution with signed URLs is a later optimization, not part of this setup.
Supabase Storage remains in place for older uploads; existing records are not
rewritten by this change.

## Setup

### 1. Buckets

In AWS S3, create two buckets in the same region (for Kenya, start by evaluating
`af-south-1`):

| Bucket               | Access                         | Holds                        |
| -------------------- | ------------------------------ | ---------------------------- |
| `lawie-masters`      | **private — never public**     | originals, on the window     |
| `lawie-derivatives`  | **private — never public**    | browser-sized copies          |

For both buckets, keep **Block all public access** enabled, use bucket-owner
enforced object ownership, and enable default SSE-S3 encryption. S3 lifecycle
rules do not purge masters: the database retention queue and worker do that
only after a verified archival rendition exists.

Create an IAM principal restricted to `s3:GetObject`, `s3:PutObject` and
`s3:DeleteObject` on these two bucket ARNs. Do not grant `s3:*` or account-wide
access. Store its access key in Vercel environment variables and AWS Secrets
Manager for the worker; never put credentials in the browser or repository.

Add an S3 CORS rule allowing `PUT` from `https://www.lawiesounds.com`,
`https://lawiesounds.com`, and the local development origin in use. Allow the
`PUT` method and `*` request headers, and expose `ETag`. Uploads go directly
from the browser to the private master bucket using a short-lived signed URL.

### 2. Environment

Set these on Vercel (for the API) and on the worker host. The template is
`backened/.env.example`.

| Variable | Notes |
| --- | --- |
| `MEDIA_S3_REGION` | S3 region, e.g. `af-south-1` |
| `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | least-privilege S3 credentials |
| `MEDIA_S3_BUCKET_MASTERS`, `MEDIA_S3_BUCKET_DERIVATIVES` | private bucket names |
| `MEDIA_S3_ENDPOINT` | optional; omit for AWS S3, set for MinIO or another S3-compatible store |
| `MEDIA_S3_PATH_STYLE` | optional; defaults to virtual-hosted AWS URLs |
| `MASTER_RETENTION_MONTHS` | default `12`; `0` disables purging |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | worker only — it writes rendition rows |

The legacy `R2_*` variables remain supported during migration. With S3 unset,
the new media API answers 503 and old Supabase-backed gallery uploads continue.

Before deploying the album changes, apply
`database/migrations/2026-09-07_album_passcodes_and_consent_audit.sql`.
Live albums created under the old PIN policy move to draft and must receive a
new 6–8 digit PIN or 12–128 character password before republishing. This is
intentional: the old password hash does not reveal whether the PIN met the new
minimum length. The consent notice version is `public-use-v1`; update the API
constant and the database gallery guard together if that wording changes.

Example IAM policy for the two object prefixes (replace both bucket names with
the exact names you created):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
    "Resource": [
      "arn:aws:s3:::lawie-masters/*",
      "arn:aws:s3:::lawie-derivatives/*"
    ]
  }]
}
```

### 3. Run it

Locally, with MinIO instead of S3:

```bash
docker compose up          # minio + bucket bootstrap + worker
```

In production, build the image for an AWS ECS Fargate service. Keep one task
running initially; the worker polls the database queue and exits cleanly on
termination. Inject S3 credentials from Secrets Manager, plus the existing
Supabase worker credentials, as task secrets:

```bash
docker build -f worker/Dockerfile -t lawie-media-worker .   # context is the REPO ROOT
```

One replica is enough. It is safe to run several: claims go through
`FOR UPDATE SKIP LOCKED`, so two workers never take the same job.

## How an upload flows

```
browser                     API (Vercel)              S3                worker
   |  1. upload-url  ------>  writes media_assets      |                   |
   |     (+ SHA-256)          row, status=uploading    |                   |
   |  <-- presigned PUT ----                           |                   |
  |  2. PUT the ORIGINAL ---------------------------> private masters     |
   |  3. complete    ------>  HEAD confirms bytes,     |                   |
   |                          enqueues a derive job    |                   |
   |                                                   |  <-- claim -------|
   |                                                   |  <-- GET master --|
  |                                                   |  --- PUT ------>  private derivatives
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

The checks run with no network and no framework. The presigner is verified against
the signature test vector published by AWS — both the final signature and the
intermediate canonical-request hash, so a regression is localised rather than
appearing as an unexplained 403 from S3.
