import type { components } from "@sonora/api-schema";
import { Artwork } from "@/components/Artwork";

type Playlist = Pick<components["schemas"]["PlaylistSummary"], "artwork" | "mosaic" | "title">;

/**
 * Own cover, or a generated "pressing": the first release as the label of a record, its
 * grooves tinted by the palettes of the next releases, the title set in the display face.
 */
export function PlaylistCover({ playlist, sizes, className = "" }: { playlist: Playlist; sizes: string; className?: string }) {
  if (playlist.artwork || playlist.mosaic.length === 0) {
    return <Artwork artwork={playlist.artwork ?? null} alt={playlist.title} sizes={sizes} className={className} seed={playlist.title} />;
  }
  const [label, ...rest] = playlist.mosaic;
  const tones = [label, ...rest].map((a) => a?.palette?.vibrant ?? a?.palette?.dominant ?? "#FF5A36");
  const base = label?.palette?.muted_dark ?? label?.palette?.dominant ?? "#1b1815";
  return (
    <div className={`@container relative overflow-hidden ${className}`} style={{ background: `radial-gradient(90% 90% at 70% 30%, color-mix(in srgb, ${tones[0]} 35%, ${base}), ${base} 70%, #0a0908)` }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <circle key={i} cx="62" cy="40" r={20 + i * 5.2} fill="none" stroke={tones[i % tones.length]} strokeOpacity={0.55 - i * 0.05} strokeWidth={i % 3 === 0 ? 1.4 : 0.6} />
        ))}
      </svg>
      <div className="absolute overflow-hidden rounded-full shadow-artwork ring-2 ring-black/30" style={{ left: "62%", top: "40%", width: "38%", height: "38%", transform: "translate(-50%, -50%)" }}>
        <Artwork artwork={label ?? null} alt="" sizes="120px" className="h-full w-full" />
      </div>
      <span className="absolute bottom-[8%] left-[8%] right-[8%] line-clamp-2 font-display text-[9cqw] font-bold leading-tight text-white drop-shadow-lg">{playlist.title}</span>
    </div>
  );
}
