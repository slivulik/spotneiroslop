"use client";

import type { components } from "@sonora/api-schema";
import Link from "next/link";
import { Artwork } from "@/components/Artwork";
import { PlayIcon } from "@/components/icons";
import { LikeButton } from "@/components/LikeButton";
import { api, unwrap } from "@/lib/api";
import { playTracks } from "@/lib/play";

type Artist = components["schemas"]["ArtistSummary"];

async function playArtist(a: Artist) {
  const top = await unwrap(api.GET("/v1/artists/{artist_id}/top-tracks", { params: { path: { artist_id: a.id } } }));
  playTracks(top.items, null, { type: "artist", id: a.id, title: a.name });
}

/** Portrait artist card: photo edge to edge, name over a soft scrim, follow + play on hover. */
export function ArtistCard({ artist, caption = "Артист" }: { artist: Artist; caption?: string }) {
  return (
    <Link href={`/artist/${artist.id}`} className="group relative block aspect-[3/4] overflow-hidden rounded-xl bg-bg-raised shadow-md transition-transform duration-300 ease-standard hover:-translate-y-1">
      <Artwork artwork={artist.artwork} alt={artist.name} seed={artist.name} sizes="(min-width: 1024px) 16vw, 40vw" className="absolute inset-0 h-full w-full transition-transform duration-700 ease-standard group-hover:scale-[1.06]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      <div className="absolute right-2 top-2 rounded-full bg-black/35 backdrop-blur-md">
        <LikeButton kind="artists" id={artist.id} size={16} className="text-white" />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-2 p-3">
        <div className="min-w-0 flex-1 text-white">
          <span className="mono-label block text-white/70">{artist.verified ? "✓ " : ""}{caption}</span>
          <span className="block truncate font-display text-title-3 font-bold leading-tight">{artist.name}</span>
        </div>
        <button
          type="button"
          aria-label={`Слушать ${artist.name}`}
          data-ripple
          onClick={(e) => {
            e.preventDefault();
            void playArtist(artist);
          }}
          className="btn-accent flex h-10 w-10 shrink-0 translate-y-2 items-center justify-center rounded-full opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100"
        >
          <PlayIcon size={18} style={{ marginLeft: 2 }} />
        </button>
      </div>
    </Link>
  );
}
