-- Listening & interaction events. Written in batches by the API (/v1/events/batch).
CREATE TABLE IF NOT EXISTS sonora.events
(
    event_id      UUID,
    ts            DateTime64(3, 'UTC'),
    received_at   DateTime64(3, 'UTC') DEFAULT now64(3),
    user_id       UUID,
    device_id     UUID,
    platform      LowCardinality(String),
    type          LowCardinality(String),   -- play_start, play_end, skip, like, dislike, seek, ...
    track_id      Nullable(UUID),
    artist_ids    Array(UUID),
    release_id    Nullable(UUID),
    context_type  LowCardinality(String),   -- album, playlist, wave, search, artist, ...
    context_id    Nullable(UUID),
    wave_session  Nullable(UUID),
    position_ms   UInt32 DEFAULT 0,
    ms_played     UInt32 DEFAULT 0,
    duration_ms   UInt32 DEFAULT 0,
    quality       LowCardinality(String) DEFAULT '',
    country       LowCardinality(String) DEFAULT '',
    props         String DEFAULT ''          -- JSON for rarely-queried extras
)
ENGINE = ReplacingMergeTree(received_at)     -- event_id dedup for client retries
PARTITION BY toYYYYMM(ts)
ORDER BY (user_id, ts, event_id)
TTL toDateTime(ts) + INTERVAL 3 YEAR
SETTINGS index_granularity = 8192;

-- Plays per track per day. A play counts after 30 s or 50 % of the track.
CREATE TABLE IF NOT EXISTS sonora.track_plays_daily
(
    day       Date,
    track_id  UUID,
    plays     UInt64,
    listeners AggregateFunction(uniq, UUID)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (track_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS sonora.mv_track_plays_daily TO sonora.track_plays_daily AS
SELECT
    toDate(ts)          AS day,
    assumeNotNull(track_id) AS track_id,
    count()             AS plays,
    uniqState(user_id)  AS listeners
FROM sonora.events
WHERE type = 'play_end' AND track_id IS NOT NULL
  AND (ms_played >= 30000 OR (duration_ms > 0 AND ms_played * 2 >= duration_ms))
GROUP BY day, track_id;

-- Unique listeners per artist per day; monthly listeners = uniqMerge over the last 28 days.
CREATE TABLE IF NOT EXISTS sonora.artist_listeners_daily
(
    day       Date,
    artist_id UUID,
    listeners AggregateFunction(uniq, UUID)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (artist_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS sonora.mv_artist_listeners_daily TO sonora.artist_listeners_daily AS
SELECT
    toDate(ts)         AS day,
    artist_id,
    uniqState(user_id) AS listeners
FROM sonora.events
ARRAY JOIN artist_ids AS artist_id
WHERE type = 'play_end'
  AND (ms_played >= 30000 OR (duration_ms > 0 AND ms_played * 2 >= duration_ms))
GROUP BY day, artist_id;

-- Completion rate per track: finished (≥ 90 %) vs started.
CREATE TABLE IF NOT EXISTS sonora.track_completion_daily
(
    day       Date,
    track_id  UUID,
    started   UInt64,
    completed UInt64,
    skipped   UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (track_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS sonora.mv_track_completion_daily TO sonora.track_completion_daily AS
SELECT
    toDate(ts)              AS day,
    assumeNotNull(track_id) AS track_id,
    countIf(type = 'play_start') AS started,
    countIf(type = 'play_end' AND duration_ms > 0 AND ms_played * 10 >= duration_ms * 9) AS completed,
    countIf(type = 'skip')  AS skipped
FROM sonora.events
WHERE track_id IS NOT NULL AND type IN ('play_start', 'play_end', 'skip')
GROUP BY day, track_id;

-- Example: monthly listeners of an artist
--   SELECT uniqMerge(listeners) FROM sonora.artist_listeners_daily
--   WHERE artist_id = {id:UUID} AND day >= today() - 28;
