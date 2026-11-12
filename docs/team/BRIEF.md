# Sonora v2 — team brief (read fully before starting)

## Project
Sonora is Denis's own music streaming service (he hosts it on his VPS for himself and friends).
Monorepo: FastAPI API (`services/api`), media pipeline (`services/media-worker`, Dramatiq + ffmpeg),
Next.js 16 / React 19 / Tailwind 4 site (`apps/web`, typed client from `packages/api-schema`),
native Android app (`apps/android`, Kotlin + Compose + Media3, Retrofit DTOs written by hand).
Read `README.md`, `ARCHITECTURE.md` and skim `BUGS.md` / `AUDIT.md` for conventions. All UI text is Russian.

What already exists (do not rebuild, extend): `GET /v1/me/wave` (stateless personal radio,
`services/api/src/sonora_api/services/recommend.py`), mixes, synced line lyrics on web and Android,
LRCLIB lookup at upload and an admin catalogue backfill, browser upload in `/admin/uploads`,
the "Резонанс" liquid-glass design system (`packages/design-tokens`).

## Team (4 agents in parallel, each in its own git worktree; the lead merges)
- **A — backend wave & lyrics**: Wave 2.0 API (contract below) + on-demand lyrics lookup.
- **B — open-source import (full stack)**: Jamendo / Internet Archive search & import, licences
  (API, migration 0007, media-worker, admin UI, licence note on the track page).
- **C — web**: new look for home / player / lyrics, Wave 2.0 client and settings.
- **D — Android**: same features as C on Android.

### File ownership (stay inside yours; the lead resolves anything else)
- A: `services/api/src/sonora_api/{services/recommend.py, services/wave.py (new), routers/recommend.py, schemas/recommend.py}`,
  the *public* lyrics read path (find where `GET /v1/tracks/{id}/lyrics` is served and touch only that function + a new helper module),
  tests `services/api/tests/test_recommend.py`, new `test_wave.py`, new `test_lyrics_on_demand.py`.
- B: `services/api/migrations/versions/0007_*.py`, `models/catalog.py` (Track licence columns only),
  `schemas/catalog.py` + `services/catalog.py` (TrackLicense / `TrackOut.license` only), `core/config.py`, `.env.example`,
  new `services/sources/**`, `routers/admin_sources.py` (+ include it in `main.py`), `schemas/sources.py`,
  new `tests/test_sources.py`; `services/media-worker/**`; web `apps/web/src/app/admin/**`,
  `apps/web/src/components/admin/**`, `apps/web/src/lib/admin.ts`, new `apps/web/src/components/LicenseNote.tsx`,
  `apps/web/src/app/track/[id]/**`.
- C: everything in `apps/web/**` except B's web paths.
- D: `apps/android/**` only.

Nobody edits: `CHANGELOG.md`, `README.md`, `ROADMAP.md`, `packages/design-tokens/**`,
`packages/api-schema/openapi.json`, `packages/api-schema/src/schema.gen.ts`, `.github/**`, lockfiles.
(The lead regenerates the OpenAPI document and TS client from the API in CI after merging.)

## Environment limits — important
- No network installs: `pip`, `uv sync`, `npm/pnpm install`, Gradle downloads are refused. There are no
  node_modules, no API Python deps, no Android SDK. You cannot run the test suites or builds.
- Available locally: `git`, `ruff` (run `ruff format` and `ruff check` from `services/api` /
  `services/media-worker` — config is in their pyproject), `python3 -m py_compile`, `grep`, etc.
- After merging, the lead pushes and GitHub CI runs everything: ruff format --check, ruff check,
  **mypy --strict**, pytest (Postgres+pgvector, Redis), OpenAPI check, `pnpm -r build/typecheck/test/lint`
  (TS strict, ESLint), web Docker build, Android `recordRoborazziDebug` + `assembleDebug/Release` + `lintDebug`.
  So write code that compiles the first time: read the real signatures you call, mirror existing
  patterns exactly, keep full typing, no unused imports/vars, no `any`.
- **No new dependencies** in any stack (lockfiles are frozen).
- Keep changes focused and production-quality; no placeholder code, no TODO stubs for core behaviour.

