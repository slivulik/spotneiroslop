# HANDOFF-01 — round 1 handed to the review team

Branch `team/v2` (PR #1, draft). Stack for review: slot 0, http://127.0.0.1:8080
(`admin@e2e.example.com` / `e2e admin pass`). Android: build locally with
`ANDROID_HOME=/opt/android-sdk ./gradlew recordRoborazziDebug` (renders in
`apps/android/app/build/outputs/roborazzi/`, 21 screens) or use the `android-screenshots` branch.
"Before" state = default branch `claude/music-streaming-service-lmj2g3` (commit 0a051d1);
diff of the round: `git diff 0a051d1..team/v2`. Contracts of the round: `docs/team/BRIEF.md`.

## What changed in round 1
| Area | What | Where | How to verify |
|---|---|---|---|
| Wave 2.0 (API) | Wave sessions with settings (character / mood / language), `next` without repeats, feedback (started / finished / skipped / liked / disliked), last settings | `services/api/.../services/wave.py`, `routers/recommend.py`, `tests/test_wave.py` | Contract in BRIEF.md; curl every route; disliked tracks/artists never return; filters relax instead of returning an empty list |
| Wave 2.0 (web) | «Моя волна» hero on the home page, tuning sheet, session client with feedback | `apps/web/src/components/wave/**`, `lib/wave*.ts`, `app/page.tsx` | Start the wave, change settings, skip early, like/dislike, play past the catalogue size |
| Lyrics on demand | `GET /v1/tracks/{id}/lyrics` looks up LRCLIB once when a track has none; miss cached 7 days; platform switch respected | API lyrics read path, `tests/test_lyrics_on_demand.py` | Track without lyrics → request → stored; second miss does not call out again |
| Karaoke lyrics | Full-screen player redesign, line-by-line karaoke fill, manual scroll hold + «follow» | `apps/web/src/components/player/{NowPlaying,Lyrics}.tsx`, `player/**` | Player with lyrics at 1440 and 390 px; seek by tapping a line; reduced motion |
| Open-source import | Search + import from Jamendo and Internet Archive, licences on tracks (`TrackOut.license`), worker fetch stage, admin page «Открытые источники», licence note on the track page | `services/api/.../services/sources/**`, `routers/admin_sources.py`, migration 0007, `services/media-worker/.../pipeline.py`, `apps/web/src/app/admin/import/**` | Admin → import; Jamendo needs `SONORA_JAMENDO_CLIENT_ID` (not set here); Internet Archive search works live (archive.org is reachable; its download hosts are NOT reachable from this machine) |
| Android | Wave 2.0, wave hero, now-playing redesign, karaoke lyrics | `apps/android/**` | Renders + code trace; DTOs vs `packages/api-schema/openapi.json` |
| Earlier, same branch base | Radio by track/artist, sleep timer, shortcuts overlay, even dock, catalogue backfill of covers and synced lyrics, concept-A home | see CHANGELOG / BUGS B-052…B-055 | `apps/web/e2e/features-flow.cjs` etc. |

## State of the checks at handoff (run by the lead)
- API: ruff, mypy --strict, OpenAPI check, 130 tests — green. Worker: ruff, mypy, 60 tests — green.
- Web: build, typecheck, 45+22 unit tests, ESLint with zero warnings — green.
- e2e on slot 0: app-flow 17/17, player-flow 13/13, features-flow 13/13, qa-flow 33/33,
  **discovery-flow 9/10 — FAIL «wave keeps going past the catalogue size» (queue stays at 12)**. Not fixed on purpose: confirm the root cause.
- Android local build: renders 21 screens, debug APK builds; the first run had one failing unit test that passed on retry (find which, and why it is flaky).
- GitHub CI on PR #1 was red before the lead's two fixes; a new run is in progress.

## Known gaps (do not rediscover, do go deeper)
- No recommendation offline evaluation yet (being built in parallel: `round-01/recs-eval`).
- The seed catalogue is tiny (11 tracks, synthetic); a larger seed is being built in parallel (`round-01/seed`).
- `CHANGELOG.md` has no entry for round 1 yet (lead).
- «Мэтч», DSP features, embeddings — planned for round 2 (`IDEAS.md`, `RECS.md`).

## What the review team must do
Check **all** features, not only the new ones. Write `docs/team/review-01/<role>.md` using the
format in your role file. Reviewers needing a private database: qa-api → slot 1, security-auditor → slot 2,
perf-auditor → slot 3 (`tools/dev/stack.sh up N` from `/home/user/spotneiroslop`; stop it when done).
Everyone else: slot 0, read-mostly (create your own test users/playlists; do not delete seed data).
Screenshots → `screenshots/r01/<role>/`.
