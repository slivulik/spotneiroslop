"use client";

import { use } from "react";
import { CollectionHeader } from "@/components/CollectionHeader";
import { MixCover } from "@/components/home/Personal";
import { PageError, Skeleton } from "@/components/Page";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { TrackList } from "@/components/TrackList";
import { formatTotal, pluralTracks } from "@/lib/format";
import { playTracks } from "@/lib/play";
import { useMix, useMixes } from "@/lib/recommend";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

export default function MixPage({ params }: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent(use(params).key);
  const mix = useMix(key);
  const summary = useMixes().data?.find((m) => m.key === key);
  const contextId = usePlayer((s) => (s.context?.type === "mix" ? s.context.id : null));
  const current = useCurrentTrack();
  const playing = useIsPlaying();
  if (mix.isError) return <PageError message="Микс недоступен — миксы обновляются каждый день" />;
  const data = mix.data;
  if (!data) return <div className="p-8"><Skeleton className="h-80 w-full rounded-2xl" /></div>;
  const context = { type: "mix" as const, id: key, title: data.title };
  const isThis = contextId === key && current !== null;
  return (
    <div className="flex flex-col gap-6">
      <CollectionHeader
        cover={summary ? <MixCover mix={summary} /> : <div className="aspect-square w-full rounded-lg bg-accent-muted" />}
        kicker="Микс дня"
        title={data.title}
        description={data.subtitle}
        tint={summary?.mosaic[0]?.palette?.vibrant}
        meta={<span>{[pluralTracks(data.tracks.length), formatTotal(data.tracks.reduce((n, t) => n + t.duration_ms, 0)), "собран по вашей истории"].join(" · ")}</span>}
        playing={isThis && playing}
        disabled={!data.tracks.length}
        onPlay={() => (isThis ? player.toggle() : playTracks(data.tracks, null, context))}
        onShuffle={() => playTracks(data.tracks, null, context, { shuffle: true })}
      />
      <div className="mx-auto w-full max-w-[1680px] px-2 md:px-6">
        <TrackList tracks={data.tracks} context={context} variant="popular" />
      </div>
    </div>
  );
}
