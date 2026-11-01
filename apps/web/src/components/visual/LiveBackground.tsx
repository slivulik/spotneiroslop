"use client";

import { useEffect, useRef } from "react";
import { useCurrentTrack } from "@/components/player/hooks";
import { player } from "@/player/controller";

const BRAND = { c1: "#8a2a12", c2: "#2a2f8f", c3: "#0b5f56" };

/** Pull a colour towards a usable brightness for a glowing background. */
function vivid(hex: string | null | undefined, fallback: string): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  const n = Number.parseInt(hex.slice(1), 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const max = Math.max(r, g, b);
  if (max < 90) {
    const k = 90 / Math.max(max, 1);
    [r, g, b] = [r * k, g * k, b * k];
  }
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}

/**
 * The page background: three drifting colour fields. While music plays they take the colours
 * of the current artwork (cross-fading via @property transitions) and swell with the music:
 * a rAF loop reads the analyser and writes `--energy` (smoothed loudness) and `--beat` (bass
 * onsets, decaying) on <html>. CSS does the rest, so React never re-renders per frame.
 */
export function LiveBackground() {
  const rings = useRef<HTMLDivElement>(null);
  const track = useCurrentTrack();
  const palette = track?.release.artwork?.palette;

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--bg-c1", vivid(palette?.dominant, BRAND.c1));
    root.setProperty("--bg-c2", vivid(palette?.vibrant ?? palette?.accent, BRAND.c2));
    root.setProperty("--bg-c3", vivid(palette?.accent ?? palette?.muted_dark, BRAND.c3));
  }, [palette?.dominant, palette?.vibrant, palette?.accent, palette?.muted_dark]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement.style;
    let frame = 0;
    let energy = 0;
    let beat = 0;
    let bassAvg = 0;
    let t = 0;
    let lastRing = 0;
    // A strong beat sends a resonance ring out from the player across the whole page.
    const ring = (now: number) => {
      const host = rings.current;
      if (!host || now - lastRing < 600 || host.childElementCount > 5) return;
      lastRing = now;
      const el = document.createElement("span");
      el.className = "beat-ring";
      el.addEventListener("animationend", () => el.remove(), { once: true });
      host.appendChild(el);
    };
    const tick = (now: number) => {
      t += 1;
      const levels = player.levels();
      let targetEnergy = 0;
      if (levels) {
        targetEnergy = Math.min(1, levels.energy * 2.2);
        // Onset: bass jumps well above its running average.
        if (levels.bass > bassAvg * 1.28 && levels.bass > 0.32) {
          if (beat < 0.5 && levels.bass > 0.55) ring(now);
          beat = 1;
        }
        bassAvg = bassAvg * 0.93 + levels.bass * 0.07;
      } else if (player.isPlaying()) {
        // Native HLS (Safari) has no analyser: breathe gently instead.
        targetEnergy = 0.35 + 0.15 * Math.sin(t / 40);
      }
      energy += (targetEnergy - energy) * (targetEnergy > energy ? 0.25 : 0.05);
      beat *= 0.9;
      root.setProperty("--energy", energy.toFixed(3));
      root.setProperty("--beat", beat.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="live-bg" aria-hidden>
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="blob b3" />
      <div className="pulse" />
      <div ref={rings} className="absolute inset-0" />
      <div className="veil" />
      <div className="grain noise" />
    </div>
  );
}
