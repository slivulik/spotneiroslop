"use client";

/**
 * Listening reports for plays, history and the admin's live view. Listened time is measured
 * from actual playback progress (seeks don't count), and sent as `play_end` when the track
 * changes, ends or the page is hidden. Batched; `keepalive` lets the last flush survive unload.
 */
import { useSession } from "@/lib/session";

interface PlayEvent {
  event_id: string;
  type: "play_start" | "play_end";
  track_id: string;
  ms_played: number;
  at: string;
  context_type?: string | null;
  context_id?: string | null;
}

const FLUSH_MS = 10_000;
let queue: PlayEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let current: { trackId: string; listened: number; lastPos: number | null; context: { type: string | null; id: string | null } } | null = null;

function flush(keepalive = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const token = useSession.getState().accessToken;
  if (!queue.length || !token) return;
  const events = queue;
  queue = [];
  void fetch("/v1/events/batch", {
    method: "POST",
    keepalive,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ events }),
  }).catch(() => {
    queue = [...events, ...queue].slice(-500); // retry on the next flush
  });
}

function push(event: Omit<PlayEvent, "event_id" | "at">): void {
  queue.push({ ...event, event_id: crypto.randomUUID(), at: new Date().toISOString() });
  if (event.type === "play_start") flush();
  else timer ??= setTimeout(() => flush(), FLUSH_MS);
}

const CONTEXTS = new Set(["release", "artist", "playlist", "tracks", "home", "genre"]);

export const listening = {
  start(trackId: string, context: { type: string; id: string | null } | null): void {
    listening.end();
    const type = context && CONTEXTS.has(context.type) ? context.type : null;
    current = { trackId, listened: 0, lastPos: null, context: { type, id: type ? context?.id ?? null : null } };
    push({ type: "play_start", track_id: trackId, ms_played: 0, context_type: type, context_id: current.context.id });
  },

  /** Called on every progress tick while playing. */
  progress(positionMs: number): void {
    if (!current) return;
    if (current.lastPos !== null) {
      const delta = positionMs - current.lastPos;
      if (delta > 0 && delta < 2500) current.listened += delta; // ignore seeks and stalls
    }
    current.lastPos = positionMs;
  },

  /** Forget the last position (after a pause or seek) so the gap isn't counted. */
  gap(): void {
    if (current) current.lastPos = null;
  },

  end(): void {
    if (!current) return;
    if (current.listened > 1000) {
      push({
        type: "play_end",
        track_id: current.trackId,
        ms_played: Math.round(current.listened),
        context_type: current.context.type,
        context_id: current.context.id,
      });
    }
    current = null;
  },
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    listening.end();
    flush(true);
  });
}
