import type { components } from "@sonora/api-schema";
import { Artwork } from "@/components/Artwork";

type Playlist = Pick<components["schemas"]["PlaylistSummary"], "artwork" | "mosaic" | "title">;

/** Own cover, or a 2×2 collage of the first releases. */
export function PlaylistCover({ playlist, sizes, className = "" }: { playlist: Playlist; sizes: string; className?: string }) {
  if (playlist.artwork || playlist.mosaic.length < 4) {
    return <Artwork artwork={playlist.artwork ?? playlist.mosaic[0] ?? null} alt={playlist.title} sizes={sizes} className={className} seed={playlist.title} />;
  }
  return (
    <div className={`grid grid-cols-2 grid-rows-2 overflow-hidden ${className}`}>
      {playlist.mosaic.slice(0, 4).map((art, i) => (
        <Artwork key={i} artwork={art} alt="" sizes="160px" className="h-full w-full" />
      ))}
    </div>
  );
}
