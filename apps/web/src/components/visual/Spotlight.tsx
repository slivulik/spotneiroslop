/**
 * Formerly a pointer-tracked glow on every card (style writes on each mouse move). The minimal
 * design keeps the grouping element only; hover feedback lives in CSS (`.lift`, `.press`).
 */
export function useSpotlight() {
  return undefined;
}

export function SpotlightZone({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={className}>{children}</div>;
}
