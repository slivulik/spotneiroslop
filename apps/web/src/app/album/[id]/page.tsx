"use client";

import Link from "next/link";
import { use } from "react";
import { Artwork } from "@/components/Artwork";
import { QualityBadge } from "@/components/Badges";
import { CollectionHeader } from "@/components/CollectionHeader";
import { PageError, Skeleton } from "@/components/Page";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { TrackList } from "@/components/TrackList";
import { formatTotal, pluralTracks, releaseTypeLabel } from "@/lib/format";
import { playRelease } from "@/lib/play";
import { useRelease } from "@/lib/queries";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const release = useRelease(id);
  const contextId = usePlayer((s) => s.context?.id);
  const current = useCurrentTrack();
  const playing = useIsPlaying();
  if (release.isError) return <PageError message="Релиз не найден или ещё не опубликован" />;
  const data = release.data;
  if (!data) return <div className="p-8"><Skeleton className="h-80 w-full rounded-[36px]" /></div>;
  const isThis = contextId === id && current !== null;
  const hires = data.tracks.some((t) => t.audio.hires);
  const lossless = data.tracks.length > 0 && data.tracks.every((t) => t.audio.lossless);
  return (
    <div className="flex flex-col gap-6">
      <CollectionHeader
        cover={<Artwork artwork={data.artwork} alt={data.title} sizes="280px" priority className="aspect-square w-full rounded-[28px] shadow-artwork" />}
        kicker={releaseTypeLabel(data.type)}
        title={data.title}
        tint={data.artwork?.palette?.vibrant}
        meta={
          <>
            {data.artists.map((a, i) => (
              <span key={a.id}>
                {i > 0 ? ", " : null}
                <Link href={`/artist/${a.id}`} className="font-bold text-text-primary hover:underline">{a.name}</Link>
              </span>
            ))}
            <span>· {[data.release_date?.slice(0, 4), pluralTracks(data.track_count), formatTotal(data.total_duration_ms)].filter(Boolean).join(" · ")}</span>
          </>
        }
        badge={hires || lossless ? <QualityBadge hires={hires} lossless={lossless} /> : null}
        playing={isThis && playing}
        disabled={data.tracks.length === 0}
        onPlay={() => (isThis ? player.toggle() : void playRelease(id))}
        onShuffle={() => void playRelease(id, true)}
      />
      <div className="mx-auto w-full max-w-[1680px] px-2 md:px-6">
        <TrackList tracks={data.tracks} context={{ type: "release", id, title: data.title }} />
        {data.label ? <p className="px-4 pb-6 pt-8 text-caption text-text-tertiary">℗ {data.label}</p> : null}
      </div>
    </div>
  );
}
