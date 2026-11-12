"use client";

/**
 * «Моя волна» 2.0 client and the other personal recommendations.
 *
 * The wave is a server-side session: starting it (or a radio from a track / artist) opens a
 * session, the queue is topped up from that session when it runs low, and what the listener does
 * with each track (started, heard out, skipped, liked, disliked) goes back to it as feedback —
 * fire-and-forget, never in the way of playback.
 */
import type { components, TrackOut } from "@sonora/api-schema";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { requireLogin } from "@/lib/play";
import { useSession } from "@/lib/session";
import { useSettings } from "@/lib/settings";
import { ANY_WAVE, freshTracks, leaveOutcome, normalizeChoice, sameChoice, seedOf, toWaveSettings, type WaveChoice, type WaveSeed } from "@/lib/wave";
import { player, type TrackEvent } from "@/player/controller";
import { current, type PlayContext, toQueueTrack, upcoming } from "@/player/queue";
import { usePlayer } from "@/player/store";

type FeedbackAction = components["schemas"]["WaveFeedbackIn"]["action"];

export const WAVE_TITLE = "Моя волна";
const START_LIMIT = 20;
const REFILL_LIMIT = 10;
/** A refill that brought nothing new waits this long before asking again (progress ticks call often). */
const REFILL_BACKOFF_MS = 15_000;
/** Chip changes in quick succession make one new session, not one per tap. */
const RETUNE_DEBOUNCE_MS = 450;
const NO_SEED: WaveSeed = { seed_track: null, seed_artist: null };

interface StartedSession {
  session: string;
  tracks: TrackOut[];
  settings: WaveChoice;
}

async function startSession(settings: WaveChoice, seed: WaveSeed): Promise<StartedSession> {
  const out = await unwrap(
    api.POST("/v1/me/wave/sessions", {
      body: { settings: toWaveSettings(settings), seed_track: seed.seed_track, seed_artist: seed.seed_artist, limit: START_LIMIT },
    }),
  );
  return { session: out.session_id, tracks: out.tracks.filter((t) => t.playable), settings: normalizeChoice(out.settings) };
}

/** The tuning a session was started with becomes the device's settled tuning (unless retuned meanwhile). */
function settle(sent: WaveChoice, echoed: WaveChoice): void {
  const local = useSettings.getState();
  if (sameChoice(local.wave, sent)) local.set({ wave: echoed, wavePending: false });
}

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

/** Start «Моя волна» with the given tuning (default: the saved one). Resolves false when nothing could start. */
export async function playWave(choice?: WaveChoice): Promise<boolean> {
  if (!requireLogin()) return false;
  const settings = choice ?? useSettings.getState().wave;
  try {
    const started = await startSession(settings, NO_SEED);
    if (!started.tracks.length) return false;
    settle(settings, started.settings);
    player.playTracks(started.tracks.map(toQueueTrack), 0, { type: "wave", id: null, title: WAVE_TITLE, session: started.session });
    return true;
  } catch {
    return false;
  }
}

/**
 * Endless radio around one track or artist: similar music, still bent to the listener's taste.
 * A track radio starts with the track itself, then flows on. Radios are not filtered by the
 * wave's tuning: similarity is the point.
 */
