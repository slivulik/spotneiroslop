"use client";

import { type PointerEvent, useCallback } from "react";

/**
 * One pointer listener for a whole group of cards: each `.spotlight` child gets `--mx/--my`
 * relative to itself, so its glass border lights up under the cursor (and neighbours catch
 * the edge of the glow).
 */
export function useSpotlight() {
  return useCallback((event: PointerEvent<HTMLElement>) => {
    const cards = event.currentTarget.querySelectorAll<HTMLElement>(".spotlight");
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    }
  }, []);
}

export function SpotlightZone({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const onPointerMove = useSpotlight();
  return (
    <div className={`spotlight-zone ${className}`} onPointerMove={onPointerMove}>
      {children}
    </div>
  );
}
