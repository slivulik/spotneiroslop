"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { use, useState } from "react";
import { ArtistCard } from "@/components/ArtistCard";
import { Artwork } from "@/components/Artwork";
import { ReleaseCard } from "@/components/home/Blocks";
import { SectionHeader } from "@/components/home/Section";
import { PauseIcon, PlayIcon, RadioIcon, ShareIcon, ShuffleIcon } from "@/components/icons";
import { LikeButton } from "@/components/LikeButton";
import { PageError, Skeleton } from "@/components/Page";
import { useIsPlaying } from "@/components/player/hooks";
import { TrackList } from "@/components/TrackList";
import { playTracks } from "@/lib/play";
import { useArtist, useArtistReleases, useArtistTopTracks } from "@/lib/queries";
import { playRadio, useArtistStats, useSimilarArtists } from "@/lib/recommend";
import { toast } from "@/components/admin/ui";
import { share } from "@/lib/share";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

const nf = new Intl.NumberFormat("ru-RU");

/** 12 weeks of counted plays, single series with hover readout and a table for screen readers. */
function Trend({ weeks }: { weeks: { week: string; plays: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.plays));
  const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
  return (
    <div>
      <div className="flex h-24 items-end gap-1" onMouseLeave={() => setHover(null)}>
        {weeks.map((w, i) => (
          <div key={w.week} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <div className={`w-full rounded-t-[3px] transition-colors ${w.plays ? (hover === i ? "bg-accent-hover" : "bg-accent") : "bg-fg/10"}`} style={{ height: `${Math.max(3, (w.plays / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-micro text-text-tertiary">
        <span>{fmt.format(new Date(weeks[0]!.week))}</span>
        <span aria-live="polite" className="text-text-primary">{hover !== null ? `Неделя с ${fmt.format(new Date(weeks[hover]!.week))}: ${weeks[hover]!.plays}` : "Прослушивания по неделям"}</span>
        <span>сейчас</span>
      </div>
      <table className="sr-only"><caption>Прослушивания по неделям</caption><tbody>{weeks.map((w) => <tr key={w.week}><td>{w.week}</td><td>{w.plays}</td></tr>)}</tbody></table>
    </div>
  );
}

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const artist = useArtist(id);
  const top = useArtistTopTracks(id);
  const releases = useArtistReleases(id);
  const stats = useArtistStats(id).data;
  const similar = useSimilarArtists(id).data ?? [];
  const isThis = usePlayer((s) => s.context?.type === "artist" && s.context.id === id);
  const playing = useIsPlaying();
  const [bioOpen, setBioOpen] = useState(false);
  if (artist.isError) return <PageError message="Артист не найден" />;
  const data = artist.data;
  if (!data) return <div className="p-8"><Skeleton className="h-80 w-full rounded-2xl" /></div>;
  const tracks = top.data?.items ?? [];
  const all = releases.data?.items ?? [];
  const latest = [...all].sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""))[0];
  const albums = all.filter((r) => r.type === "album" || r.type === "compilation");
  const singles = all.filter((r) => r.type === "single" || r.type === "ep");
  const context = { type: "artist" as const, id, title: data.name };
  const tint = data.palette?.vibrant ?? data.artwork?.palette?.vibrant ?? "var(--sonora-color-accent-default)";
  return (
    <div className="mx-auto flex max-w-[1680px] flex-col gap-10 px-4 md:px-8">
      {/* Hero: the photo is the page — edge to edge, the name set large over a scrim. */}
      <header className="relative min-h-[360px] overflow-hidden rounded-2xl md:min-h-[440px]">
        <div className="absolute inset-0" style={{ background: `radial-gradient(120% 120% at 0% 100%, ${tint}, #0b0a10 70%)` }} />
        {data.artwork ? (
          <motion.div initial={{ scale: 1.08, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 1, ease: [0.2, 0, 0, 1] }} className="absolute inset-0">
            <Artwork artwork={data.artwork} alt={data.name} sizes="100vw" priority className="h-full w-full" />
          </motion.div>
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/5" />
        {data.photo_credit ? <a href={data.photo_credit} target="_blank" rel="noreferrer" className="absolute right-4 top-4 rounded-full bg-black/40 px-2.5 py-1 text-micro text-white/75 hover:text-white md:right-6 md:top-6">Фото: Wikimedia Commons</a> : null}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-6 text-white md:p-10">
          {data.verified ? <span className="mono-label text-white/80">✓ Подтверждённый артист</span> : <span className="mono-label text-white/70">Артист</span>}
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 24, delay: 0.1 }} className="font-display text-display-l leading-[0.95] md:text-[clamp(56px,7vw,96px)]">
            {data.name}
          </motion.h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-white/85">
            <span>{nf.format(stats?.monthly_listeners ?? data.monthly_listeners)} слушателей за месяц</span>
            {stats?.genres.length ? (
              <span className="flex flex-wrap gap-1.5">
                {stats.genres.slice(0, 3).map((g) => <Link key={g.id} href={`/genre/${g.slug}`} className="rounded-full bg-black/35 px-2.5 py-0.5 text-caption font-semibold hover:bg-white/25">{g.name}</Link>)}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" data-ripple disabled={!tracks.length} aria-label={isThis && playing ? "Пауза" : "Слушать"} onClick={() => (isThis ? player.toggle() : playTracks(tracks, null, context))} className="btn-accent flex h-14 w-14 items-center justify-center rounded-full transition-transform hover:scale-105 disabled:opacity-40">
              {isThis && playing ? <PauseIcon size={24} /> : <PlayIcon size={24} style={{ marginLeft: 3 }} />}
            </button>
            <button type="button" disabled={!tracks.length} aria-label="Перемешать" onClick={() => playTracks(tracks, null, context, { shuffle: true })} className="flex h-12 w-12 items-center justify-center rounded-full bg-black/35 transition-transform hover:scale-110 disabled:opacity-40"><ShuffleIcon size={20} /></button>
            <button type="button" aria-label={`Радио: ${data.name}`} onClick={() => void playRadio({ artistId: id, title: data.name }).then((ok) => { if (!ok) toast("Не нашлось похожих треков"); })} className="flex h-12 items-center gap-2 rounded-full bg-black/35 px-4 text-caption font-bold transition-transform hover:scale-105"><RadioIcon size={18} /> Радио</button>
            <span className="rounded-full bg-white/15"><LikeButton kind="artists" id={id} size={22} className="h-12 w-12 text-white" /></span>
            <button type="button" aria-label="Поделиться" onClick={() => void share(`/artist/${id}`, data.name)} className="flex h-12 w-12 items-center justify-center rounded-full bg-black/35 transition-transform hover:scale-110"><ShareIcon size={20} /></button>
          </div>
        </div>
      </header>

      <div className="@container">
      <div className="grid gap-8 @4xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-10">
          {tracks.length ? (
            <section>
              <SectionHeader title="Популярные треки" index={0} />
              <TrackList tracks={tracks.slice(0, 10)} context={context} variant="popular" />
            </section>
          ) : null}
          {albums.length ? (
            <section>
              <SectionHeader title="Альбомы" index={1} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{albums.map((r) => <ReleaseCard key={r.id} release={r} />)}</div>
            </section>
          ) : null}
          {singles.length ? (
            <section>
              <SectionHeader title="Синглы и EP" index={2} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{singles.map((r) => <ReleaseCard key={r.id} release={r} />)}</div>
            </section>
          ) : null}
        </div>
        <aside className="flex flex-col gap-5">
          {latest ? (
            <Link href={`/album/${latest.id}`} className="liquid group flex gap-4 rounded-xl p-4 transition-transform hover:-translate-y-0.5">
              <Artwork artwork={latest.artwork} alt="" sizes="96px" className="h-24 w-24 shrink-0 rounded-md shadow-md" />
              <span className="min-w-0">
                <span className="mono-label block text-accent">Новый релиз</span>
                <span className="mt-1 block truncate font-display text-title-3">{latest.title}</span>
                <span className="block text-caption text-text-secondary">{latest.release_date ? new Date(latest.release_date).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : ""}</span>
              </span>
            </Link>
          ) : null}
          {stats ? (
            <section className="liquid rounded-xl p-5">
              <h2 className="mb-3 font-display text-title-3">Статистика</h2>
              <dl className="mb-4 grid grid-cols-2 gap-2">
                <div className="rounded-md bg-fg/4 p-3"><dt className="text-micro text-text-tertiary">За 30 дней</dt><dd className="font-display text-title-3 tabular-nums">{nf.format(stats.plays_30d)}</dd></div>
                <div className="rounded-md bg-fg/4 p-3"><dt className="text-micro text-text-tertiary">Всего прослушиваний</dt><dd className="font-display text-title-3 tabular-nums">{nf.format(stats.total_plays)}</dd></div>
                <div className="rounded-md bg-fg/4 p-3"><dt className="text-micro text-text-tertiary">Слушателей за месяц</dt><dd className="font-display text-title-3 tabular-nums">{nf.format(stats.monthly_listeners)}</dd></div>
                <div className="rounded-md bg-fg/4 p-3"><dt className="text-micro text-text-tertiary">Первый релиз</dt><dd className="font-display text-title-3 tabular-nums">{stats.first_release ? new Date(stats.first_release).getFullYear() : "—"}</dd></div>
              </dl>
              <Trend weeks={stats.weekly} />
              <p className="mt-3 text-micro text-text-tertiary">По данным Sonora: засчитываются прослушивания дольше 30 секунд.</p>
            </section>
          ) : null}
          {data.bio ? (
            <section className="liquid rounded-xl p-5">
              <h2 className="mb-2 font-display text-title-3">Об артисте</h2>
              <p className={`selectable whitespace-pre-line text-body text-text-secondary ${bioOpen ? "" : "line-clamp-6"}`}>{data.bio}</p>
              {data.bio.length > 320 ? <button type="button" onClick={() => setBioOpen((v) => !v)} className="mt-2 text-caption font-bold text-text-primary hover:underline">{bioOpen ? "Свернуть" : "Читать полностью"}</button> : null}
              {data.bio_source ? <p className="mt-3 text-micro text-text-tertiary">Источник: <a href={data.bio_source} target="_blank" rel="noreferrer" className="underline hover:text-text-secondary">Википедия</a>, CC BY-SA</p> : null}
            </section>
          ) : null}
        </aside>
      </div>
      </div>

      {similar.length ? (
        <section>
          <SectionHeader title="Похожие артисты" subtitle="Их слушают те же люди" index={3} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{similar.slice(0, 6).map((a) => <ArtistCard key={a.id} artist={a} />)}</div>
        </section>
      ) : null}
    </div>
  );
}
