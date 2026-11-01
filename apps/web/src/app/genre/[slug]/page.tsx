"use client";

import { use } from "react";
import { ReleaseCard } from "@/components/home/Blocks";
import { ShelfSection } from "@/components/home/Section";
import { DiscIcon } from "@/components/icons";
import { PageError, Skeleton } from "@/components/Page";
import { TrackList } from "@/components/TrackList";
import { Reveal } from "@/components/visual/Reveal";
import { useGenre } from "@/lib/queries";

export default function GenrePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const genre = useGenre(slug);
  if (genre.isError) return <PageError message="Жанр не найден" />;
  const data = genre.data;
  if (!data) return <div className="p-8"><Skeleton className="h-64 w-full rounded-[36px]" /></div>;
  const color = data.genre.color ?? "#7C5CFF";
  return (
    <div className="mx-auto flex max-w-[1680px] flex-col gap-10 px-4 md:px-8">
      <Reveal>
        <header className="relative overflow-hidden rounded-[36px] p-8 md:p-14" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 35%, #07070a))` }}>
          <div className="noise absolute inset-0 opacity-20 mix-blend-overlay" />
          <span className="relative text-micro uppercase tracking-[0.2em] text-white/80">Жанр</span>
          <h1 className="relative mt-2 font-display text-display-l leading-none md:text-display-xl">{data.genre.name}</h1>
          {data.description ? <p className="relative mt-4 max-w-2xl text-body-l text-white/85">{data.description}</p> : null}
        </header>
      </Reveal>
      {data.tracks.length ? (
        <section>
          <h2 className="mb-3 px-2 font-display text-title-2">Популярное в жанре</h2>
          <TrackList tracks={data.tracks} context={{ type: "tracks", id: null, title: data.genre.name }} variant="popular" />
        </section>
      ) : null}
      {data.releases.length ? (
        <ShelfSection title="Релизы" icon={<DiscIcon size={18} />} index={1} itemWidth="clamp(150px, 17vw, 210px)">
          {data.releases.map((r) => <ReleaseCard key={r.id} release={r} />)}
        </ShelfSection>
      ) : null}
    </div>
  );
}
