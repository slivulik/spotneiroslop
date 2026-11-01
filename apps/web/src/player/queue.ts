import type { TrackOut } from "@sonora/api-schema";

export type RepeatMode = "off" | "all" | "one";

export interface QueueTrack {
  id: string;
  title: string;
  version: string | null;
  artists: { id: string; name: string }[];
  release: { id: string; title: string; artwork: TrackOut["release"]["artwork"] };
  durationMs: number;
  explicit: boolean;
  lossless: boolean;
  hires: boolean;
}

export interface PlayContext {
  type: "release" | "artist" | "tracks" | "playlist" | "genre" | "home";
  id: string | null;
  title: string;
}

export interface Queue {
  items: QueueTrack[];
  /** Play order: indexes into `items` (identity when shuffle is off). */
  order: number[];
  /** Position within `order`. */
  cursor: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export const RESTART_THRESHOLD_MS = 3000;

export function toQueueTrack(t: TrackOut): QueueTrack {
  return {
    id: t.id,
    title: t.title,
    version: t.version,
    artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
    release: { id: t.release.id, title: t.release.title, artwork: t.release.artwork },
    durationMs: t.duration_ms,
    explicit: t.is_explicit,
    lossless: t.audio.lossless,
    hires: t.audio.hires,
  };
}

/** Fisher–Yates with an injectable RNG (deterministic tests). */
export function shuffled(n: number, first: number, random: () => number = Math.random): number[] {
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return [first, ...rest];
}

export function createQueue(items: QueueTrack[], start: number, shuffle = false, repeat: RepeatMode = "off"): Queue {
  const order = shuffle ? shuffled(items.length, start) : items.map((_, i) => i);
  return { items, order, cursor: shuffle ? 0 : start, shuffle, repeat };
}

export function current(queue: Queue): QueueTrack | null {
  const index = queue.order[queue.cursor];
  return index === undefined ? null : (queue.items[index] ?? null);
}

/** Cursor after the current track finishes (auto) or the user presses "next" (manual). */
export function nextCursor(queue: Queue, manual: boolean): number | null {
  if (!queue.items.length) return null;
  if (queue.repeat === "one" && !manual) return queue.cursor;
  if (queue.cursor + 1 < queue.order.length) return queue.cursor + 1;
  return queue.repeat === "off" ? null : 0;
}

export type PrevAction = { kind: "restart" } | { kind: "go"; cursor: number };

/** "Previous" restarts the track when we're past the first few seconds (like every player). */
export function prevAction(queue: Queue, positionMs: number): PrevAction {
  if (positionMs > RESTART_THRESHOLD_MS || queue.cursor === 0) {
    if (queue.cursor === 0 && queue.repeat === "all" && positionMs <= RESTART_THRESHOLD_MS) {
      return { kind: "go", cursor: queue.order.length - 1 };
    }
    return { kind: "restart" };
  }
  return { kind: "go", cursor: queue.cursor - 1 };
}

export function setShuffle(queue: Queue, shuffle: boolean, random?: () => number): Queue {
  const playing = queue.order[queue.cursor] ?? 0;
  if (shuffle) return { ...queue, shuffle, order: shuffled(queue.items.length, playing, random), cursor: 0 };
  return { ...queue, shuffle, order: queue.items.map((_, i) => i), cursor: playing };
}

export function cycleRepeat(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off";
}

/** Upcoming tracks in play order (for prefetching and the queue view). */
export function upcoming(queue: Queue, count: number): QueueTrack[] {
  const out: QueueTrack[] = [];
  for (let i = queue.cursor + 1; i < queue.order.length && out.length < count; i++) {
    const item = queue.items[queue.order[i]!];
    if (item) out.push(item);
  }
  return out;
}
