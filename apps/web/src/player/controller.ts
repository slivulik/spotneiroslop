"use client";

/**
 * Glue between the queue/state store and the engine. UI components call `player.*`; the engine
 * reports back through callbacks that update the store. Also owns Media Session integration,
 * resume-position persistence and next-track prefetching.
 */
import type { StreamOut } from "@sonora/api-schema";
import { artworkUrl } from "@/lib/artwork";
import { type Equalizer, PlayerEngine } from "@/player/engine";
import { type NormalizationMode, normalizationGain } from "@/player/gain";
import {
  append,
  clearUpcoming,
  createQueue,
  current,
  cycleRepeat,
  insertNext,
  move,
  nextCursor,
  type PlayContext,
  prevAction,
  type QueueTrack,
  removeAt,
  setShuffle,
  upcoming,
} from "@/player/queue";
import { listening } from "@/player/events";
import { readResumePosition, type RequestedQuality, saveResumePosition, usePlayer } from "@/player/store";

const PREFETCH_BEFORE_END_MS = 20_000;
const SAVE_EVERY_MS = 5_000;

let engine: PlayerEngine | null = null;
let pendingEq: Equalizer | null = null;
let preloadNext = true;
/** Endless contexts ("Моя волна") top the queue up through this callback when it runs low. */
let onQueueLow: (() => void) | null = null;
let lastSave = 0;
let prefetchedFor: string | null = null;
/** Track for which `play_start` was reported in the current load. */
let startedFor: string | null = null;

function state() {
  return usePlayer.getState();
}

function playingWholeAlbum(): boolean {
  const s = state();
  return s.context?.type === "release" && !s.queue?.shuffle;
}

function gainFor(stream: StreamOut): number {
  return normalizationGain(
    state().normalization,
    { track: stream.track_gain ?? null, album: stream.album_gain ?? null },
    playingWholeAlbum(),
  );
}

function getEngine(): PlayerEngine {
  if (engine) return engine;
  engine = new PlayerEngine({
    onEvent: (event) => {
      const before = state().status;
      state().dispatch(event);
      const s = state();
      const track = s.queue ? current(s.queue) : null;
      if (event.type === "PLAYING" && track && startedFor !== track.id) {
        startedFor = track.id;
        listening.start(track.id, s.context);
      }
      if (event.type === "PAUSE" || event.type === "WAITING" || (before !== "playing" && event.type === "PLAYING")) {
        listening.gap();
      }
    },
    onProgress: (positionMs, durationMs, bufferedMs) => {
      state().patch({ positionMs, durationMs, bufferedMs });
      if (state().status === "playing") listening.progress(positionMs);
      const track = current(state().queue ?? { items: [], order: [], cursor: 0, shuffle: false, repeat: "off" });
      if (!track) return;
      const now = Date.now();
      if (now - lastSave > SAVE_EVERY_MS) {
        lastSave = now;
        saveResumePosition(track.id, positionMs);
      }
      const s2 = state();
      if (s2.context?.type === "wave" && s2.queue && upcoming(s2.queue, 3).length < 3) onQueueLow?.();
      if (durationMs - positionMs < PREFETCH_BEFORE_END_MS && prefetchedFor !== track.id) {
        prefetchedFor = track.id;
        const queue = state().queue;
        const next = queue ? upcoming(queue, 1)[0] : undefined;
        if (next && preloadNext) getEngine().prefetch(next.id, state().quality);
      }
      updatePositionState(positionMs, durationMs);
    },
    onEnded: () => {
      listening.end();
      startedFor = null;
      advance(false);
    },
    onError: (message) => {
      state().patch({ error: message });
      state().dispatch({ type: "ERROR" });
    },
    onStream: (stream) => state().patch({ activeQuality: stream.quality, durationMs: stream.duration_ms, waveform: stream.waveform ?? null, renditions: stream.renditions ?? [] }),
  });
  const s = state();
  engine.setVolume(s.volume, s.muted);
  installMediaSession();
  if (pendingEq) engine.setEqualizer(pendingEq);
  (window as unknown as { __sonoraEq?: () => unknown }).__sonoraEq = () => engine?.equalizerSnapshot() ?? null;
  (window as unknown as { __sonoraPlayback?: () => unknown }).__sonoraPlayback = () => engine?.playbackSnapshot() ?? null;
  return engine;
}

