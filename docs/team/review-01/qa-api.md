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

### W-2 [important] With 2–10 playable tracks the wave repeats a track after only 2 others (repeat window jumps 10 → 1)
- **Where:** `services/api/src/sonora_api/services/wave.py:72` (`REPEAT_WINDOWS = (30, 10, 1, 0)`), `:487-491`; candidates are then ranked by score, not by how long ago they were served.
- **Repro:** fresh user, `POST /v1/me/wave/sessions {"limit":4}`; dislike the first two tracks
  (`POST …/feedback {"track_id":…, "action":"disliked"}` ×2 → 204), leaving 10 playable tracks; then 30 × `GET …/next?limit=5`.
- **Actual:** 90 tracks served, gaps between two serves of the same track: `{3: 1, 4: 3, 5: 5, 6: 4, 7: 9, …}` — the same track came back after 2, 3 and 4 other tracks although 10 playable tracks exist (window 10 hides all 10, so the code falls straight to window 1).
- **Expected:** «may repeat tracks not served in the last 30», degraded gracefully: with N playable tracks a track should not return before ~N−1 others.
- **Fix:** replace the fixed steps with `window = min(30, playable_count − 1)` (or serve least-recently-served first) in `_pick`.

### W-3 [important] A dislike cannot be seen or undone through the API; the library «like» does not clear it, and a dislike does not clear the like
- **Where:** `services/api/src/sonora_api/services/wave.py:215-232` (the only writer of `Dislike`), `services/api/src/sonora_api/services/library.py` (`set_saved` never touches `Dislike`); no `/v1/me/dislikes` route in `openapi.json`, `LibraryIds` has no dislikes.
- **Repro:** `POST /v1/me/wave/sessions/{sid}/feedback {"track_id":T,"action":"disliked"}` → 204. Then
  `PUT /v1/me/library/tracks/T` → 204, `GET /v1/me/library` lists T as liked, but a new `POST /v1/me/wave/sessions {"limit":50}` never contains T (and `GET /v1/me/wave` neither).
  Only `feedback {"action":"liked"}` inside some wave session brings it back.
  The other way round: `feedback liked` ×3 then `feedback disliked` ×3 → all 204, `GET /v1/me/library` still lists T under `tracks` — the track is liked and disliked at once (it stays in «Любимое», keeps feeding the taste profile, never plays in the wave).
- **Expected:** one state per track. Liking by any route clears the dislike; disliking removes the like (or is refused); the client can list and remove dislikes (a mis-tap on «не нравится» is otherwise permanent — there is no `until`, no list, no delete).
- **Fix:** move the dislike/like exclusivity into `library.set_saved` (delete `Dislike` on save of a track) and `wave.feedback` (`set_saved(..., saved=False)` on `disliked`); add `GET /v1/me/dislikes` + `DELETE /v1/me/dislikes/{kind}/{id}` and `disliked_tracks` in `LibraryIds`.

### E-1 [important] `POST /v1/events/batch` answers 500 for a timestamp without a time zone
- **Where:** `services/api/src/sonora_api/services/events.py:62` (`played_at=min(event.at or now, now)`), schema `services/api/src/sonora_api/schemas/events.py` (`at: datetime | None`).
- **Repro:** `POST /v1/events/batch` (any logged-in user)
  `{"events":[{"event_id":"<uuid4>","type":"play_end","track_id":"<existing track>","ms_played":40000,"at":"2026-11-14T10:00:00"}]}`
- **Actual:** `500 {"error":{"code":"internal_error","message":"Internal server error",…}}`; log: `TypeError: can't compare offset-naive and offset-aware datetimes`. The whole batch (up to 500 events) is lost, and a client that re-queues failed batches (web `player/events.ts:41`) would retry the poisoned batch forever.
- **Expected:** 422 for a naive timestamp, or treat it as UTC.
- **Fix:** type the field as `pydantic.AwareDatetime` (→ 422) or normalise in a validator (`value.replace(tzinfo=UTC)` when `tzinfo is None`).

