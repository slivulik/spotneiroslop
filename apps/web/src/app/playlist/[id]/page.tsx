"use client";

import { use } from "react";
import { CollectionHeader } from "@/components/CollectionHeader";
import { PageError, Skeleton } from "@/components/Page";
import { PlaylistCover } from "@/components/PlaylistCover";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { TrackList } from "@/components/TrackList";
import { formatTotal, pluralTracks } from "@/lib/format";
import { playPlaylist } from "@/lib/play";
import { usePlaylist } from "@/lib/queries";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const playlist = usePlaylist(id);
  const contextId = usePlayer((s) => s.context?.id);
  const current = useCurrentTrack();
  const playing = useIsPlaying();
  if (playlist.isError) return <PageError message="Плейлист не найден" />;
  const data = playlist.data;
  if (!data) return <div className="p-8"><Skeleton className="h-80 w-full rounded-2xl" /></div>;
  const isThis = contextId === id && current !== null;
  return (
    <div className="flex flex-col gap-6">
      <CollectionHeader
        cover={<PlaylistCover playlist={data} sizes="280px" className="aspect-square w-full rounded-xl shadow-artwork" />}
        kicker={data.type === "editorial" ? "Подборка редакции" : "Плейлист"}
        title={data.title}
        description={data.description}
        tint={data.artwork?.palette?.vibrant ?? data.mosaic[0]?.palette?.vibrant}
        meta={<span>{[data.owner_name ?? "Sonora", pluralTracks(data.track_count), formatTotal(data.total_duration_ms)].join(" · ")}</span>}
        playing={isThis && playing}
        disabled={data.tracks.length === 0}
        onPlay={() => (isThis ? player.toggle() : void playPlaylist(id))}
        onShuffle={() => void playPlaylist(id, true)}
      />
      <div className="mx-auto w-full max-w-[1680px] px-2 md:px-6">
        <TrackList tracks={data.tracks} context={{ type: "playlist", id, title: data.title }} variant="popular" />
      </div>
    </div>
  );
}