## Contract (A implements; B/C/D rely on these exact names — Pydantic class names become TS schema names)

### Wave 2.0 (A)
```
WaveSettings          { character: "favorite"|"discover"|"popular"|null = null,   # Любимое / Незнакомое / Популярное
                        mood: "energetic"|"happy"|"calm"|"sad"|null = null,       # Бодрое / Весёлое / Спокойное / Грустное
                        language: "russian"|"foreign"|"instrumental"|null = null } # Русский / Иностранный / Без слов
WaveStartIn           { settings: WaveSettings = {}, seed_track: uuid|null = null, seed_artist: uuid|null = null, limit: int 1..50 = 20 }
WaveSessionOut        { session_id: uuid, settings: WaveSettings, tracks: TrackOut[] }
WaveFeedbackIn        { track_id: uuid, action: "started"|"finished"|"skipped"|"liked"|"disliked", played_ms: int>=0|null = null }

POST /v1/me/wave/sessions                         body WaveStartIn   -> 201 WaveSessionOut
GET  /v1/me/wave/sessions/{session_id}/next?limit=1..50 (default 10) -> 200 TrackOut[]
POST /v1/me/wave/sessions/{session_id}/feedback   body WaveFeedbackIn -> 204
GET  /v1/me/wave/settings                         -> 200 WaveSettings   (settings of the user's latest session; all null if none)
```
- Unknown session or another user's session -> 404 with the project's error envelope.
- `next` never repeats a track already served in the session; when the catalogue is exhausted it may
  repeat tracks not served in the last 30. Never returns an empty list if any playable track exists
  (filters relax progressively: language -> mood -> character).
- Feedback: `skipped` with played_ms < 30000 pushes that artist/genre down for the rest of the session;
  `liked` also likes the track (idempotent) and pulls similar music up; `disliked` stores a track Dislike
  (idempotent) and pushes the artist down (client skips to the next track itself); `finished` is a mild
  positive signal. Disliked tracks/artists never appear in any wave.
- Existing `GET /v1/me/wave` keeps working unchanged (old clients).
- Clients still report plays through the existing `/v1/events/batch`; wave feedback is extra.

### Lyrics (A)
`GET /v1/tracks/{id}/lyrics` keeps its response shape. New: if the track has no lyrics, the server tries
LRCLIB once (strict match as in the existing enrich code), stores the result and returns it; a miss is
cached (Redis, 7 days) and the endpoint answers with the existing not-found error. Respect the existing
platform switch that disables enrichment. Clients may therefore ask for lyrics even when `has_lyrics` is false.

### Open-source import (B)
```
SourceOut       { key: "jamendo"|"internet_archive", title: str, description: str, enabled: bool, disabled_reason: str|null }
SourceLicense   { code: str, url: str|null }                # e.g. "CC BY-SA 4.0", "CC0 1.0", "Public Domain"
SourceTrackOut  { source: str, external_id: str, title: str, artist: str, album: str|null, duration_s: int|null,
                  license: SourceLicense, artwork_url: str|null, preview_url: str|null, page_url: str,
                  format: str, already_imported: bool }
SourceImportIn  { external_ids: str[1..50], publish: bool = false }

GET  /v1/admin/sources                              -> SourceOut[]
GET  /v1/admin/sources/{key}/search?q=..&limit=1..50 (20) -> SourceTrackOut[]
POST /v1/admin/sources/{key}/import  body SourceImportIn  -> 202 list of the existing upload-job schema
```
Catalogue: `TrackOut.license: TrackLicense | null` with
`TrackLicense { code: str, url: str|null, source: str|null, source_url: str|null, attribution: str|null }`
(null for the owner's own uploads). Android may add it as an optional DTO field.

## When you finish
1. Run what you can (ruff format + ruff check for Python you touched; py_compile).
2. Commit everything in your worktree with clear conventional-commit messages (`feat(api): …`,
   `feat(web): …`, `feat(android): …`). Do not push.
3. Final report (English is fine, keep it tight): branch name and commit hashes; what you built;
   files touched; anything outside your ownership you had to touch and why; what you could not verify
   and the riskiest spots for CI (types, imports, signatures); 3–8 CHANGELOG bullet lines **in Russian**
   for the lead.
