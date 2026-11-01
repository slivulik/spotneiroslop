/**
 * Player state machine (shared semantics with the Android player):
 *
 *   Idle → Loading → (Paused | Playing) ↔ Buffering, → Ended; any → Error; any → Idle (RESET)
 *
 * Events come from the media element / HLS engine; illegal transitions are ignored, so a late
 * event from a previous track can't corrupt the state.
 */
export type PlayerStatus = "idle" | "loading" | "buffering" | "playing" | "paused" | "ended" | "error";

export type PlayerEvent =
  | { type: "LOAD" }
  | { type: "READY" }
  | { type: "PLAYING" }
  | { type: "WAITING" }
  | { type: "PAUSE" }
  | { type: "ENDED" }
  | { type: "ERROR" }
  | { type: "RESET" };

const TABLE: Record<PlayerStatus, Partial<Record<PlayerEvent["type"], PlayerStatus>>> = {
  idle: { LOAD: "loading" },
  loading: { READY: "paused", PLAYING: "playing", WAITING: "loading", PAUSE: "paused", ERROR: "error", LOAD: "loading" },
  buffering: { PLAYING: "playing", PAUSE: "paused", ENDED: "ended", ERROR: "error", LOAD: "loading" },
  playing: { WAITING: "buffering", PAUSE: "paused", ENDED: "ended", ERROR: "error", LOAD: "loading" },
  paused: { PLAYING: "playing", ENDED: "ended", ERROR: "error", LOAD: "loading" },
  ended: { PLAYING: "playing", LOAD: "loading", ERROR: "error" },
  error: { LOAD: "loading" },
};

export function transition(state: PlayerStatus, event: PlayerEvent): PlayerStatus {
  if (event.type === "RESET") return "idle";
  return TABLE[state][event.type] ?? state;
}

export function isActive(status: PlayerStatus): boolean {
  return status === "playing" || status === "buffering" || status === "loading";
}
