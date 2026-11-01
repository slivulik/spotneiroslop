"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { Suspense, useState } from "react";
import { ArtistCard } from "@/components/ArtistCard";
import { GenreTile, PlaylistCard, ReleaseCard } from "@/components/home/Blocks";
import { CloseIcon } from "@/components/icons";
import { Skeleton } from "@/components/Page";
import { TrackList } from "@/components/TrackList";
import { SpotlightZone } from "@/components/visual/Spotlight";
import { api } from "@/lib/api";
import { useGenres, usePopularSearches, useRecordSearch, useSearch, useSearchHistory } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";

const TABS = [
  { key: "all", label: "Всё" },
  { key: "tracks", label: "Треки" },
  { key: "artists", label: "Артисты" },
  { key: "albums", label: "Альбомы" },
  { key: "singles", label: "Синглы" },
  { key: "genres", label: "Жанры" },
  { key: "playlists", label: "Плейлисты" },
] as const;
type Tab = (typeof TABS)[number]["key"];
type Sort = "relevance" | "new" | "popular";

function Chip({ children, onClick, onRemove }: { children: React.ReactNode; onClick: () => void; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border-default bg-fg/4 text-caption font-semibold transition-colors hover:border-border-strong">
      <button type="button" onClick={onClick} className="px-3.5 py-1.5">{children}</button>
      {onRemove ? <button type="button" aria-label="Удалить из истории" onClick={onRemove} className="pr-2.5 text-text-tertiary hover:text-text-primary"><CloseIcon size={13} /></button> : null}
    </span>
  );
}

/** No query: recent and popular searches, then the genre grid. */
function Browse() {
  const router = useRouter();
  const history = useSearchHistory();
  const popular = usePopularSearches();
  const genres = useGenres();
  const client = useQueryClient();
  const record = useRecordSearch();
  const open = (q: string) => {
    record(q);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };
  return (
    <div className="flex flex-col gap-10">
      {history.data?.queries.length ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-title-3">Недавние запросы</h2>
            <button type="button" onClick={() => void api.DELETE("/v1/me/search-history").then(() => client.invalidateQueries({ queryKey: ["search-history"] }))} className="text-caption font-semibold text-text-secondary hover:text-text-primary">
              Очистить
            </button>
          </div>
          <div className="flex flex-wrap gap-2">{history.data.queries.map((q) => <Chip key={q} onClick={() => open(q)}>{q}</Chip>)}</div>
        </section>
      ) : null}
      {popular.data?.queries.length ? (
        <section>
          <h2 className="mb-3 font-display text-title-3">{popular.data.source === "searches" ? "Часто ищут" : "Сейчас слушают"}</h2>
          <div className="flex flex-wrap gap-2">{popular.data.queries.map((q) => <Chip key={q} onClick={() => open(q)}>{q}</Chip>)}</div>
        </section>
      ) : null}
      <section>
        <h2 className="mb-4 font-display text-title-2">Жанры и настроения</h2>
        <SpotlightZone className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {genres.data
            ? genres.data.items.map((g, i) => <GenreTile key={g.id} genre={g} index={i} />)
            : Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="aspect-[16/10] rounded-xl" />)}
        </SpotlightZone>
        {genres.data?.items.length === 0 ? <p className="text-body text-text-secondary">Жанры появятся, когда их добавят в панели управления.</p> : null}
      </section>
    </div>
  );
}

