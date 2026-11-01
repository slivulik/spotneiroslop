"use client";

import Link from "next/link";
import { use } from "react";
import { Artwork } from "@/components/Artwork";
import { QualityBadge } from "@/components/Badges";
import { PauseIcon, PlayIcon, ShuffleIcon } from "@/components/icons";
import { PageError, Skeleton, TintedHeader } from "@/components/Page";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { TrackList } from "@/components/TrackList";
import { formatTotal, pluralTracks, releaseTypeLabel } from "@/lib/format";
import { useRelease } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { player } from "@/player/controller";
import { toQueueTrack } from "@/player/queue";
import { usePlayer } from "@/player/store";
import { useRouter } from "next/navigation";

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const release = useRelease(id);
  const authenticated = useSession((s) => s.status === "authenticated");
  const router = useRouter();
  const contextId = usePlayer((s) => s.context?.id);
  const currentTrack = useCurrentTrack();
  const playing = useIsPlaying();

  if (release.isError) return <PageError message="Релиз не найден или ещё не опубликован" />;
  const data = release.data;
  const palette = data?.artwork?.palette;
  const playable = data?.tracks.filter((t) => t.playable) ?? [];
  const isThisPlaying = contextId === id && playing && currentTrack !== null;
  const anyHires = data?.tracks.some((t) => t.audio.hires) ?? false;
  const allLossless = (data?.tracks.length ?? 0) > 0 && (data?.tracks.every((t) => t.audio.lossless) ?? false);

  const play = (shuffle: boolean) => {
    if (!data) return;
    if (!authenticated) {
      router.push(`/login?next=/album/${id}`);
      return;
    }
    if (contextId === id && !shuffle && currentTrack) {
      player.toggle();
      return;
    }
    player.playTracks(playable.map(toQueueTrack), 0, { type: "release", id, title: data.title }, { shuffle });
  };

  return (
    <div>
      <TintedHeader palette={palette}>
        <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-6 px-4 pb-8 pt-10 md:flex-row md:items-end md:gap-8 md:px-8 md:pt-16">
          {data ? (
            <Artwork artwork={data.artwork} alt={data.title} sizes="(min-width: 900px) 260px, 70vw" className="aspect-square w-[70vw] max-w-[260px] shrink-0 rounded-lg shadow-artwork" priority />
          ) : (
            <Skeleton className="aspect-square w-[70vw] max-w-[260px]" />
          )}
          <div className="flex min-w-0 flex-col items-center gap-3 text-center md:items-start md:text-left">
            {data ? (
              <>
                <span className="text-micro uppercase text-text-primary/70">{releaseTypeLabel(data.type)}</span>
                <h1 className="font-display text-display-l leading-none md:text-display-xl">{data.title}</h1>
                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-body text-text-primary/80 md:justify-start">
                  {data.artists.map((a, i) => (
                    <span key={a.id}>
                      {i > 0 ? ", " : null}
                      <Link href={`/artist/${a.id}`} className="font-semibold text-text-primary hover:underline">
                        {a.name}
                      </Link>
                    </span>
                  ))}
                  <span>· {[data.release_date?.slice(0, 4), pluralTracks(data.track_count), formatTotal(data.total_duration_ms)].filter(Boolean).join(" · ")}</span>
                </div>
                {anyHires || allLossless ? <QualityBadge hires={anyHires} lossless={allLossless} /> : null}
              </>
            ) : (
              <>
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-12 w-72" />
                <Skeleton className="h-4 w-48" />
              </>
            )}
          </div>
        </div>
      </TintedHeader>

      <div className="mx-auto max-w-[1600px] px-2 md:px-6">
        <div className="flex items-center gap-4 px-2 py-5">
          <button
            type="button"
            onClick={() => play(false)}
            disabled={!data || (authenticated && playable.length === 0)}
            aria-label={isThisPlaying ? "Пауза" : "Слушать"}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
          >
            {isThisPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} style={{ marginLeft: 3 }} />}
          </button>
          <button
            type="button"
            onClick={() => play(true)}
            disabled={!data || (authenticated && playable.length === 0)}
            aria-label="Перемешать"
            className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:text-text-primary disabled:opacity-40"
          >
            <ShuffleIcon size={24} />
          </button>
        </div>
        {data ? <TrackList tracks={data.tracks} context={{ type: "release", id, title: data.title }} /> : null}
        {data?.label ? <p className="px-4 pb-6 pt-8 text-caption text-text-tertiary">℗ {data.label}</p> : null}
      </div>
    </div>
  );
}
