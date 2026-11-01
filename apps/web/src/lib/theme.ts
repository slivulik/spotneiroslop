/**
 * Colour maths for the runtime accent (dynamic from artwork, or user-picked): whatever colour
 * comes in, the result keeps WCAG contrast — ≥ 3:1 against the page for icons/controls and
 * ≥ 4.5:1 for the text drawn on top of it.
 */
export type ThemeName = "dark" | "light";

const BG: Record<ThemeName, string> = { dark: "#0B0A10", light: "#F6F5FA" };
const INK = "#0B0A10";

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: [number, number, number]) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(hexToRgb(a)!), luminance(hexToRgb(b)!)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255];
}

function withLightness(hex: string, l: number, minSat = 0): string {
  const [h, s] = toHsl(hexToRgb(hex)!);
  return toHex(fromHsl([h, Math.max(s, minSat), Math.min(0.92, Math.max(0.12, l))]));
}

export interface AccentSet {
  default: string;
  hover: string;
  pressed: string;
  muted: string;
  on: string;
}

/** A usable accent for `theme` derived from any colour (artwork vibrant, user pick). */
export function accentFor(input: string, theme: ThemeName): AccentSet | null {
  if (!hexToRgb(input)) return null;
  const bg = BG[theme];
  // Washed-out artwork colours still need to read as an accent.
  let [, s, l] = toHsl(hexToRgb(input)!);
  s = Math.max(s, 0.45);
  let color = toHex(fromHsl([toHsl(hexToRgb(input)!)[0], s, l]));
  // Walk lightness until the accent stands out from the page (≥ 3:1) and white text on it is legible (≥ 4.5:1),
  // preferring white text; dark themes push lighter for page contrast, light themes push darker.
  for (let i = 0; i < 40 && !(contrast(color, bg) >= 3 && contrast("#FFFFFF", color) >= 4.5); i++) {
    l += theme === "dark" ? (contrast("#FFFFFF", color) < 4.5 ? -0.015 : 0.015) : -0.015;
    color = withLightness(color, l, 0.45);
  }
  const on = contrast("#FFFFFF", color) >= 4.5 ? "#FFFFFF" : INK;
  const [, , base] = toHsl(hexToRgb(color)!);
  const rgb = hexToRgb(color)!;
  return {
    default: color,
    hover: withLightness(color, base + (theme === "dark" ? 0.08 : -0.06)),
    pressed: withLightness(color, base + (theme === "dark" ? -0.06 : -0.12)),
    muted: `rgba(${rgb.join(", ")}, ${theme === "dark" ? 0.18 : 0.12})`,
    on,
  };
}
