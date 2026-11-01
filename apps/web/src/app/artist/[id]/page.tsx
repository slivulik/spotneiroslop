"use client";

import { use } from "react";
import { Artwork } from "@/components/Artwork";
import { PageError, Skeleton, TintedHeader } from "@/components/Page";
import { ReleaseCard, ReleaseGrid } from "@/components/ReleaseCard";
import { TrackList } from "@/components/TrackList";
import { useArtist, useArtistReleases, useArtistTopTracks } from "@/lib/queries";

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const artist = useArtist(id);
  const top = useArtistTopTracks(id);
  const releases = useArtistReleases(id);

  if (artist.isError) return <PageError message="Артист не найден" />;
  const data = artist.data;

  return (
    <div>
      <TintedHeader palette={data?.palette}>
        <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-6 px-4 pb-10 pt-12 md:flex-row md:items-end md:px-8 md:pt-20">
          {data?.artwork ? (
            <Artwork artwork={data.artwork} alt={data.name} sizes="200px" className="aspect-square w-44 shrink-0 rounded-full shadow-artwork md:w-52" priority />
          ) : null}
          <div className="text-center md:text-left">
            {data ? (
              <>
                {data.verified ? <span className="text-micro uppercase text-text-primary/70">Подтверждённый артист</span> : null}
                <h1 className="font-display text-display-l leading-none md:text-display-xl">{data.name}</h1>
                {data.monthly_listeners > 0 ? (
                  <p className="mt-3 text-body text-text-primary/80">{data.monthly_listeners.toLocaleString("ru-RU")} слушателей за месяц</p>
                ) : null}
              </>
            ) : (
              <Skeleton className="h-14 w-72" />
            )}
          </div>
        </div>
      </TintedHeader>

      <div className="mx-auto flex max-w-[1600px] flex-col gap-12 px-2 py-6 md:px-6">
        {top.data && top.data.items.length > 0 ? (
          <section>
            <h2 className="mb-3 px-4 font-display text-title-2">Популярное</h2>
            <TrackList tracks={top.data.items} context={{ type: "artist", id, title: data?.name ?? "Артист" }} variant="popular" />
          </section>
        ) : null}
        {releases.data && releases.data.items.length > 0 ? (
          <section>
            <h2 className="mb-3 px-2 font-display text-title-2">Дискография</h2>
            <ReleaseGrid>
              {releases.data.items.map((r) => (
                <ReleaseCard key={r.id} release={r} />
              ))}
            </ReleaseGrid>
          </section>
        ) : null}
        {data?.bio ? (
          <section className="max-w-3xl px-4">
            <h2 className="mb-3 font-display text-title-2">Об артисте</h2>
            <p className="whitespace-pre-line text-body-l text-text-secondary">{data.bio}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
