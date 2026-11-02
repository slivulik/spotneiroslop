"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { use, useEffect } from "react";
import { Artwork } from "@/components/Artwork";
import { QualityBadge } from "@/components/Badges";
import { CollectionHeader } from "@/components/CollectionHeader";
import { ShareIcon } from "@/components/icons";
import { LikeButton } from "@/components/LikeButton";
import { PageError, Skeleton } from "@/components/Page";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { TrackList } from "@/components/TrackList";
import { formatTotal, pluralTracks, releaseTypeLabel } from "@/lib/format";
import { playRelease } from "@/lib/play";
import { useRelease } from "@/lib/queries";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";
import { share } from "@/lib/share";

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const release = useRelease(id);
  const contextId = usePlayer((s) => s.context?.id);
  const current = useCurrentTrack();
  const playing = useIsPlaying();
  const focus = useSearchParams().get("track");
  const loaded = Boolean(release.data);
  // Shared track links (/album/…?track=…) scroll to and highlight that track.
  useEffect(() => {
    if (!loaded || !focus) return;
    const row = document.getElementById(`t-${focus}`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    row?.classList.add("track-flash");
    const id = setTimeout(() => row?.classList.remove("track-flash"), 2400);
    return () => clearTimeout(id);
  }, [loaded, focus]);
  if (release.isError) return <PageError message="Релиз не найден или ещё не опубликован" />;
  const data = release.data;
  if (!data) return <div className="p-8"><Skeleton className="h-80 w-full rounded-2xl" /></div>;
  const isThis = contextId === id && current !== null;
  const hires = data.tracks.some((t) => t.audio.hires);
  const lossless = data.tracks.length > 0 && data.tracks.every((t) => t.audio.lossless);
  return (
    <div className="flex flex-col gap-6">
      <CollectionHeader
        cover={<Artwork artwork={data.artwork} alt={data.title} sizes="280px" priority className="aspect-square w-full rounded-xl shadow-artwork" />}
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
            <span>· {[data.release_date?.slice(0, 4), ...(data.genres ?? []).slice(0, 2).map((g) => g.name)].filter(Boolean).join(" · ")}</span>
          </>
        }
        badge={hires || lossless ? <QualityBadge hires={hires} lossless={lossless} /> : null}
        playing={isThis && playing}
        disabled={data.tracks.length === 0}
        onPlay={() => (isThis ? player.toggle() : void playRelease(id))}
        onShuffle={() => void playRelease(id, true)}
        actions={
          <>
            <LikeButton kind="releases" id={id} size={22} className="h-12 w-12 rounded-full bg-fg/8 hover:bg-fg/12" />
            <button type="button" aria-label="Поделиться" onClick={() => void share(`/album/${id}`, `${data.title} — ${data.artists.map((a) => a.name).join(", ")}`)} className="bg-fg/8 hover:bg-fg/12 flex h-12 w-12 items-center justify-center rounded-full transition-transform hover:scale-110"><ShareIcon size={20} /></button>
          </>
        }
      />
      <div className="mx-auto w-full max-w-[1680px] px-2 md:px-6">
        <TrackList tracks={data.tracks} context={{ type: "release", id, title: data.title }} />
        <footer className="flex flex-col gap-1 px-4 pb-6 pt-6 text-caption text-text-secondary">
          <span className="text-body font-semibold text-text-primary">{pluralTracks(data.track_count)} · {formatTotal(data.total_duration_ms)}</span>
          {data.release_date ? <span>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(data.release_date))}</span> : null}
          {data.genres?.length ? (
            <span>
              {data.genres.map((g, i) => (
                <span key={g.id}>{i ? ", " : ""}<Link href={`/genre/${g.slug}`} className="hover:text-text-primary hover:underline">{g.name}</Link></span>
              ))}
            </span>
          ) : null}
          {data.label ? <span className="text-text-tertiary">℗ {data.label}</span> : null}
        </footer>
      </div>
    </div>
  );
}
