# Sonora team — working guide for every agent

Read this once, then your role file in `.claude/agents/<role>.md`, then the round plan
`docs/team/PLAN-NN.md` (it overrides the default file zones in your role file).
Owner: Denis. All interface text is Russian. Reports to the lead may be in English.

## Where you work
- The lead gives you a **worktree** (`/home/user/wt/rNN-<role>`, branch `round-NN/<role>`) and a
  **slot number**. Work only inside your worktree. Never `git push`, never touch `team/v2` or the
  default branch, never edit another role's zone. If you need something outside your zone, write
  it in your report (or, if tiny and blocking, do it and say so explicitly).
- Review roles read the code in the lead's checkout (`/home/user/spotneiroslop`, branch `team/v2`)
  and use slot 0 (http://127.0.0.1:8080) unless told otherwise. Reviewers do not edit product code;
  they write findings.

## Your private stack (slot N)
```
cd <your worktree>
tools/dev/stack.sh up N          # API+worker+site+edge on http://127.0.0.1:$((8080+N)); DB copied from the seed
tools/dev/stack.sh api N         # after backend changes (runs migrations, restarts API and worker)
tools/dev/stack.sh web N         # after frontend changes (production build, restart)
tools/dev/stack.sh reset N       # fresh database from the seed
tools/dev/stack.sh down N        # ALWAYS when you finish
eval "$(tools/dev/stack.sh env N)"   # exports incl. per-slot TEST databases — do this before pytest
```
Seed login: `admin@e2e.example.com` / `e2e admin pass` (admin). The machine has 4 cores shared by
the whole team: do not run builds in loops, do not start the stack if you do not need it, stop it
when done. Gradle: one build at a time per agent, always `--no-daemon` is NOT needed locally — use
the daemon, but run `./gradlew --stop` when you finish.

## Checks you must run for what you touched (all must pass before you commit)
- API (`services/api`): `uv run ruff format . && uv run ruff check . && uv run mypy && uv run pytest -q`
  (after `eval "$(tools/dev/stack.sh env N)"`). mypy is strict, tests included.
- If you changed API schemas/routes: `uv run python scripts/export_openapi.py` and
  `pnpm --filter @sonora/api-schema generate` **only if the plan says you own the generated files**;
  otherwise the lead regenerates after merging (say so in your report).
- Media worker (`services/media-worker`): same four commands (it imports `sonora_api` as a path dependency).
- Web (`apps/web`): `pnpm --filter @sonora/web typecheck && pnpm --filter @sonora/web lint --max-warnings 0 && pnpm --filter @sonora/web test`,
  then verify in a real browser on your slot with Playwright (`require('playwright')` works from any
  directory; Chromium is preinstalled; existing flows live in `apps/web/e2e/*.cjs`, run them with `BASE=http://127.0.0.1:$((8080+N))`).
  Look at your own screenshots (Read tool) at 1440, 768 and 390 px, dark and light theme.
- Android (`apps/android`): `export ANDROID_HOME=/opt/android-sdk; ./gradlew recordRoborazziDebug lintDebug assembleDebug`.
  Screens render to `app/build/outputs/roborazzi/*.png` — look at them. If the local SDK build is
  unavailable, say so; the lead verifies through GitHub CI.
- Never claim something works unless you ran it and saw it. Say exactly what you could not verify.

## Code rules
- Production quality, no placeholders, no TODO stubs, no dead buttons, no copy-paste blocks, no invented numbers.
- Strict types everywhere (`mypy --strict`, TS strict, no `any`), zero linter warnings.
- A test for every feature; fix bugs at the root cause and log them in your report (the lead writes BUGS.md).
- No new dependencies unless PLAN-NN lists them with a reason. Lockfiles are changed only by the role the plan names.
- Do not break what works: run the existing tests/e2e of your area, not only your new ones.
- Web performance rules (learned the hard way, see BUGS.md B-054/B-055): no per-frame writes of CSS
  variables on `:root`, animate only `transform`/`opacity`, no `backdrop-filter` on scrolling content
  or wide surfaces (only small "chrome" pills), no layout thrash, respect `prefers-reduced-motion`.
- Android: respect the system animator duration scale (animations off), stateless screen content
  with `Env`/`Actions` so Roborazzi can render every screen.
- Security: every endpoint checks authorisation; anything that fetches a URL validates the host
  (no SSRF), uploads are size- and type-checked; no secrets in clients or in the repository.
- Music sources: only legal open-licence sources (Jamendo, Internet Archive). Never YouTube, VK, Yandex, Spotify.
- Do not edit: `CHANGELOG.md`, `ROADMAP.md`, `README.md`, `BUGS.md`, `docs/team/ROUNDS.md` (lead only).

## Save as you go
The account has a usage limit that can stop every agent mid-task. Reviewers: create your findings
file first and append each finding the moment it is confirmed. Builders: commit each working piece
separately. Work that exists only in your head is lost when the limit hits.

## When you finish
1. All checks above green. `tools/dev/stack.sh down N`; `./gradlew --stop` if you used Gradle.
2. Commit in your worktree (conventional commits: `feat(api): …`, `fix(web): …`). End every commit message with:
   ```
   Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01Esbbiwa47yrQoZBgUHRxCb
   ```
   Do not put any model name anywhere else in the repository.
3. Final message to the lead, tight (under ~40 lines): branch + commits; what you built; files outside
   your zone you touched and why; what you ran and the results; what you could NOT verify; risks;
   3–8 CHANGELOG bullets **in Russian**; ideas for the next round.
