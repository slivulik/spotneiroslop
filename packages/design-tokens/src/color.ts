/** RGBA colour with channels 0–255 and alpha 0–1. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX_RE = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
const RGBA_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+|1\.0+))?\s*\)$/i;

export function parseColor(input: string): Rgba {
  const hex = HEX_RE.exec(input);
  if (hex) {
    const rgb = hex[1] as string;
    const alpha = hex[2];
    return {
      r: Number.parseInt(rgb.slice(0, 2), 16),
      g: Number.parseInt(rgb.slice(2, 4), 16),
      b: Number.parseInt(rgb.slice(4, 6), 16),
      a: alpha === undefined ? 1 : Number.parseInt(alpha, 16) / 255,
    };
  }
  const rgba = RGBA_RE.exec(input);
  if (rgba) {
    const [r, g, b] = [rgba[1], rgba[2], rgba[3]].map((c) => Number(c));
    if ([r, g, b].some((c) => c === undefined || c > 255)) {
      throw new Error(`Colour channel out of range: ${input}`);
    }
    return { r: r as number, g: g as number, b: b as number, a: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  }
  throw new Error(`Unsupported colour format: ${input}`);
}

/** Kotlin/Android ARGB literal, e.g. 0xFF0B0B0F. */
export function toArgbHex(color: Rgba): string {
  const channel = (n: number): string => n.toString(16).padStart(2, "0").toUpperCase();
  const alpha = Math.round(color.a * 255);
  return `0x${channel(alpha)}${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(color: Rgba): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(color.r) + 0.7152 * lin(color.g) + 0.0722 * lin(color.b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
