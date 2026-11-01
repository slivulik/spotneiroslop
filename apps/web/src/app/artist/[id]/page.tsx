"use client";

import { motion } from "motion/react";
import { use } from "react";
import { Artwork } from "@/components/Artwork";
import { ReleaseCard } from "@/components/home/Blocks";
import { ShelfSection } from "@/components/home/Section";
import { DiscIcon, PlayIcon } from "@/components/icons";
import { PageError, Skeleton } from "@/components/Page";
import { TrackList } from "@/components/TrackList";
import { Reveal } from "@/components/visual/Reveal";
import { playTracks } from "@/lib/play";
import { useArtist, useArtistReleases, useArtistTopTracks } from "@/lib/queries";

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const artist = useArtist(id);
  const top = useArtistTopTracks(id);
  const releases = useArtistReleases(id);
  if (artist.isError) return <PageError message="Артист не найден" />;
  const data = artist.data;
  if (!data) return <div className="p-8"><Skeleton className="h-72 w-full rounded-[36px]" /></div>;
  const tint = data.palette?.vibrant ?? data.artwork?.palette?.vibrant ?? "var(--bg-c1)";
  return (
    <div className="mx-auto flex max-w-[1680px] flex-col gap-10 px-4 md:px-8">
      <header className="relative overflow-hidden rounded-[36px]">
        <div className="absolute inset-0 -z-10" style={{ background: `radial-gradient(120% 140% at 0% 100%, ${tint}, transparent 60%)` }} />
        {data.artwork ? (
          <div className="absolute inset-0 -z-10 opacity-40 blur-2xl saturate-150">
            <Artwork artwork={data.artwork} alt="" sizes="300px" className="h-full w-full" />
          </div>
        ) : null}
        <div className="liquid flex flex-col items-center gap-6 p-8 md:flex-row md:items-end md:p-12">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 180, damping: 18 }}>
            <Artwork artwork={data.artwork} alt={data.name} seed={data.name} sizes="220px" className="aspect-square w-44 rounded-full shadow-artwork md:w-56" priority />
          </motion.div>
          <div className="flex flex-col items-center gap-3 md:items-start">
            {data.verified ? <span className="liquid liquid-pill px-3 py-1 text-micro uppercase">✓ Подтверждённый артист</span> : null}
            <h1 className="font-display text-display-l leading-none md:text-display-xl">{data.name}</h1>
            {data.monthly_listeners > 0 ? <p className="text-body text-text-primary/80">{data.monthly_listeners.toLocaleString("ru-RU")} слушателей за месяц</p> : null}
            {top.data?.items.length ? (
              <button type="button" onClick={() => playTracks(top.data.items, null, { type: "artist", id, title: data.name })} className="mt-2 flex items-center gap-2 rounded-full bg-white px-6 py-3 text-body font-bold text-black transition-transform hover:scale-105">
                <PlayIcon size={18} /> Слушать
              </button>
            ) : null}
          </div>
        </div>
      </header>
      {top.data?.items.length ? (
        <Reveal>
          <section>
            <h2 className="mb-3 px-2 font-display text-title-2">Популярное</h2>
            <TrackList tracks={top.data.items} context={{ type: "artist", id, title: data.name }} variant="popular" />
          </section>
        </Reveal>
      ) : null}
      {releases.data?.items.length ? (
        <ShelfSection title="Дискография" icon={<DiscIcon size={18} />} index={1} itemWidth="clamp(150px, 17vw, 210px)">
          {releases.data.items.map((r) => <ReleaseCard key={r.id} release={r} />)}
        </ShelfSection>
      ) : null}
      {data.bio ? (
        <Reveal>
          <section className="liquid max-w-3xl rounded-[28px] p-6">
            <h2 className="mb-3 font-display text-title-2">Об артисте</h2>
            <p className="whitespace-pre-line text-body-l text-text-secondary">{data.bio}</p>
          </section>
        </Reveal>
      ) : null}
    </div>
  );
}
