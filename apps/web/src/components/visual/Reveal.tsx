/**
 * Fade-and-rise on first render — pure CSS (opacity + transform only, no filter, no JS per frame),
 * staggered by `index` and capped so long lists never wait.
 */
export function Reveal({ children, index = 0, className = "" }: { children: React.ReactNode; index?: number; className?: string }) {
  return (
    <div className={`reveal ${className}`} style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
      {children}
    </div>
  );
}

/** Hover lift for cards (CSS transform on the compositor; replaces the old pointer-tracking 3D tilt). */
export function Tilt({ children, className = "" }: { children: React.ReactNode; className?: string; max?: number }) {
  return <div className={`lift ${className}`}>{children}</div>;
}
