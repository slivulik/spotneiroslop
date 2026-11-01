import { describe, expect, it } from "vitest";
import { normalizationGain } from "@/player/gain";
import { transition, type PlayerStatus } from "@/player/machine";
import {
  createQueue,
  current,
  cycleRepeat,
  nextCursor,
  prevAction,
  type QueueTrack,
  setShuffle,
  shuffled,
  upcoming,
} from "@/player/queue";

const track = (id: string): QueueTrack => ({
  id,
  title: id,
  version: null,
  artists: [],
  release: { id: "r", title: "R", artwork: null },
  durationMs: 1000,
  explicit: false,
  lossless: true,
  hires: false,
});
const items = ["a", "b", "c", "d"].map(track);
const seeded = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("state machine", () => {
  it("follows the happy path", () => {
    let s: PlayerStatus = "idle";
    for (const type of ["LOAD", "PLAYING", "WAITING", "PLAYING", "PAUSE", "PLAYING", "ENDED"] as const) {
      s = transition(s, { type });
    }
    expect(s).toBe("ended");
  });

  it("ignores illegal or stale events", () => {
    expect(transition("idle", { type: "PLAYING" })).toBe("idle");
    expect(transition("error", { type: "PLAYING" })).toBe("error");
    expect(transition("paused", { type: "WAITING" })).toBe("paused");
  });

  it("recovers from error only through a new load, and RESET always idles", () => {
    expect(transition("error", { type: "LOAD" })).toBe("loading");
    expect(transition("playing", { type: "RESET" })).toBe("idle");
    expect(transition("loading", { type: "READY" })).toBe("paused");
  });
});

describe("queue", () => {
  it("advances, stops at the end, and wraps with repeat all", () => {
    const q = createQueue(items, 3);
    expect(current(q)?.id).toBe("d");
    expect(nextCursor(q, false)).toBeNull();
    expect(nextCursor({ ...q, repeat: "all" }, false)).toBe(0);
  });

  it("repeat one replays on auto-advance but 'next' still moves on", () => {
    const q = { ...createQueue(items, 1), repeat: "one" as const };
    expect(nextCursor(q, false)).toBe(1);
    expect(nextCursor(q, true)).toBe(2);
  });

  it("previous restarts after 3 s, otherwise goes back", () => {
    const q = createQueue(items, 2);
    expect(prevAction(q, 5000)).toEqual({ kind: "restart" });
    expect(prevAction(q, 1000)).toEqual({ kind: "go", cursor: 1 });
    expect(prevAction(createQueue(items, 0), 1000)).toEqual({ kind: "restart" });
    expect(prevAction({ ...createQueue(items, 0), repeat: "all" }, 1000)).toEqual({ kind: "go", cursor: 3 });
  });

  it("shuffle keeps the current track first and is a permutation", () => {
    const order = shuffled(4, 2, seeded([0.1, 0.9, 0.5]));
    expect(order[0]).toBe(2);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);

    const q = createQueue(items, 2);
    const on = setShuffle(q, true, seeded([0.3, 0.7]));
    expect(current(on)?.id).toBe("c");
    const off = setShuffle(on, false);
    expect(off.cursor).toBe(2);
    expect(current(off)?.id).toBe("c");
  });

  it("lists upcoming tracks in play order", () => {
    expect(upcoming(createQueue(items, 1), 2).map((t) => t.id)).toEqual(["c", "d"]);
    expect(cycleRepeat("off")).toBe("all");
    expect(cycleRepeat("all")).toBe("one");
    expect(cycleRepeat("one")).toBe("off");
  });
});

describe("normalisation gain", () => {
  const gains = { track: -6, album: -3 };
  it("uses album gain in auto mode only when a whole album plays", () => {
    expect(normalizationGain("auto", gains, true)).toBeCloseTo(10 ** (-3 / 20));
    expect(normalizationGain("auto", gains, false)).toBeCloseTo(10 ** (-6 / 20));
    expect(normalizationGain("album", { track: -6, album: null }, false)).toBeCloseTo(10 ** (-6 / 20));
    expect(normalizationGain("off", gains, true)).toBe(1);
    expect(normalizationGain("track", { track: null, album: null }, false)).toBe(1);
  });
});