### E-2 [important] Play counters can be inflated at will: one request adds 500 «plays», no plausibility checks
- **Where:** `services/api/src/sonora_api/services/events.py:28-86`, schema `schemas/events.py:10-21`.
- **Repro (ordinary user):** `POST /v1/events/batch` with 500 events `{"event_id":"<new uuid4>","type":"play_end","track_id":"<Wave 3>","ms_played":40000}` (no `at`).
- **Actual:** `200 {"accepted":500,"duplicates":0,"counted_plays":500}`; admin list shows `play_count` of the track 0 → 500 after that single request; `GET /v1/me/stats` → `"plays":504,"minutes":1775` for an account that is two seconds old. With 600 requests/minute per user that is 300 000 plays a minute. Also accepted: `ms_played: 86400000` (24 h) for a 6-minute track; `at: "1970-01-01T00:00:00Z"` and `at: "0001-01-01T00:00:00Z"` (stored as is, returned by `/v1/me/history` as `0001-01-01T00:00:00` without a zone); `play_end` without any `play_start`.
- **Why it matters:** `play_count` feeds the wave ranking (`recommend._score`), the «popular» wave character, `/v1/search?sort=popular`, popular searches fallback, artist stats and admin statistics — one friend can pin any track to the top of everybody's recommendations. `DELETE /v1/me/history` afterwards removes the evidence but not the counter (500 stays).
- **Expected:** counted plays bounded by reality.
- **Fix:** in `ingest`: clamp `ms_played` to `duration_ms` (+ small slack); reject/ignore `at` older than e.g. 7 days; count at most one play per (user, track) per `duration` window (compare with the user's previous `played_at` for that track) and cap counted plays per batch by elapsed wall time since the user's last counted play.

### L-1 [minor] `GET /v1/me/history` returns fewer rows than asked because identical rows are collapsed after `LIMIT`
- **Where:** `services/api/src/sonora_api/services/library.py:332-346` (`.limit(limit)` then `.unique()` over `(Track, played_at, ms_played)`).
- **Repro:** post one batch of 500 `play_end` events for the same track without `at` (they all get the same server `now`), plus 4 earlier plays of another track; `GET /v1/me/history?limit=200` → `200`, **1** item (the 200 newest rows are identical and collapse; the 4 older plays are cut off by the SQL limit).
- **Expected:** up to `limit` entries, one per stored play; older entries reachable (there is no cursor/offset on this route at all — anything beyond the newest 200 rows is unreachable).
- **Fix:** select `ListeningHistory.id` as well (rows become distinct) and add cursor pagination like `/v1/releases`.

### P-1 [important] Concurrent `POST /v1/me/playlists/{id}/tracks` → 500 and lost tracks
- **Where:** `services/api/src/sonora_api/services/library.py:289-297` (`add_tracks`: read order → rewrite all positions, no lock).
- **Repro:** own playlist with 4 tracks; 8 parallel requests `POST /v1/me/playlists/{id}/tracks {"track_ids":["<one of 4 other tracks>"]}`.
- **Actual:** `[200, 200, 500, 500, 200, 200, 200, 500]`; afterwards the playlist has 6 tracks (2 of the 4 distinct new tracks are missing although some of their requests answered 200). Log: `IntegrityError … duplicate key value violates unique constraint "uq_playlist_tracks_playlist_id_position"`.
- **Expected:** every request 200 and all 4 tracks present (two devices, or «add album to playlist» fired per track, is a normal situation).
- **Fix:** `SELECT … FOR UPDATE` on the playlist row in `_own` for mutating calls (add/remove/reorder), or retry once on `IntegrityError`; never surface it as 500. The same pattern is in `remove_track`/`reorder` and the admin `PUT /v1/admin/playlists/{id}/tracks`.

### P-2 [minor] A playlist can be created with an empty title
- **Where:** `services/api/src/sonora_api/schemas/library.py` (`UserPlaylistIn.title` has `min_length=1` but no strip), `services/library.py` create path strips afterwards.
- **Repro:** `POST /v1/me/playlists {"title":"  "}` → `201 {"id":…,"title":"",…}`. `PATCH` of the same playlist with `{"title":null}` answers `422 "title cannot be empty"`, so the rule exists but the create path bypasses it.
- **Fix:** `StringConstraints(strip_whitespace=True, min_length=1)` on both create and patch schemas (same for admin playlist/genre/section titles, see A-… below if listed).

### G-1 [important] Every `offset` parameter answers 500 above 2^63−1
- **Where:** `offset: Annotated[int, Query(ge=0)]` without an upper bound in `routers/library.py` (`/v1/me/library/tracks`) and `routers/admin_catalog.py` / `admin_users.py` (`/v1/admin/artists|releases|tracks|users`).
- **Repro:** `GET /v1/me/library/tracks?offset=9223372036854775808` (any user) → `500 {"error":{"code":"internal_error",…}}` (asyncpg: value out of int64 range). Same on the four admin lists. `offset=9223372036854775807` → 200.
- **Expected:** 422.
- **Fix:** `Query(ge=0, le=1_000_000)` (one shared `Offset` alias).

### LY-1 [important] Lyrics of an unpublished (draft / scheduled) release are served to any logged-in user
- **Where:** `services/api/src/sonora_api/routers/public.py:84` — the lookup is `Track.status == READY` only; every other track route uses `catalog.track_visible(now)` (release published and `publish_at` reached).
- **Repro:** admin: `PATCH /v1/admin/releases/{rid} {"status":"draft"}` (release «Северное сияние»). Ordinary user:
  `GET /v1/tracks/{tid}` → `404 Track not found`; `GET /v1/tracks/{tid}/stream` → `404`; `GET /v1/tracks/{tid}/lyrics` → **`200 {"type":"line","lines":[{"start_ms":2000,"end_ms":6500,"text":"Над городом гаснет свет"},…]}`**.
- **Also:** for a hidden-release track *without* lyrics the same request triggers the new on-demand LRCLIB lookup, i.e. artist + title of an unreleased track are sent to a third party on a listener's request.
- **Expected:** 404, same as the track itself.
- **Fix:** `select(Track).join(Track.release).where(Track.id == track_id, catalog.track_visible(now))` in `get_lyrics` (admins have their own `/v1/admin/tracks/{id}`).

### LY-2 [minor] On-demand lyrics: what was verified, what was not
- Verified live (LRCLIB reachable from the stack): first request for a track without lyrics → `204` in 0.69 s, `lyrics:miss:{track}` written with TTL 604800 s; second request `204` in < 10 ms and no outbound call; 6 parallel first requests → one lookup (0.69 s), five immediate `204`; with `PATCH /v1/admin/platform {"metadata_lookup":false}` → `204` at once and no miss key written. All correct.
- Contract drift: BRIEF says a miss «answers with the existing not-found error»; the endpoint answers `204` with an empty body (documented in OpenAPI as 204). Clients handle 204, so only the brief is wrong — fix the brief or the code, not both.
- The miss key is per track id and is not dropped when an admin edits the title/artists (`PATCH /v1/admin/tracks/{id}`), so a corrected typo still waits 7 days for a new lookup. Suggested: `redis.delete(miss_key(id))` in the admin track patch.
- The lookup runs inside the listener's request with `httpx.Timeout(8.0, connect=5.0)` and two sequential LRCLIB calls (`enrich/lrclib.py:60,63`): a slow LRCLIB can hold the lyrics request for ~16–26 s. **Not verified** (cannot slow LRCLIB down from here). Suggested: overall deadline of ~3 s via `asyncio.wait_for`, answer 204 and finish in the background.
- **Not verified:** a positive hit against live LRCLIB (the seed catalogue is synthetic; durations cannot be edited to match a real song). Covered only by the mocked unit tests.