async function loadCurrent(autoplay: boolean, startAtMs = 0): Promise<void> {
  const s = state();
  const track = s.queue ? current(s.queue) : null;
  if (!track) return;
  prefetchedFor = null;
  listening.end();
  startedFor = null;
  s.patch({ positionMs: startAtMs, durationMs: track.durationMs, bufferedMs: 0, error: null });
  updateMediaMetadata(track);
  await getEngine().load(track.id, { autoplay, startAtMs, quality: s.quality, gain: gainFor });
}

function advance(manual: boolean): void {
  const s = state();
  if (!s.queue) return;
  const cursor = nextCursor(s.queue, manual);
  if (cursor === null) {
    s.patch({ positionMs: 0 });
    return;
  }
  s.patch({ queue: { ...s.queue, cursor } });
  void loadCurrent(true);
}

export const player = {
  playTracks(tracks: QueueTrack[], start: number, context: PlayContext, options: { shuffle?: boolean } = {}): void {
    if (!tracks.length) return;
    const s = state();
    const shuffle = options.shuffle ?? false;
    const queue = createQueue(tracks, start, shuffle, s.queue?.repeat ?? "off");
    s.patch({ queue, context });
    void loadCurrent(true);
  },

  /** Play/pause; after a reload the restored queue starts where it was left. */
  toggle(): void {
    const s = state();
    const e = getEngine();
    if (!e.hasSource) {
      const track = s.queue ? current(s.queue) : null;
      if (track) void loadCurrent(true, readResumePosition(track.id));
      return;
    }
    if (s.status === "playing" || s.status === "buffering") e.pause();
    else if (s.status === "ended") {
      e.seek(0);
      void e.play();
    } else void e.play();
  },

  next(): void {
    advance(true);
  },

  prev(): void {
    const s = state();
    if (!s.queue) return;
    const action = prevAction(s.queue, s.positionMs);
    if (action.kind === "restart") {
      getEngine().seek(0);
      return;
    }
    s.patch({ queue: { ...s.queue, cursor: action.cursor } });
    void loadCurrent(true);
  },

  seek(ms: number): void {
    listening.gap();
    state().patch({ positionMs: ms });
    getEngine().seek(ms);
  },

  setVolume(volume: number): void {
    state().patch({ volume, muted: volume === 0 ? state().muted : false });
    getEngine().setVolume(volume, state().muted);
  },

  toggleMute(): void {
    state().patch({ muted: !state().muted });
    getEngine().setVolume(state().volume, state().muted);
  },

  setQuality(quality: RequestedQuality): void {
    const s = state();
    s.patch({ quality });
    if (getEngine().hasSource) void loadCurrent(s.status === "playing" || s.status === "buffering", s.positionMs);
  },

  /** Loudness normalisation mode; applies to the playing track immediately. */
  setNormalization(normalization: NormalizationMode): void {
    state().patch({ normalization });
    getEngine().refreshGain();
  },

  toggleShuffle(): void {
    const s = state();
    if (s.queue) s.patch({ queue: setShuffle(s.queue, !s.queue.shuffle) });
  },

  cycleRepeat(): void {
    const s = state();
    if (s.queue) s.patch({ queue: { ...s.queue, repeat: cycleRepeat(s.queue.repeat) } });
  },

  /** "Play next" — starts playback if nothing is queued yet. */
  playNext(tracks: QueueTrack[], context: PlayContext): void {
    const s = state();
    if (!s.queue || !current(s.queue)) return player.playTracks(tracks, 0, context);
    s.patch({ queue: insertNext(s.queue, tracks) });
    prefetchedFor = null;
  },

  addToQueue(tracks: QueueTrack[], context: PlayContext): void {
    const s = state();
    if (!s.queue || !current(s.queue)) return player.playTracks(tracks, 0, context);
    s.patch({ queue: append(s.queue, tracks) });
    prefetchedFor = null;
  },

  removeFromQueue(pos: number): void {
    const s = state();
    if (s.queue) s.patch({ queue: removeAt(s.queue, pos) });
    prefetchedFor = null;
  },

  moveInQueue(from: number, to: number): void {
    const s = state();
    if (s.queue) s.patch({ queue: move(s.queue, from, to) });
    prefetchedFor = null;
  },

  clearQueue(): void {
    const s = state();
    if (s.queue) s.patch({ queue: clearUpcoming(s.queue) });
  },

  playAt(cursor: number): void {
    const s = state();
    if (!s.queue || cursor < 0 || cursor >= s.queue.order.length) return;
    s.patch({ queue: { ...s.queue, cursor } });
    void loadCurrent(true);
  },

  setQueueLowHandler(fn: (() => void) | null): void {
    onQueueLow = fn;
  },

  /** Settings → Playback: warm the next track before the current one ends. */
  setPreloadNext(on: boolean): void {
    preloadNext = on;
  },
  setEqualizer(eq: Equalizer): void {
    pendingEq = eq;
    engine?.setEqualizer(eq);
  },
  get equalizerAvailable(): boolean {
    return engine?.equalizerAvailable ?? true;
  },
  oscilloscope(out: Uint8Array<ArrayBuffer>): boolean {
    return engine?.oscilloscope(out) ?? false;
  },
  levels(): { energy: number; bass: number } | null {
    return engine?.levels() ?? null;
  },

  isPlaying(): boolean {
    const status = state().status;
    return status === "playing" || status === "buffering";
  },

  setNowPlaying(open: boolean): void {
    state().patch({ nowPlayingOpen: open });
  },
};

