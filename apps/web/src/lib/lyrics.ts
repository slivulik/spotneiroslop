/**
 * Timing maths for line-synced lyrics (karaoke view). Pure, so it is unit-tested directly.
 */
export interface LyricLine {
  start_ms: number;
  end_ms: number;
  text: string;
}

/** Lines switch a little before their timestamp, so the eye arrives with the voice. */
export const LINE_LEAD_MS = 200;
/** An instrumental gap at least this long shows breathing dots instead of a lit line. */
export const INTERLUDE_MS = 4000;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * When the singing of line `i` is over. Synced lyrics often end a line only where the next one
 * starts (LRC has no end times), which would make the fill crawl through a long instrumental; then
 * a natural length estimated from the text is used instead.
 */
export function sungEnd(lines: readonly LyricLine[], i: number): number {
  const line = lines[i];
  if (!line) return 0;
  const next = lines[i + 1];
  const limit = next ? next.start_ms : Number.POSITIVE_INFINITY;
  const explicit = line.end_ms > line.start_ms ? Math.min(line.end_ms, limit) : limit;
  const estimate = Math.min(10_000, Math.max(2200, line.text.trim().length * 150 + 1000));
  const span = explicit - line.start_ms;
  if (Number.isFinite(span) && span > 0 && span <= estimate * 2) return explicit;
  return line.start_ms + (Number.isFinite(span) && span > 0 ? Math.min(span, estimate) : estimate);
}

/**
 * Index of the line being sung (−1 before the first) and whether we are inside a long
 * instrumental gap — after a line has been sung, or in an intro before the first line.
 */
export function locateLine(lines: readonly LyricLine[], ms: number): { line: number; interlude: boolean } {
  let line = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.start_ms <= ms + LINE_LEAD_MS) line = i;
    else break;
  }
  const next = lines[line + 1];
  if (!next) return { line, interlude: false };
  const gapStart = line >= 0 ? sungEnd(lines, line) : 0;
  return { line, interlude: next.start_ms - gapStart >= INTERLUDE_MS && ms > gapStart };
}

/** How much of line `i` has been sung at `ms` (0..1), for the karaoke fill. */
export function lineProgress(lines: readonly LyricLine[], i: number, ms: number): number {
  const line = lines[i];
  if (!line) return 0;
  const end = sungEnd(lines, i);
  return clamp01((ms - line.start_ms) / Math.max(1, end - line.start_ms));
}

/**
 * The fill edge as a CSS percentage: a soft 8 % band travels from fully dim (−8 %… 0 %) to fully
 * lit (100 %… 108 %), so neither end shows a half-lit sliver.
 */
export function fillEdge(progress: number): string {
  return `${(-4 + clamp01(progress) * 108).toFixed(2)}%`;
}
