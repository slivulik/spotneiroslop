# Review 01 — qa-api

Scope: every route in `packages/api-schema/openapi.json`, exercised against a private stack
(slot 1, API directly on `http://127.0.0.1:8201`, branch `team/v2`). Scripts used live outside the
repository (session scratchpad). This file is appended to as findings are confirmed — it always
reflects everything found so far.

Status: **in progress**.

## Findings

### W-1 [important] Known e2e failure «wave keeps going past the catalogue size» — the API does keep serving; the web client throws the repeats away
- **Where:** API `services/api/src/sonora_api/services/wave.py:72` (`REPEAT_WINDOWS = (30, 10, 1, 0)`), `:487-491`; web `apps/web/src/lib/recommend.ts:135` (`freshTracks(playable, now.queue.items.slice(-30)…)`).
- **Repro (12-track seed catalogue, fresh user):**
  `POST /v1/me/wave/sessions {}` → 201, 12 distinct tracks. Then 12 × `GET /v1/me/wave/sessions/{sid}/next?limit=10` →
  every call is `200` with **2** tracks, each last served 10–12 positions ago (`gaps_since_last_serve=[11, 11]`, `[10, 12]` …).
  With `limit=1`, 41 calls in a row: 41 tracks, 0 empty answers, 0 immediate repeats, order of first serve roughly preserved.
- **Verdict on the contract:** «never empty if any playable track exists» is honoured. «May repeat tracks not served in the last 30» cannot hold with 12 tracks, so the server shrinks the window 30 → 10 and repeats tracks served 10+ positions ago. The web client then filters the refill against the last 30 queue items, so with ≤ 30 playable tracks everything the server sends is discarded while at least one upcoming track is still queued (`recommend.ts:136` only falls back to the repeats when nothing is upcoming) and the queue stays at 12 — that is the e2e failure. Root cause is the client/server window mismatch, not an empty API answer.
- **Second-order API defect:** after exhaustion a `limit=10` request returns only `catalogue − window` tracks (2 here; 1 with an 11-track catalogue), so a client needs 5× more round trips; and the window steps are coarse (30 → 10 → 1 → 0), see W-2.
- **Fix:** server: when nothing new is left, order the already-served tracks by least-recently-served and return up to `limit` of them, excluding only the last `min(30, distinct_playable − 1)` (continuous window instead of four steps). Client: dedupe a refill only against tracks *after* the current queue position (or accept server repeats once the server has started repeating), not against the last 30 queued items.

