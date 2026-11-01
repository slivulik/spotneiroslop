export function PageError({ message }: { message: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="font-display text-title-2">Что-то пошло не так</div>
      <div className="text-body text-text-secondary">{message}</div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-white/6 ${className}`} />;
}

interface Tint {
  dominant?: string | null;
  vibrant?: string | null;
}

/** Page header tinted with the artwork palette, fading into the base background. Dark covers
 * have a near-black dominant colour, so the vibrant colour is mixed in to keep the tint alive. */
export function TintedHeader({ palette, children }: { palette: Tint | null | undefined; children: React.ReactNode }) {
  const dominant = palette?.dominant ?? "#2A2340";
  const tint = palette?.vibrant ? `color-mix(in srgb, ${palette.vibrant} 45%, ${dominant})` : dominant;
  return (
    <header className="relative overflow-hidden [text-shadow:0_1px_12px_rgba(0,0,0,0.25)]">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: `linear-gradient(180deg, ${tint} 0%, color-mix(in srgb, ${tint} 40%, var(--sonora-color-bg-base)) 62%, var(--sonora-color-bg-base) 100%)`,
        }}
      />
      {children}
    </header>
  );
}
