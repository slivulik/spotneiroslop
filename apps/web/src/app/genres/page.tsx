"use client";

import { GenreTile } from "@/components/home/Blocks";
import { Skeleton } from "@/components/Page";
import { SpotlightZone } from "@/components/visual/Spotlight";
import { useGenres } from "@/lib/queries";

export default function GenresPage() {
  const genres = useGenres();
  return (
    <div className="mx-auto max-w-[1680px] px-4 md:px-8">
      <h1 className="mb-8 font-display text-display-l">Жанры и настроения</h1>
      <SpotlightZone className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {genres.data
          ? genres.data.items.map((g, i) => <GenreTile key={g.id} genre={g} index={i} />)
          : Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="aspect-[16/10] rounded-3xl" />)}
      </SpotlightZone>
    </div>
  );
}
