# =============================================================================
#  THE MEDIA WORKER IMAGE
#
#  WHERE DOCKER ACTUALLY BELONGS IN A CLOUD-STORAGE SETUP
#  ------------------------------------------------------
#  Not around the object store. Running MinIO or Ceph in a container to "own
#  our storage" means owning disk failure, replication, backups and durability
#  for the one thing in the business that must never be lost — a photograph
#  cannot be regenerated. R2 already does that for $0.015/GB-month.
#
#  Not around the API either. That is a request/response app with no native
#  dependencies; Vercel runs it for nothing and a container would only add a
#  machine to keep alive.
#
#  Here. This image exists because image and video derivation is the one part
#  of the system with heavy native dependencies (libvips, ffmpeg), CPU-bound
#  work measured in tens of seconds, and a bursty load — nothing for six days,
#  then four hundred photographs on a Sunday night. That combination is exactly
#  what serverless is worst at and what a scale-to-zero container is best at.
#
#  The same image is what `docker compose up` runs locally against MinIO, so
#  the encoder that produced a rendition on a laptop is byte-for-byte the one
#  that produces it in production. That reproducibility is the second reason
#  for the container, and on a media pipeline it is not a small one: ffmpeg
#  output differs between versions.
#
#  BUILD CONTEXT IS THE REPOSITORY ROOT, not worker/:
#      docker build -f worker/Dockerfile -t lawie-media-worker .
#  The worker shares backened/src/media with the API — the presigner, the key
#  scheme and the rendition ladder have exactly one definition each, and a
#  container that copied its own fork of them would drift.
# =============================================================================

FROM node:24-bookworm-slim

# ffmpeg for video, and the codecs it needs. sharp ships prebuilt libvips
# binaries, so there is nothing to compile — which is why this stays slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies before source, so an edit to the worker does not re-resolve npm.
# npm ci, not npm install: the lockfile is committed, and a media pipeline is
# exactly the place where "it encoded differently on the server" is expensive to
# diagnose. Same libvips, same ffmpeg bindings, every build.
COPY worker/package.json worker/package-lock.json ./worker/
RUN cd worker && npm ci --omit=dev --no-audit --no-fund

# Shared with the API. See the note above about why this is copied rather than
# duplicated.
COPY backened/src/media ./backened/src/media
COPY worker/src         ./worker/src

# Unprivileged. The worker writes only to /tmp, which it creates per job and
# removes afterwards.
USER node

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080

# The health endpoint reports in-flight work, so an orchestrator restarting a
# wedged worker does not kill one that is mid-encode.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "worker/src/index.js"]