export async function playRadio(seed: { trackId: string; title: string } | { artistId: string; title: string }): Promise<boolean> {
  if (!requireLogin()) return false;
  const id = "trackId" in seed ? `track:${seed.trackId}` : `artist:${seed.artistId}`;
  try {
    const started = await startSession(ANY_WAVE, seedOf(id));
    let tracks = started.tracks;
    if ("trackId" in seed) {
      const first = await unwrap(api.GET("/v1/tracks/{track_id}", { params: { path: { track_id: seed.trackId } } })).catch(() => null);
      if (first?.playable) tracks = [first, ...tracks.filter((t) => t.id !== first.id)];
    }
    if (!tracks.length) return false;
    player.playTracks(tracks.map(toQueueTrack), 0, { type: "wave", id, title: `Радио: ${seed.title}`, session: started.session });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Endless queue
// ---------------------------------------------------------------------------

let refilling = false;
let refillAfter = 0;

const sameWave = (a: PlayContext | null, b: PlayContext) =>
  a?.type === "wave" && a.id === b.id && (a.session ?? null) === (b.session ?? null);

/** Top the wave (or a radio) up from its session; an expired session is replaced by a new one with the same tuning. */
async function refill(): Promise<void> {
  const { queue, context } = usePlayer.getState();
  if (refilling || !queue || context?.type !== "wave" || Date.now() < refillAfter) return;
  refilling = true;
  let added = false;
  try {
    let session = context.session ?? null;
    let tracks: TrackOut[] = [];
    if (session) {
      const { data, response } = await api.GET("/v1/me/wave/sessions/{session_id}/next", {
        params: { path: { session_id: session }, query: { limit: REFILL_LIMIT } },
      });
      if (data) tracks = data;
      else if (response.status === 404) session = null;
      else return;
    }
    if (!session) {
      // Unknown or expired session (or a queue restored from before sessions): start over with the same tuning.
      const started = await startSession(context.id ? ANY_WAVE : useSettings.getState().wave, seedOf(context.id));
      session = started.session;
      tracks = started.tracks;
    }
    const now = usePlayer.getState();
    if (!now.queue || !sameWave(now.context, context)) return; // the listener moved on meanwhile
    const next: PlayContext = { ...context, session };
    if (session !== (context.session ?? null)) now.patch({ context: next });
    const playable = tracks.filter((t) => t.playable);
    // Only the recent past matters: a long session may legitimately come back to an old track.
    const fresh = freshTracks(playable, now.queue.items.slice(-30).map((t) => t.id));
    const add = fresh.length ? fresh : upcoming(now.queue, 1).length ? [] : playable;
    if (add.length) {
      player.addToQueue(add.map(toQueueTrack), next);
      added = true;
    }
  } catch {
    // Offline or the server is busy: the next low-queue tick after the back-off tries again.
  } finally {
    if (!added) refillAfter = Date.now() + REFILL_BACKOFF_MS;
    refilling = false;
  }
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

let retuneTimer: ReturnType<typeof setTimeout> | null = null;
let retuneSeq = 0;

/** A new session with the saved tuning replaces what comes next; the current track plays on. */
async function retune(): Promise<void> {
  const seq = ++retuneSeq;
  const choice = useSettings.getState().wave;
  try {
    const started = await startSession(choice, NO_SEED);
    const now = usePlayer.getState();
    if (seq !== retuneSeq || now.context?.type !== "wave" || now.context.id !== null) return;
    const playingId = now.queue ? current(now.queue)?.id : undefined;
    settle(choice, started.settings);
    refillAfter = 0;
    player.replaceUpcoming(
      started.tracks.filter((t) => t.id !== playingId).map(toQueueTrack),
      { ...now.context, session: started.session },
    );
  } catch {
    // The queue keeps flowing from the previous session; the tuning stays pending for the next start.
  }
}

/** Retune the wave. Saved at once; while «Моя волна» plays, the upcoming queue follows the new tuning. */
export function setWaveChoice(choice: WaveChoice): void {
  const local = useSettings.getState();
  if (sameChoice(local.wave, choice)) return;
  local.set({ wave: choice, wavePending: true });
  const { context } = usePlayer.getState();
  if (context?.type !== "wave" || context.id !== null) return;
  if (retuneTimer) clearTimeout(retuneTimer);
  retuneTimer = setTimeout(() => {
    retuneTimer = null;
    void retune();
  }, RETUNE_DEBOUNCE_MS);
}

/** After sign-in: adopt the tuning of the latest session (from any device) unless a local change is still unsent. */
export async function loadWaveSettings(): Promise<void> {
  try {
    const remote = normalizeChoice(await unwrap(api.GET("/v1/me/wave/settings")));
    const local = useSettings.getState();
    if (!local.wavePending && !sameChoice(local.wave, remote)) local.set({ wave: remote });
  } catch {
    // Keep the local tuning.
  }
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

function sendFeedback(context: PlayContext | null, trackId: string, action: FeedbackAction, playedMs: number | null = null): void {
  const session = context?.type === "wave" ? context.session : null;
  if (!session) return;
  void api
    .POST("/v1/me/wave/sessions/{session_id}/feedback", {
      params: { path: { session_id: session } },
      body: { track_id: trackId, action, played_ms: playedMs },
    })
    .catch(() => undefined);
}

/** Set while «Не нравится» skips a track, so that skip is not reported a second time. */
let dislikedId: string | null = null;

function onTrackEvent(event: TrackEvent): void {
  if (event.context?.type !== "wave") return;
  if (event.type === "started" || event.type === "finished") {
    sendFeedback(event.context, event.trackId, event.type);
    return;
  }
  if (event.trackId === dislikedId) return;
  const outcome = leaveOutcome(event.positionMs, event.durationMs, event.playedMs);
  sendFeedback(event.context, event.trackId, outcome.action, outcome.action === "skipped" ? outcome.playedMs : null);
}

/** Called by the like action: a like given to a track of the playing wave is also a wave signal. */
export function reportWaveLike(trackId: string): void {
  const { context, queue } = usePlayer.getState();
  if (context?.type !== "wave" || !queue?.items.some((t) => t.id === trackId)) return;
  sendFeedback(context, trackId, "liked");
}

/** «Не нравится»: tell the wave and move on to the next track straight away. */
export function dislikeCurrent(): void {
  const { context, queue } = usePlayer.getState();
  const track = queue ? current(queue) : null;
  if (!track || context?.type !== "wave") return;
  sendFeedback(context, track.id, "disliked");
  dislikedId = track.id;
  try {
    player.next();
  } finally {
    dislikedId = null;
  }
}

if (typeof window !== "undefined") {
  // Registered once for the app's lifetime: a wave restored after a reload keeps refilling and reporting.
  player.setQueueLowHandler(() => void refill());
  player.setTrackEventHandler(onTrackEvent);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function useAuthed() {
  return useSession((s) => s.status === "authenticated");
}

export function useMixes() {
  const authed = useAuthed();
  return useQuery({ queryKey: ["mixes"], enabled: authed, staleTime: 10 * 60_000, queryFn: () => unwrap(api.GET("/v1/me/mixes")) });
}

export function useMix(key: string) {
  const authed = useAuthed();
  return useQuery({ queryKey: ["mix", key], enabled: authed, staleTime: 10 * 60_000, queryFn: () => unwrap(api.GET("/v1/me/mixes/{key}", { params: { path: { key } } })) });
}

export function useTopArtists() {
  const authed = useAuthed();
  return useQuery({ queryKey: ["top-artists"], enabled: authed, staleTime: 10 * 60_000, queryFn: () => unwrap(api.GET("/v1/me/top-artists", { params: { query: { limit: 12 } } })) });
}

export function useRecent() {
  const authed = useAuthed();
  return useQuery({ queryKey: ["recent"], enabled: authed, staleTime: 60_000, queryFn: () => unwrap(api.GET("/v1/me/recent")) });
}

export function useSimilarArtists(id: string) {
  return useQuery({ queryKey: ["artist", id, "similar"], staleTime: 10 * 60_000, queryFn: () => unwrap(api.GET("/v1/artists/{artist_id}/similar", { params: { path: { artist_id: id } } })) });
}

export function useArtistStats(id: string) {
  return useQuery({ queryKey: ["artist", id, "stats"], staleTime: 5 * 60_000, queryFn: () => unwrap(api.GET("/v1/artists/{artist_id}/stats", { params: { path: { artist_id: id } } })) });
}