// ---------------------------------------------------------------------------
// Media Session (lock screen, hardware keys, OS media overlay)
// ---------------------------------------------------------------------------

function installMediaSession(): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => player.toggle()],
    ["pause", () => player.toggle()],
    ["nexttrack", () => player.next()],
    ["previoustrack", () => player.prev()],
    ["seekto", (d) => d.seekTime !== undefined && player.seek(d.seekTime * 1000)],
    ["seekforward", (d) => player.seek(state().positionMs + (d.seekOffset ?? 10) * 1000)],
    ["seekbackward", (d) => player.seek(state().positionMs - (d.seekOffset ?? 10) * 1000)],
  ];
  for (const [action, handler] of handlers) {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      // Unsupported action on this platform.
    }
  }
}

function updateMediaMetadata(track: QueueTrack): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const art = track.release.artwork;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.version ? `${track.title} (${track.version})` : track.title,
    artist: track.artists.map((a) => a.name).join(", "),
    album: track.release.title,
    artwork: art
      ? [160, 300, 640].map((size) => ({ src: artworkUrl(art, size, "jpg"), sizes: `${size}x${size}`, type: "image/jpeg" }))
      : [],
  });
}

function updatePositionState(positionMs: number, durationMs: number): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator) || durationMs <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: durationMs / 1000,
      position: Math.min(positionMs, durationMs) / 1000,
      playbackRate: 1,
    });
  } catch {
    // Some browsers reject transient inconsistent values during seeks.
  }
}

/** Space toggles, ←/→ seek 5 s, Shift+←/→ previous/next, M mutes. */
export function handlePlayerHotkey(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return false;
  if (!state().queue) return false;
  switch (event.code) {
    case "Space":
      player.toggle();
      return true;
    case "ArrowRight":
      if (event.shiftKey) player.next();
      else player.seek(state().positionMs + 5000);
      return true;
    case "ArrowLeft":
      if (event.shiftKey) player.prev();
      else player.seek(Math.max(0, state().positionMs - 5000));
      return true;
    case "KeyM":
      player.toggleMute();
      return true;
    case "KeyS":
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      player.toggleShuffle();
      return true;
    case "KeyR":
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      player.cycleRepeat();
      return true;
    case "KeyF":
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      player.setNowPlaying(!state().nowPlayingOpen);
      return true;
    case "KeyL":
    case "KeyQ":
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      state().patch({ sidePanel: state().sidePanel === (event.code === "KeyL" ? "lyrics" : "queue") ? "none" : event.code === "KeyL" ? "lyrics" : "queue" });
      return true;
    case "ArrowUp":
      if (!event.shiftKey) return false;
      player.setVolume(Math.min(1, state().volume + 0.05));
      return true;
    case "ArrowDown":
      if (!event.shiftKey) return false;
      player.setVolume(Math.max(0, state().volume - 0.05));
      return true;
    default:
      return false;
  }
}
