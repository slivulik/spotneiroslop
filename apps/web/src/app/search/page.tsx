"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Artwork } from "@/components/Artwork";
import { PlaylistCard, ReleaseCard } from "@/components/home/Blocks";
import { ShelfSection } from "@/components/home/Section";
import { DiscIcon, MicIcon, SparkIcon } from "@/components/icons";
import { TrackList } from "@/components/TrackList";
import { useSearch } from "@/lib/queries";

function Results() {
  const q = (useSearchParams().get("q") ?? "").trim();
  const results = useSearch(q);
  const data = results.data;
  if (!q) return <p className="text-body-l text-text-secondary">Начните вводить запрос в строке поиска.</p>;
  if (!data) return <p className="text-text-secondary">Ищем…</p>;
  const empty = !data.tracks.length && !data.releases.length && !data.artists.length && !data.playlists.length;
  if (empty) return <p className="text-body-l text-text-secondary">По запросу «{q}» ничего не нашлось.</p>;
  return (
    <div className="flex flex-col gap-10">
      {data.artists.length ? (
        <ShelfSection title="Артисты" icon={<MicIcon size={18} />} index={0} itemWidth="150px">
          {data.artists.map((a) => (
            <Link key={a.id} href={`/artist/${a.id}`} className="group flex flex-col items-center gap-2 p-2">
              <Artwork artwork={a.artwork} alt={a.name} sizes="140px" seed={a.name} className="aspect-square w-full rounded-full transition-transform group-hover:scale-105" />
              <span className="truncate text-body font-bold">{a.name}</span>
            </Link>
          ))}
        </ShelfSection>
      ) : null}
      {data.tracks.length ? (
        <section>
          <h2 className="mb-3 px-2 font-display text-title-2">Треки</h2>
          <TrackList tracks={data.tracks} context={{ type: "tracks", id: null, title: `Поиск: ${q}` }} variant="popular" />
        </section>
      ) : null}
      {data.releases.length ? (
        <ShelfSection title="Альбомы и синглы" icon={<DiscIcon size={18} />} index={1} itemWidth="clamp(150px, 17vw, 210px)">
          {data.releases.map((r) => <ReleaseCard key={r.id} release={r} />)}
        </ShelfSection>
      ) : null}
      {data.playlists.length ? (
        <ShelfSection title="Плейлисты" icon={<SparkIcon size={18} />} index={2} itemWidth="clamp(160px, 18vw, 230px)">
          {data.playlists.map((p) => <PlaylistCard key={p.id} playlist={p} />)}
        </ShelfSection>
      ) : null}
    </div>
  );
}

export default function SearchPage() {
  return (
    <div className="mx-auto max-w-[1680px] px-4 md:px-8">
      <h1 className="mb-8 font-display text-display-l">Поиск</h1>
      <Suspense>
        <Results />
      </Suspense>
    </div>
  );
}
