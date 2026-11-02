"use client";

import { useEffect, useRef } from "react";
import { useCurrentTrack } from "@/components/player/hooks";

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
 * Page background: soft colour fields in the colours of the current artwork.
 *
 * Performance contract (it used to drive CSS variables on <html> every frame, forcing a style
 * recalculation of the whole document 60–300 times a second): nothing here runs per frame.
 * The fields are one gradient layer drifting by a CSS transform on the compositor; colours change
 * only when the track changes, and only this element transitions them.
 */
export function LiveBackground() {
  const field = useRef<HTMLDivElement>(null);
  const palette = useCurrentTrack()?.release.artwork?.palette;

  useEffect(() => {
    const c1 = vivid(palette?.dominant, BRAND.c1);
    const c2 = vivid(palette?.vibrant ?? palette?.accent, BRAND.c2);
    const c3 = vivid(palette?.accent ?? palette?.muted_dark, BRAND.c3);
    // Other surfaces read the colours from :root (set once, no transition there).
    const root = document.documentElement.style;
    root.setProperty("--bg-c1", c1);
    root.setProperty("--bg-c2", c2);
    root.setProperty("--bg-c3", c3);
    const el = field.current?.style;
    el?.setProperty("--lb1", c1);
    el?.setProperty("--lb2", c2);
    el?.setProperty("--lb3", c3);
  }, [palette?.dominant, palette?.vibrant, palette?.accent, palette?.muted_dark]);

  return (
    <div className="live-bg" aria-hidden>
      <div ref={field} className="field" />
      <div className="veil" />
    </div>
  );
}
