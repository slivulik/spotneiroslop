import { describe, expect, it } from "vitest";
import { fillEdge, INTERLUDE_MS, LINE_LEAD_MS, lineProgress, locateLine, type LyricLine, sungEnd } from "@/lib/lyrics";

const line = (start_ms: number, end_ms: number, text = "Строка песни"): LyricLine => ({ start_ms, end_ms, text });

describe("locateLine", () => {
  const lines = [line(1000, 3000), line(3000, 5000), line(5000, 7000)];

  it("finds the sung line, switching slightly ahead of the timestamp", () => {
    expect(locateLine(lines, 0).line).toBe(-1);
    expect(locateLine(lines, 1000 - LINE_LEAD_MS).line).toBe(0);
    expect(locateLine(lines, 3000 - LINE_LEAD_MS - 1).line).toBe(0);
    expect(locateLine(lines, 3000 - LINE_LEAD_MS).line).toBe(1);
    expect(locateLine(lines, 60_000).line).toBe(2);
    expect(locateLine([], 1000)).toEqual({ line: -1, interlude: false });
  });

  it("marks long instrumental gaps (and long intros), not short breaths", () => {
    const gappy = [line(1000, 3000), line(3000 + INTERLUDE_MS + 500, 12_000)];
    expect(locateLine(gappy, 2000).interlude).toBe(false);
    expect(locateLine(gappy, 3500)).toEqual({ line: 0, interlude: true });
    expect(locateLine(lines, 2500).interlude).toBe(false);
    expect(locateLine([line(6000, 8000)], 2000)).toEqual({ line: -1, interlude: true });
    expect(locateLine([line(2000, 4000)], 500)).toEqual({ line: -1, interlude: false });
  });
});

describe("sungEnd", () => {
  it("trusts real end times", () => {
    expect(sungEnd([line(1000, 3200), line(5000, 6000)], 0)).toBe(3200);
  });

  it("never runs past the next line", () => {
    expect(sungEnd([line(1000, 9000), line(4000, 6000)], 0)).toBe(4000);
  });

  it("estimates the sung length when the line only ends where the next starts (LRC)", () => {
    // 12 characters → 12·150 + 1000 = 2800 ms; the 20 s gap to the next line is an instrumental.
    expect(sungEnd([line(1000, 0, "Строка песни"), line(21_000, 0)], 0)).toBe(3800);
    // A slow line that fills the gap naturally keeps its full span.
    expect(sungEnd([line(1000, 0, "Строка песни"), line(5500, 0)], 0)).toBe(5500);
    // The last line without an end gets the estimate.
    expect(sungEnd([line(1000, 0, "Строка песни")], 0)).toBe(3800);
  });
});

describe("karaoke fill", () => {
  const lines = [line(1000, 3000), line(3000, 5000)];

  it("runs from 0 to 1 across the sung time", () => {
    expect(lineProgress(lines, 0, 500)).toBe(0);
    expect(lineProgress(lines, 0, 1000)).toBe(0);
    expect(lineProgress(lines, 0, 2000)).toBeCloseTo(0.5);
    expect(lineProgress(lines, 0, 3000)).toBe(1);
    expect(lineProgress(lines, 0, 9000)).toBe(1);
    expect(lineProgress(lines, 5, 2000)).toBe(0);
  });

  it("maps progress to a soft gradient edge that is fully dim at 0 and fully lit at 1", () => {
    expect(fillEdge(0)).toBe("-4.00%");
    expect(fillEdge(0.5)).toBe("50.00%");
    expect(fillEdge(1)).toBe("104.00%");
    expect(fillEdge(2)).toBe("104.00%");
  });
});
