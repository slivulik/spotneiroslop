# Sonora — instructions for Claude Code

Owner: Denis (speaks Russian; answer him in Russian, kindly). This repo is his music streaming
service: FastAPI API, media-worker, Next.js site, native Android app.

## How work is organised
Work runs in **rounds** with a large team of subagents — read `docs/team/PROCESS.md` (process)
and `docs/team/BRIEF.md` (team brief, file ownership, API contracts, environment limits).
Integration branch: `team/v2` (draft PR against the default branch). Never push to the default branch.

Each round: ideas (idea generator + recommendation scientist, outputs `docs/team/IDEAS.md`,
`docs/team/RECS.md`) → build team in parallel (separate git worktrees, strict file ownership)
→ fresh review team (QA of every feature, design critic on Android Roborazzi renders, tech
reviewer, product critic) writes `docs/team/REVIEW-NN.md` → fix pass → CI green on GitHub →
log the round in `docs/team/ROUNDS.md`. Up to 50 rounds; the project is not done while any
detail of design, animation, tech or recommendations is unpolished. Lines of code are not a goal.

Mandatory backlog: «Мэтч» swipe feed (right = like, left = not interested) and best-in-class
recommendations (see RECS.md once written).

## Checks
`make check` locally if deps are installed; otherwise rely on GitHub CI (`ci` runs on PRs,
`android` on pushes and publishes screen renders to the `android-screenshots` branch).
After API changes regenerate `packages/api-schema/openapi.json` (`services/api/scripts/export_openapi.py`)
and `src/schema.gen.ts` (`pnpm --filter @sonora/api-schema run generate`).
