import { beforeEach, describe, expect, it } from "vitest";
import { segmentCache, segmentKey } from "@/player/segmentCache";

const buf = (n: number) => new ArrayBuffer(n);
const MB = 1024 * 1024;

describe("segment cache", () => {
  beforeEach(() => {
    segmentCache.clear();
    segmentCache.setLimit(16 * MB);
  });

  it("keys direct storage links by path, ignoring the signature", () => {
    const a = segmentKey("http://h/sonora-media/jobs/j1/hls/hires/seg_00001.m4s?X-Amz-Signature=aaa", "t1");
    const b = segmentKey("http://h/sonora-media/jobs/j1/hls/hires/seg_00001.m4s?X-Amz-Signature=bbb", "t1");
    expect(a).toBe(b);
    expect(segmentKey("http://h/sonora-media/jobs/j1/hls/high/seg_00001.m4s?s=1", "t1")).not.toBe(a);
  });

  it("keys legacy token links by track and path (token changes per fetch)", () => {
    expect(segmentKey("http://h/v1/stream/TOKEN1/high/seg_00002.m4s", "t9")).toBe("t9/high/seg_00002.m4s");
    expect(segmentKey("http://h/v1/stream/TOKEN2/high/seg_00002.m4s", "t9")).toBe("t9/high/seg_00002.m4s");
  });

  it("evicts least recently used entries over the byte limit", () => {
    segmentCache.put("a", buf(3 * MB));
    segmentCache.put("b", buf(3 * MB));
    segmentCache.put("c", buf(3 * MB));
    segmentCache.get("a"); // a becomes most recent
    segmentCache.put("d", buf(3 * MB));
    segmentCache.put("e", buf(3 * MB));
    segmentCache.put("f", buf(3 * MB)); // 18 MB > 16 MB: evict the oldest (b)
    expect(segmentCache.has("b")).toBe(false);
    expect(segmentCache.has("a")).toBe(true);
    expect(segmentCache.stats().bytes).toBeLessThanOrEqual(16 * MB);
  });

  it("counts hits and misses and skips oversized or empty entries", () => {
    const before = segmentCache.stats().hits;
    segmentCache.put("x", buf(1024));
    segmentCache.put("empty", buf(0));
    segmentCache.put("huge", buf(5 * MB)); // > a quarter of the limit
    expect(segmentCache.get("x")?.byteLength).toBe(1024);
    expect(segmentCache.get("empty")).toBeUndefined();
    expect(segmentCache.get("huge")).toBeUndefined();
    expect(segmentCache.stats().hits - before).toBe(1);
    expect(segmentCache.stats().entries).toBe(1);
  });
});
