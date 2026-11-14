# REVIEW-01 — qa-web (site QA through Playwright)

Stack: slot 0, http://127.0.0.1:8080, branch `team/v2` @ 427ad0e. Screenshots: `screenshots/r01/qa-web/`.
Status: IN PROGRESS — findings are appended as they are confirmed; "Not covered" is written last.

## e2e runs (BASE=http://127.0.0.1:8080, run by qa-web)
| Flow | Result |
|---|---|
| app-flow.cjs | 17/17 PASS |
| player-flow.cjs | 13/13 PASS |
| features-flow.cjs | 13/13 PASS |
| qa-flow.cjs | 33/33 PASS |
| discovery-flow.cjs | 9/10 — FAIL «wave keeps going past the catalogue size — 12» (reproduced, root cause in F-01) |
| themes.cjs | no errors, both themes applied |
| audio-cache.cjs | ran, cache 17 entries within budget (script prints stats, has no assertions) |
| perf.cjs | p95 frame 16.8 ms, 0 frames over 20 ms, 0 layouts (script prints stats, has no assertions) |
| audio-cache-long.cjs | see below |

## Findings

### F-01 [important] Wave stops on a small catalogue: the web client throws away the repeats the API serves and then backs off 15 s (root cause of the discovery-flow failure)
- **Where:** `apps/web/src/lib/recommend.ts:135-136` (de-dup against the last 30 queue items) + `:144` (15 s back-off when nothing was added) + `apps/web/src/player/controller.ts:119` (refill is requested only from `onProgress`, when fewer than 3 tracks are upcoming).
- **It is the web client, not the API.** The API honours the contract. Proof (curl as admin, catalogue = 12 playable tracks): `POST /v1/me/wave/sessions {limit:20}` → 12 tracks; six consecutive `GET …/next?limit=10` → 200 with 2 tracks each, always the two served longest ago (gap to their previous serve 10–11). That is `REPEAT_WINDOWS = (30, 10, 1, 0)` in `services/api/src/sonora_api/services/wave.py:72` and the loop at `wave.py:487-491` shrinking the no-repeat window for a tiny catalogue — «never returns an empty list», as BRIEF.md demands.
- **What the client does with it:** `refill()` builds `fresh = freshTracks(playable, now.queue.items.slice(-30)…)`. With a 12-track queue every track the server can possibly return is inside "the last 30", so `fresh` is always empty; line 136 then adds the repeats only if there is *no* upcoming track at all (`upcoming(now.queue, 1).length ? [] : playable`). The low-queue tick starts at 3 upcoming, so the first refills (2 and 1 upcoming) are discarded, `added` stays false and line 144 arms `refillAfter = now + 15 s`. A listener who skips reaches the last track inside that back-off; «Следующий» on the last track then has nothing to go to and the "endless" wave ends. The queue stays at 12 — exactly what the e2e reports.
- **Side effect:** every discarded batch was already recorded as served on the server (`wave.py:329 _remember`), so the session's history drifts away from what was actually played (the server believes tracks were heard that the client dropped).
- **Should:** the wave never ends while a playable track exists; a refill that returns only repeats must still extend the queue.
- **Evidence:** `apps/web/e2e/discovery-flow.cjs:44` FAIL (`queue=12`); curl transcript above; live trace in F-02 below.
- **Suggested fix:** in `refill()` trust the server's ordering: de-dup only against the *upcoming* part of the queue plus the currently playing track (not the played history), i.e. `freshTracks(playable, [current, ...upcoming])`, and append whatever is left; do not arm the back-off when the server returned a non-empty batch that was merely filtered — or request the refill when `upcoming < 3` with `limit` and accept repeats as soon as `fresh` is empty and `upcoming < 3`. Also call `onQueueLow` from `next()`/`onEnded`, not only from progress ticks, so a fast skipper triggers it. Add a unit test for a catalogue smaller than the start batch.
