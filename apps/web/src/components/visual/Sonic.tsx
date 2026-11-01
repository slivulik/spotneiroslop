"use client";

import { useEffect, useRef, useState } from "react";
import { player } from "@/player/controller";

/**
 * Sonora's visual vocabulary: sound made visible. Every element here is derived from audio —
 * a track's real waveform, the live analyser, or a waveform deterministically seeded from a
 * name so the same release always wears the same "signature".
 */

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic, music-like peaks (0..1): a few layered sines plus seeded jitter. */
export function signature(seed: string, count: number): number[] {
  let state = hash(seed) || 1;
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };
  const f1 = 1 + rand() * 3;
  const f2 = 4 + rand() * 6;
  const phase = rand() * Math.PI * 2;
  return Array.from({ length: count }, (_, i) => {
    const x = i / count;
    const body = 0.55 + 0.25 * Math.sin(x * Math.PI * 2 * f1 + phase) + 0.12 * Math.sin(x * Math.PI * 2 * f2);
    return Math.max(0.12, Math.min(1, body * (0.75 + rand() * 0.45)));
  });
}

/** Resample real 0–255 peaks (or a seeded signature) to `count` bars in 0..1. */
export function bars(peaks: number[] | null | undefined, seed: string, count: number): number[] {
  if (!peaks || peaks.length === 0) return signature(seed, count);
  const out: number[] = [];
  const step = peaks.length / count;
  for (let i = 0; i < count; i++) {
    let max = 0;
    for (let j = Math.floor(i * step); j < Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1); j++) max = Math.max(max, peaks[j] ?? 0);
    out.push(Math.max(0.06, max / 255));
  }
  return out;
}

/** Radial waveform around a round cover; spins slowly, faster on hover or while playing. */
export function ResonanceRing({
  seed,
  colors,
  size,
  live = false,
  children,
}: {
  seed: string;
  colors: [string, string];
  size: number;
  live?: boolean;
  children: React.ReactNode;
}) {
  const count = 56;
  const peaks = signature(seed, count);
  const inner = size * 0.39;
  const id = `rr-${hash(seed).toString(36)}`;
  return (
    <span className={`resonance relative inline-block ${live ? "live" : ""}`} style={{ width: size, height: size }}>
      <svg className="absolute inset-0" viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={colors[0]} />
            <stop offset="1" stopColor={colors[1]} />
          </linearGradient>
        </defs>
        <g className="spin" stroke={`url(#${id})`} strokeWidth={Math.max(1.6, size / 70)} strokeLinecap="round">
          {peaks.map((p, i) => {
            const a = (i / count) * Math.PI * 2;
            const r0 = inner + 4;
            const r1 = r0 + 3 + p * (size / 2 - r0 - 4);
            const c = size / 2;
            return <line key={i} x1={c + Math.cos(a) * r0} y1={c + Math.sin(a) * r0} x2={c + Math.cos(a) * r1} y2={c + Math.sin(a) * r1} />;
          })}
        </g>
      </svg>
      <span className="absolute overflow-hidden rounded-full" style={{ inset: size / 2 - inner }}>
        {children}
      </span>
    </span>
  );
}

