"use client";

import { useEffect, useRef } from "react";
import { player } from "@/player/controller";

type Rgb = [number, number, number];

const TAU = Math.PI * 2;
const BANDS = 8;
/** Higher bands carry less energy: lift them so the voice and the air move the rings too. */
const BAND_GAIN = Array.from({ length: BANDS }, (_, i) => 1 + i * 0.14);
const FALLBACK: [string, string, string] = ["#8669ff", "#ff6ba8", "#4fd1ff"];

function parseHex(hex: string | null | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Bring a cover colour into a range that glows on dark ground or reads on light ground. */
function tune([r, g, b]: Rgb, theme: "dark" | "light"): Rgb {
  const max = Math.max(r, g, b, 1);
  if (theme === "dark" && max < 150) {
    const k = 150 / max;
    return [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)];
  }
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (theme === "light" && luma > 150) {
    const k = 150 / luma;
    return [r * k, g * k, b * k];
  }
  return [r, g, b];
}

const rgba = (c: Rgb, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Colour across the rings: inner → middle → outer. */
function blend(cols: Rgb[], f: number): Rgb {
  const x = f * (cols.length - 1);
  const i = Math.min(cols.length - 2, Math.floor(x));
  const k = x - i;
  const a = cols[i]!;
  const b = cols[i + 1]!;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export interface WaveFieldProps {
  /** The rings radiate from this element's centre (the play button). */
  anchor: React.RefObject<HTMLElement | null>;
  /** Cover colours, inner → outer; missing ones fall back to Sonora's wave colours. */
  colors: [string | null, string | null, string | null];
  /** The wave is playing: the rings follow the real spectrum and send out a ring on strong beats. */
  live: boolean;
  /** No animation at all: one still frame (redrawn when colours change). */
  still: boolean;
  theme: "dark" | "light";
  className?: string;
}

/**
 * «Моя волна» as a field of resonance rings around the play button: closed contours that breathe
 * slowly when idle and, while the wave plays, swell with the bass, ripple with the mids and
 * highs and ring out on the beat — the same vocabulary as the ripple rings and round covers.
 *
 * Cost contract: one 2D canvas, ≤ 8 rings × ≤ 104 points, no shadows or filters; 30 fps when idle,
 * ≤ 60 fps when live; stops entirely off-screen, in a hidden tab and with reduced motion; colours
 * and props are read from refs, so React never re-renders per frame.
 */
interface Latest {
  colors: readonly (string | null)[];
  live: boolean;
  theme: "dark" | "light";
}

export function WaveField({ anchor, colors, live, still, theme, className = "" }: WaveFieldProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef<Latest>({ colors, live, theme });
  const kick = useRef<(() => void) | null>(null);
  const [c1, c2, c3] = colors;

  useEffect(() => {
    latest.current = { colors: [c1, c2, c3], live, theme };
    kick.current?.();
  }, [c1, c2, c3, live, theme]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const small = window.matchMedia("(max-width: 639.98px)").matches;
    const rings = small ? 6 : 8;
    const points = small ? 64 : 104;
    const dprCap = small ? 1.5 : 2;
    const cos = new Float32Array(points);
    const sin = new Float32Array(points);
    for (let i = 0; i < points; i++) {
      cos[i] = Math.cos((i / points) * TAU);
      sin[i] = Math.sin((i / points) * TAU);
    }
    const xs = new Float32Array(points);
    const ys = new Float32Array(points);
    const phase = Array.from({ length: rings }, (_, k) => [k * 1.7, k * 2.3 + 1, k * 0.9 + 2] as const);
    const raw = new Float32Array(BANDS);
    const level = new Float32Array(BANDS);
    const style = getComputedStyle(document.documentElement);
    const brand = ["--sonora-color-wave-a", "--sonora-color-wave-b", "--sonora-color-wave-c"].map(
      (v, i) => style.getPropertyValue(v).trim() || FALLBACK[i]!,
    );

    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let inner = 48;
    let outer = 320;
    let t = 0;
    let last = performance.now();
    let lastDraw = 0;
    let bassAvg = 0;
    let lastBeat = 0;
    let raf = 0;
    let onScreen = true;
    const ripples: { born: number; power: number }[] = [];

    const targets = (): Rgb[] => {
      const mode = latest.current.theme;
      return [0, 1, 2].map((i) => tune(parseHex(latest.current.colors[i]) ?? parseHex(brand[i]) ?? parseHex(FALLBACK[i])!, mode));
    };
    let want = targets();
    let cols = want;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(dprCap, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      el.width = Math.max(1, Math.round(w * dpr));
      el.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const a = anchor.current?.getBoundingClientRect();
      cx = a ? a.left + a.width / 2 - rect.left : w / 2;
      cy = a ? a.top + a.height / 2 - rect.top : h / 2;
      inner = a ? a.width / 2 + 16 : 56;
      const reach = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
      // Far enough to sweep past the title as arcs; the band's mask fades them before any edge.
      outer = Math.max(inner + 140, Math.min(reach * 0.9, Math.max(h * 1.45, 360)));
    };

    const draw = (now: number, animate: boolean) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { live: isLive, theme: mode } = latest.current;
      const dark = mode === "dark";

      // Spectrum: fast attack, slow release, so the shape is liquid rather than jittery.
      const heard = animate && isLive && player.bands(raw);
      for (let i = 0; i < BANDS; i++) {
        const target = heard
          ? Math.min(1, raw[i]! * BAND_GAIN[i]!)
          : isLive && animate
            ? 0.2 + 0.1 * Math.sin(t * 1.6 + i * 0.9) // no analyser here (native HLS): a calm synthetic pulse
            : 0;
        const v = level[i]!;
        level[i] = v + (target - v) * (target > v ? 0.42 : 0.07);
      }
      let energy = 0;
      for (let i = 0; i < BANDS; i++) energy += level[i]!;
      energy /= BANDS;
      const bass = (level[0]! + level[1]!) / 2;
      bassAvg += (bass - bassAvg) * 0.04;
      if (heard && bass > 0.3 && bass > bassAvg * 1.22 && now - lastBeat > 300) {
        lastBeat = now;
        ripples.push({ born: now, power: Math.min(1, bass * 1.3) });
        if (ripples.length > 5) ripples.shift();
      }
      if (animate) t += dt * (isLive ? 0.75 + energy * 1.5 : 0.3);

      cols = animate
        ? cols.map((c, i) => {
            const to = want[i]!;
            return [c[0] + (to[0] - c[0]) * 0.05, c[1] + (to[1] - c[1]) * 0.05, c[2] + (to[2] - c[2]) * 0.05] as Rgb;
          })
        : want;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";

      // Core glow behind the button, breathing with the bass.
      const glow = inner * (2.1 + bass * 1.8);
      const g = ctx.createRadialGradient(cx, cy, inner * 0.5, cx, cy, glow);
      g.addColorStop(0, rgba(cols[0]!, dark ? 0.3 + energy * 0.35 : 0.16 + energy * 0.12));
      g.addColorStop(1, rgba(cols[0]!, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, glow, 0, TAU);
      ctx.fill();

      for (let k = 0; k < rings; k++) {
        const f = k / (rings - 1);
        // Denser near the button, opening up outwards, like ripples on water.
        const base = inner + 8 + f ** 1.35 * (outer - inner - 8);
        const wobble = (3 + f * 20) * (0.7 + energy * 1.6);
        const lift = 6 + f * 42;
        const swell = 1 + bass * 0.07 * (1 - f);
        const [p1, p2, p3] = phase[k]!;
        const turn = t * 0.16 * (k % 2 ? 1 : -1);
        for (let i = 0; i < points; i++) {
          const a = (i / points) * TAU;
          const n =
            Math.sin(a * 3 + t * (0.9 + f * 0.5) + p1) * 0.5 +
            Math.sin(a * 5 - t * 0.7 + p2) * 0.3 +
            Math.sin(a * 2 + t * 0.45 + p3) * 0.2;
          // Spectrum laid around the ring, mirrored so the contour closes smoothly, turning slowly.
          let u = ((a + turn) / Math.PI) % 2;
          if (u < 0) u += 2;
          if (u > 1) u = 2 - u;
          const bi = u * (BANDS - 1);
          const b0 = Math.floor(bi);
          const l0 = level[b0]!;
          const l1 = level[Math.min(BANDS - 1, b0 + 1)]!;
          const r = base * swell + n * wobble + (l0 + (l1 - l0) * (bi - b0)) * lift;
          xs[i] = cx + cos[i]! * r;
          ys[i] = cy + sin[i]! * r;
        }
        ctx.beginPath();
        ctx.moveTo((xs[points - 1]! + xs[0]!) / 2, (ys[points - 1]! + ys[0]!) / 2);
        for (let i = 0; i < points; i++) {
          const j = (i + 1) % points;
          ctx.quadraticCurveTo(xs[i]!, ys[i]!, (xs[i]! + xs[j]!) / 2, (ys[i]! + ys[j]!) / 2);
        }
        ctx.closePath();
        ctx.strokeStyle = rgba(blend(cols, f), (dark ? 0.78 : 0.62) * (1 - f * 0.74));
        ctx.lineWidth = 2.1 - f * 1.0;
        ctx.stroke();
      }

      // Beat rings travelling outwards.
      for (let i = ripples.length - 1; i >= 0; i--) {
        const ripple = ripples[i]!;
        const p = (now - ripple.born) / 1700;
        if (p >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        const eased = 1 - (1 - p) ** 3;
        ctx.beginPath();
        ctx.arc(cx, cy, inner + eased * (outer * 1.1 - inner), 0, TAU);
        ctx.strokeStyle = rgba(cols[1]!, (1 - p) ** 2 * (dark ? 0.55 : 0.4) * ripple.power);
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const running = () => onScreen && !document.hidden && !still;
    const frame = (now: number) => {
      raf = 0;
      if (!running()) return;
      const interval = latest.current.live ? 15 : 32;
      if (now - lastDraw >= interval) {
        lastDraw = now;
        draw(now, true);
      }
      raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (still) {
        draw(performance.now(), false);
        return;
      }
      if (!raf && running()) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    kick.current = () => {
      want = targets();
      wake();
    };

    measure();
    draw(performance.now(), false);
    wake();

    const resize = new ResizeObserver(() => {
      measure();
      draw(performance.now(), false);
    });
    resize.observe(el);
    if (anchor.current) resize.observe(anchor.current);
    const io = new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting);
      wake();
    });
    io.observe(el);
    const onVisibility = () => wake();
    document.addEventListener("visibilitychange", onVisibility);
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (!alive) return;
      measure();
      draw(performance.now(), false);
    });
    return () => {
      alive = false;
      kick.current = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resize.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [anchor, still]);

  return <canvas ref={canvas} className={`pointer-events-none block ${className}`} aria-hidden />;
}
