import { describe, expect, it } from "vitest";
import { artworkSrcSet, artworkUrl } from "@/lib/artwork";
import { formatDuration, formatTotal, pluralPlays, pluralReleases, pluralTracks } from "@/lib/format";
import { safeNext } from "@/lib/safe-next";

const art = { url_template: "https://cdn/c/{size}.{format}", sizes: [64, 160, 300, 640, 1200, 3000], blurhash: null, palette: null };

describe("artwork", () => {
  it("picks the smallest rendition that covers the size", () => {
    expect(artworkUrl(art, 200)).toBe("https://cdn/c/300.webp");
    expect(artworkUrl(art, 5000, "jpg")).toBe("https://cdn/c/3000.jpg");
    expect(artworkSrcSet(art, "avif", 300)).toBe("https://cdn/c/64.avif 64w, https://cdn/c/160.avif 160w, https://cdn/c/300.avif 300w");
  });
});

describe("format", () => {
  it("formats durations and Russian plurals", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_400)).toBe("1:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatTotal(42 * 60_000)).toBe("42 мин");
    expect(formatTotal(95 * 60_000)).toBe("1 ч 35 мин");
    expect([1, 2, 5, 11, 21, 22, 112].map(pluralTracks)).toEqual([
      "1 трек", "2 трека", "5 треков", "11 треков", "21 трек", "22 трека", "112 треков",
    ]);
  });
});

describe("safeNext", () => {
  const origin = "https://music.example";
  it("keeps same-site paths", () => {
    expect(safeNext("/album/1?x=1#t", origin)).toBe("/album/1?x=1#t");
    expect(safeNext("/", origin)).toBe("/");
  });
  it("refuses anything that resolves to another origin", () => {
    for (const value of ["//evil.example", "/\\evil.example/phish", "/\t/evil.example", "/\n/evil.example", "https://evil.example", "javascript:alert(1)", "evil", "", null]) {
      expect(safeNext(value, origin)).toBe("/");
    }
  });
});

describe("plural", () => {
  it("picks the Russian form", () => {
    expect([1, 2, 5, 11, 21, 22, 104, 111].map(pluralTracks)).toEqual(["1 трек", "2 трека", "5 треков", "11 треков", "21 трек", "22 трека", "104 трека", "111 треков"]);
    expect(pluralPlays(1)).toBe("1 прослушивание");
    expect(pluralReleases(3)).toBe("3 релиза");
  });
});
