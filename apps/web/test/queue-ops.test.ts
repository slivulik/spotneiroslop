import { describe, expect, it } from "vitest";
import { append, clearUpcoming, createQueue, current, insertNext, move, queueView, removeAt, setShuffle, type QueueTrack } from "@/player/queue";

const t = (id: string): QueueTrack => ({
  id,
  title: id,
  version: null,
  artists: [],
  release: { id: "r", title: "r", artwork: null },
  durationMs: 1000,
  explicit: false,
  lossless: false,
  hires: false,
});
const ids = (q: ReturnType<typeof createQueue>) => q.order.map((i) => q.items[i]!.id);

describe("queue editing", () => {
  it("play next inserts right after the current track", () => {
    const q = insertNext(createQueue([t("a"), t("b"), t("c")], 1), [t("x"), t("y")]);
    expect(ids(q)).toEqual(["a", "b", "x", "y", "c"]);
    expect(current(q)?.id).toBe("b");
  });

  it("append adds to the end", () => {
    expect(ids(append(createQueue([t("a"), t("b")], 0), [t("z")]))).toEqual(["a", "b", "z"]);
  });

  it("remove keeps the playing track and fixes the cursor", () => {
    const q = createQueue([t("a"), t("b"), t("c"), t("d")], 2);
    const r = removeAt(q, 0);
    expect(ids(r)).toEqual(["b", "c", "d"]);
    expect(current(r)?.id).toBe("c");
    expect(removeAt(q, 2)).toBe(q); // can't remove what's playing
  });

  it("move reorders and the current track keeps playing", () => {
    const q = createQueue([t("a"), t("b"), t("c"), t("d")], 1);
    const m = move(q, 3, 0);
    expect(ids(m)).toEqual(["d", "a", "b", "c"]);
    expect(current(m)?.id).toBe("b");
    const n = move(q, 1, 3); // moving the playing track itself
    expect(ids(n)).toEqual(["a", "c", "d", "b"]);
    expect(current(n)?.id).toBe("b");
  });

  it("clear upcoming keeps history and the current track", () => {
    const q = clearUpcoming(createQueue([t("a"), t("b"), t("c")], 1));
    expect(ids(q)).toEqual(["a", "b"]);
    expect(queueView(q).next).toEqual([]);
    expect(queueView(q).previous.map((e) => e.track.id)).toEqual(["a"]);
  });

  it("shuffle off after edits neither resurrects removed nor drops added tracks", () => {
    let q = setShuffle(createQueue([t("a"), t("b"), t("c"), t("d")], 0), true, () => 0.3);
    q = removeAt(q, q.order.length - 1);
    q = insertNext(q, [t("x")]);
    const off = setShuffle(q, false);
    const all = off.order.map((i) => off.items[i]!.id).sort();
    expect(all).toHaveLength(4);
    expect(all).toContain("x");
    expect(current(off)?.id).toBe(current(q)?.id);
  });
});
