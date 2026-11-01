# sonora-media-worker

Dramatiq worker that turns uploaded FLAC/MP3 files into streamable catalogue entries.
Consumes queue `media`, actor `process_upload(job_id)` (enqueued by the API on
`POST /v1/admin/uploads/{id}/complete` and on retry).

## Pipeline

Every stage is idempotent and checkpointed in `upload_jobs.state`; a failed job is retried
from its failed stage (or any earlier one) via `POST /v1/admin/jobs/{id}/retry`.

| Stage | What it does |
|---|---|
| probe | ffprobe; full decode; FLAC: decoded PCM must match the STREAMINFO MD5 |
| authenticity | spectral cliff detection → warning "suspected lossy source" (never a rejection) |
| tags | Vorbis/ID3 → title/version, main/featured artists, album, positions, ISRC/UPC, LRC/USLT/SYLT |
| fingerprint | SHA-256 + Chromaprint; duplicates rejected unless `allow_duplicate` |
| loudness | EBU R128 (integrated, LRA, true peak) → track gain to −14 LUFS, capped at −1 dBTP |
| catalog | artists / release / track rows (track stays `processing`) |
| transcode | quality ladder (never upscales), whole files + HLS fMP4, gapless edit lists, ABR master |
| waveform | 800 peaks |
| artwork | 64…3000 px × AVIF/WebP/JPEG, blurhash, palette with WCAG-AA text colour |
| preview | 30 s from the most energetic window, fades |
| lyrics | provisional v1 document (line-synced or static) |
| publish | track files, features, lyrics, album gain, release aggregates; `ready`; publish if asked |

Object keys: `sonora-media/tracks/<track>/<job>/…` (private, signed URLs) and
`sonora-public/covers/<release>/<hash>/<size>.<fmt>` (anonymous read). Keys embed the job id or
a content hash, so objects are immutable and CDN-cacheable for a year.

## Run

```bash
uv sync
uv run sonora-media-worker          # SONORA_WORKER_PROCESSES defaults to the CPU count
```

Needs `ffmpeg` with libsoxr and chromaprint (Debian/Ubuntu packages have both). With
`libfdk_aac` available the "low" tier becomes HE-AAC 64 kbit/s, otherwise AAC-LC 96 kbit/s.

## Tests

```bash
uv run ruff check . && uv run mypy && uv run pytest --cov=sonora_media
```

Fixtures are generated with ffmpeg at test time (hi-res FLAC, CD FLAC, MP3, a FLAC transcoded
from MP3 128, a corrupted file). The pipeline tests run against Postgres
(`SONORA_WORKER_TEST_DATABASE_URL`) with the API's migrations and a filesystem storage backend.