function Results({ q }: { q: string }) {
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("relevance");
  const full = tab !== "all";
  const results = useSearch(q, sort, full ? 30 : 12);
  const data = results.data;
  if (results.isError) {
    return (
      <div className="rounded-xl border border-border-default p-6">
        <p className="text-body-l">Поиск сейчас недоступен.</p>
        <button type="button" onClick={() => void results.refetch()} className="mt-3 rounded-full bg-fg/8 px-4 py-2 text-caption font-bold hover:bg-fg/12">Повторить</button>
      </div>
    );
  }
  const albums = data?.releases.filter((r) => r.type !== "single") ?? [];
  const singles = data?.releases.filter((r) => r.type === "single") ?? [];
  const genres = data?.genres ?? [];
  const counts: Record<Tab, number> = {
    all: 0,
    tracks: data?.tracks.length ?? 0,
    artists: data?.artists.length ?? 0,
    albums: albums.length,
    singles: singles.length,
    genres: genres.length,
    playlists: data?.playlists.length ?? 0,
  };
  const empty = data && Object.entries(counts).every(([k, n]) => k === "all" || n === 0);
  const show = (t: Tab) => (tab === "all" || tab === t) && counts[t] > 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Тип результатов" className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              disabled={t.key !== "all" && data !== undefined && counts[t.key] === 0}
              onClick={() => setTab(t.key)}
              className={`relative rounded-full px-3.5 py-1.5 text-caption font-semibold transition-colors disabled:opacity-35 ${tab === t.key ? "text-accent-on" : "bg-fg/5 text-text-secondary hover:text-text-primary"}`}
            >
              {tab === t.key ? <motion.span layoutId="search-tab" className="absolute inset-0 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
              <span className="relative">{t.label}{t.key !== "all" && data ? ` ${counts[t.key]}` : ""}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-caption text-text-secondary">
          Сортировка
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-md border border-border-default bg-bg-elevated px-2.5 py-1.5 text-caption text-text-primary">
            <option value="relevance">По совпадению</option>
            <option value="popular">Популярные</option>
            <option value="new">Новые</option>
          </select>
        </label>
      </div>
      {!data ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : empty ? (
        <div className="py-10 text-center">
          <p className="font-display text-title-2">Ничего не нашлось</p>
          <p className="mt-2 text-body text-text-secondary">По запросу «{q}» нет совпадений. Проверьте написание или попробуйте имя артиста.</p>
        </div>
      ) : (
        <div className={`flex flex-col gap-10 transition-opacity ${results.isFetching ? "opacity-60" : ""}`}>
          {show("artists") ? (
            <section>
              <h2 className="mb-3 font-display text-title-3">Артисты</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {data.artists.slice(0, full ? 30 : 6).map((a) => <ArtistCard key={a.id} artist={a} />)}
              </div>
            </section>
          ) : null}
          {show("tracks") ? (
            <section>
              <h2 className="mb-3 font-display text-title-3">Треки</h2>
              <TrackList tracks={full ? data.tracks : data.tracks.slice(0, 6)} context={{ type: "tracks", id: null, title: `Поиск: ${q}` }} variant="popular" />
            </section>
          ) : null}
          {(["albums", "singles"] as const).map((k) =>
            show(k) ? (
              <section key={k}>
                <h2 className="mb-3 font-display text-title-3">{k === "albums" ? "Альбомы" : "Синглы"}</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">
                  {(k === "albums" ? albums : singles).slice(0, full ? 30 : 6).map((r) => <ReleaseCard key={r.id} release={r} />)}
                </div>
              </section>
            ) : null,
          )}
          {show("genres") ? (
            <section>
              <h2 className="mb-3 font-display text-title-3">Жанры</h2>
              <SpotlightZone className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{genres.map((g, i) => <GenreTile key={g.id} genre={g} index={i} />)}</SpotlightZone>
            </section>
          ) : null}
          {show("playlists") ? (
            <section>
              <h2 className="mb-3 font-display text-title-3">Плейлисты</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">{data.playlists.map((p) => <PlaylistCard key={p.id} playlist={p} />)}</div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SearchContent() {
  const q = (useSearchParams().get("q") ?? "").trim();
  return (
    <>
      <h1 className="mb-6 font-display text-display-l">{q ? `«${q}»` : "Поиск"}</h1>
      {q ? <Results key={q} q={q} /> : <Browse />}
    </>
  );
}

export default function SearchPage() {
  return (
    <div className="mx-auto max-w-[1680px] px-4 md:px-8">
      <Suspense>
        <SearchContent />
      </Suspense>
    </div>
  );
}