/** A waveform line that draws itself when it scrolls into view. */
export function WaveRule({ seed, className = "" }: { seed: string; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry?.isIntersecting && (setDrawn(true), io.disconnect()), { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // A smooth "signal": seeded layered sines under a soft envelope that swells mid-line.
  const [p1, p2, p3] = signature(seed, 3);
  const d = Array.from({ length: 241 }, (_, i) => {
    const x = i / 240;
    const env = Math.sin(Math.PI * x) ** 1.5 * (0.55 + 0.45 * Math.sin(x * Math.PI * (2 + p3! * 3) + p1! * 6));
    const y = Math.sin(x * Math.PI * (14 + p1! * 18)) * 0.65 + Math.sin(x * Math.PI * (37 + p2! * 25)) * 0.35;
    return `${i ? "L" : "M"}${(x * 400).toFixed(1)} ${(10 + y * env * 8.5).toFixed(2)}`;
  }).join(" ");
  return (
    <svg ref={ref} viewBox="0 0 400 20" preserveAspectRatio="none" className={`wave-rule ${drawn ? "drawn" : ""} ${className}`} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Live oscilloscope of what is playing; a slow calm sine when silent. */
export function Oscilloscope({ className = "", height = 48 }: { className?: string; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const data = new Uint8Array(new ArrayBuffer(1024));
    let frame = 0;
    let t = 0;
    let level = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      if (el.width !== Math.round(w * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, height);
      const live = player.oscilloscope(data);
      level += ((live ? 1 : 0) - level) * 0.06;
      const style = getComputedStyle(document.documentElement);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "transparent");
      grad.addColorStop(0.15, style.getPropertyValue("--sonora-color-wave-a").trim() || "#ff5a36");
      grad.addColorStop(0.5, style.getPropertyValue("--sonora-color-wave-b").trim() || "#ffb23f");
      grad.addColorStop(0.85, style.getPropertyValue("--sonora-color-wave-c").trim() || "#2fe0c8");
      grad.addColorStop(1, "transparent");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = style.getPropertyValue("--sonora-color-wave-b").trim() || "#ffb23f";
      ctx.shadowBlur = 8 + level * 10;
      ctx.beginPath();
      const steps = Math.min(256, Math.floor(w / 3));
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        const calm = Math.sin(i / 9 + t / 30) * 0.18 * Math.sin(i / 37 + t / 90);
        const sample = live ? ((data[Math.floor((i / steps) * 511)] ?? 128) - 128) / 128 : 0;
        const v = calm * (1 - level) + sample * level * 1.6;
        const y = height / 2 + v * (height / 2 - 3);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      t += 1;
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [height]);
  return <canvas ref={canvas} className={`block w-full ${className}`} style={{ height }} aria-hidden />;
}

/** Clicking anything marked `data-ripple` sends three resonance rings out from the pointer. */
export function Ripples() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onDown = (e: PointerEvent) => {
      const target = (e.target as Element | null)?.closest("[data-ripple]");
      if (!target) return;
      for (let i = 0; i < 3; i++) {
        const ring = document.createElement("span");
        ring.className = "ripple-ring";
        ring.style.left = `${e.clientX}px`;
        ring.style.top = `${e.clientY}px`;
        ring.style.animationDelay = `${i * 110}ms`;
        ring.style.setProperty("--ring-scale", String(5 + i * 2.5));
        ring.addEventListener("animationend", () => ring.remove(), { once: true });
        document.body.appendChild(ring);
      }
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}

/** Seek bar drawn as the track's real waveform; played part lit, hover previews the jump. */
export function WaveformSeek({
  peaks,
  seed,
  progress,
  onSeek,
  count = 120,
  height = 28,
  className = "",
}: {
  peaks: number[] | null | undefined;
  seed: string;
  progress: number;
  onSeek: (fraction: number) => void;
  count?: number;
  height?: number;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const values = bars(peaks, seed, count);
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Перемотка"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className={`group relative flex cursor-pointer items-center gap-[2px] ${className}`}
      style={{ height }}
      onPointerMove={(e) => setHover(pick(e))}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => onSeek(pick(e as unknown as React.PointerEvent<HTMLDivElement>))}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(Math.min(1, progress + 0.02));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.02));
      }}
    >
      {values.map((v, i) => {
        const at = (i + 0.5) / count;
        const played = at <= progress;
        const previewed = hover !== null && ((at > progress && at <= hover) || (at <= progress && at > hover));
        return (
          <span
            key={i}
            className="flex-1 rounded-full transition-[background-color,transform] duration-150"
            style={{
              height: `${Math.max(10, v * 100)}%`,
              background: played
                ? "linear-gradient(to top, var(--sonora-color-wave-a), var(--sonora-color-wave-b))"
                : previewed
                  ? "color-mix(in srgb, var(--sonora-color-text-primary) 45%, transparent)"
                  : "color-mix(in srgb, var(--sonora-color-text-primary) 20%, transparent)",
              transform: hover !== null && Math.abs(at - hover) < 0.02 ? "scaleY(1.25)" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
