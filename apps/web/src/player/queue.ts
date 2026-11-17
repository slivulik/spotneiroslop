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
  type: "release" | "artist" | "tracks" | "playlist" | "genre" | "home" | "wave" | "mix";
  id: string | null;
  title: string;
  /** Wave 2.0 session that serves this endless context (refills and feedback go to it). */
  session?: string | null;
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

/** Tracks in play order with the cursor's position — the editable view of a queue. */
function sequence(queue: Queue): QueueTrack[] {
  return queue.order.map((i) => queue.items[i]!).filter(Boolean);
}

/**
 * Rebuild a queue from an edited play sequence. Unshuffled queues keep `items` equal to the
 * sequence; shuffled ones keep their canonical order for surviving tracks and append new ones,
 * so turning shuffle off never resurrects removed tracks or drops added ones.
 */
function rebuild(queue: Queue, seq: QueueTrack[], currentItem: QueueTrack | null): Queue {
  const cursor = Math.max(0, currentItem ? seq.indexOf(currentItem) : 0);
  if (!queue.shuffle) return { ...queue, items: seq, order: seq.map((_, i) => i), cursor };
  const kept = queue.items.filter((t) => seq.includes(t));
  const items = [...kept, ...seq.filter((t) => !kept.includes(t))];
  return { ...queue, items, order: seq.map((t) => items.indexOf(t)), cursor };
}

/** "Play next": right after the current track. */
export function insertNext(queue: Queue, tracks: QueueTrack[]): Queue {
  const seq = sequence(queue);
  const now = current(queue);
  seq.splice(queue.cursor + 1, 0, ...tracks.map((t) => ({ ...t })));
  return rebuild(queue, seq, now);
}

/** "Add to queue": at the end. */
export function append(queue: Queue, tracks: QueueTrack[]): Queue {
  return rebuild(queue, [...sequence(queue), ...tracks.map((t) => ({ ...t }))], current(queue));
}

/** Remove the entry at play position `pos` (the playing track itself can't be removed). */
export function removeAt(queue: Queue, pos: number): Queue {
  if (pos === queue.cursor || pos < 0 || pos >= queue.order.length) return queue;
  const seq = sequence(queue);
  seq.splice(pos, 1);
  return rebuild(queue, seq, current(queue));
}

/** Drag-and-drop reorder by play positions; the playing track keeps playing. */
export function move(queue: Queue, from: number, to: number): Queue {
  const seq = sequence(queue);
  if (from < 0 || from >= seq.length || to < 0 || to >= seq.length || from === to) return queue;
  const [item] = seq.splice(from, 1);
  seq.splice(to, 0, item!);
  return rebuild(queue, seq, current(queue));
}

/** Drop everything after the current track. */
export function clearUpcoming(queue: Queue): Queue {
  return rebuild(queue, sequence(queue).slice(0, queue.cursor + 1), current(queue));
}

/** Played (before the cursor) and upcoming tracks with their play positions, for the queue panel. */
export function queueView(queue: Queue): { previous: { pos: number; track: QueueTrack }[]; next: { pos: number; track: QueueTrack }[] } {
  const seq = sequence(queue);
  return {
    previous: seq.slice(0, queue.cursor).map((track, pos) => ({ pos, track })),
    next: seq.slice(queue.cursor + 1).map((track, i) => ({ pos: queue.cursor + 1 + i, track })),
  };
}
