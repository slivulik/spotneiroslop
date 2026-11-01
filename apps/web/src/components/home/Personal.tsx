"use client";

import type { components } from "@sonora/api-schema";
import Link from "next/link";
import { motion } from "motion/react";
import { ArtistCard } from "@/components/ArtistCard";
import { Artwork } from "@/components/Artwork";
import { PlaylistCard } from "@/components/home/Blocks";
import { SectionHeader } from "@/components/home/Section";
import { PauseIcon, PlayIcon } from "@/components/icons";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { Oscilloscope } from "@/components/visual/Sonic";
import { useMyPlaylists } from "@/lib/library";
import { playTracks } from "@/lib/play";
import { playWave, useMixes, useRecent, useTopArtists } from "@/lib/recommend";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

type Mix = components["schemas"]["MixSummary"];

/** The front door of personal listening: one tap starts an endless stream shaped by your taste. */
export function WaveCard() {
  const isWave = usePlayer((s) => s.context?.type === "wave");
  const playing = useIsPlaying();
  return (
    <div className="relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-2xl p-6 text-white md:p-8" style={{ background: "radial-gradient(120% 140% at 0% 0%, var(--sonora-color-accent-hover), var(--sonora-color-accent-pressed) 45%, #120e24 100%)" }}>
      <div className="pointer-events-none absolute inset-x-0 bottom-6 opacity-80"><Oscilloscope height={70} /></div>
      <div className="relative">
        <span className="mono-label text-white/75">Персональный поток</span>
        <h2 className="mt-1 font-display text-display-l leading-none">Моя волна</h2>
        <p className="mt-2 max-w-sm text-body text-white/80">Бесконечная музыка под ваш вкус: любимое, похожее и новое, без повторов.</p>
      </div>
      <button
        type="button"
        data-ripple
        onClick={() => (isWave ? player.toggle() : void playWave())}
        className="relative mt-4 flex w-fit items-center gap-2 rounded-full bg-white px-6 py-3 text-body font-bold text-[#1b1238] shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        {isWave && playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />} {isWave ? (playing ? "Пауза" : "Продолжить") : "Слушать"}
      </button>
    </div>
  );
}

/** Recently played, two columns of quick tiles (resume where you left off). */
export function ContinueListening() {
  const recent = useRecent();
  const current = useCurrentTrack();
  const playing = useIsPlaying();
  const tracks = recent.data?.items.slice(0, 6) ?? [];
  if (!tracks.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="mono-label px-1 text-text-tertiary">Продолжить слушать</span>
      <div className="grid gap-2 sm:grid-cols-2">
        {tracks.map((t) => {
          const isCurrent = current?.id === t.id;
          return (
            <button key={t.id} type="button" onClick={() => (isCurrent ? player.toggle() : playTracks(tracks, t.id, { type: "tracks", id: null, title: "Недавнее" }))} className="group flex items-center gap-3 overflow-hidden rounded-lg bg-fg/5 pr-3 text-left transition-colors hover:bg-fg/9">
              <Artwork artwork={t.release.artwork} alt="" sizes="56px" className="h-14 w-14 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-caption font-bold ${isCurrent ? "text-accent" : ""}`}>{t.title}</span>
                <span className="block truncate text-micro text-text-secondary">{t.artists.map((a) => a.name).join(", ")}</span>
              </span>
              <span className={`btn-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-opacity ${isCurrent && playing ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                {isCurrent && playing ? <PauseIcon size={14} /> : <PlayIcon size={14} style={{ marginLeft: 1 }} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MixCover({ mix }: { mix: Mix }) {
  const covers = mix.mosaic.slice(0, 4);
  return (
    <div className="relative aspect-square overflow-hidden rounded-lg bg-bg-raised">
      <div className="grid h-full w-full grid-cols-2 grid-rows-2">
        {covers.map((c, i) => <Artwork key={i} artwork={c} alt="" sizes="120px" className="h-full w-full" />)}
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      <span className="absolute bottom-3 left-3 right-3 font-display text-title-3 font-bold leading-tight text-white drop-shadow">{mix.title}</span>
    </div>
  );
}

export function MixesShelf({ index }: { index: number }) {
  const mixes = useMixes();
  if (!mixes.data?.length) return null;
  return (
    <section>
      <SectionHeader title="Миксы дня" subtitle="Обновляются каждый день по вашей истории" index={index} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {mixes.data.map((m, i) => (
          <motion.div key={m.key} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}>
            <Link href={`/mix/${encodeURIComponent(m.key)}`} className="group block">
              <div className="transition-transform duration-300 group-hover:-translate-y-1"><MixCover mix={m} /></div>
              <p className="mt-2 line-clamp-2 px-0.5 text-caption text-text-secondary">{m.subtitle} · {m.track_count} тр.</p>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export function FavoriteArtists({ index }: { index: number }) {
  const artists = useTopArtists();
  if (!artists.data?.length) return null;
  return (
    <section>
      <SectionHeader title="Ваши артисты" subtitle="Кого вы слушаете чаще всего" index={index} href="/library" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {artists.data.slice(0, 6).map((a) => <ArtistCard key={a.id} artist={a} />)}
      </div>
    </section>
  );
}

export function YourPlaylists({ index }: { index: number }) {
  const playlists = useMyPlaylists();
  const own = playlists.data?.slice(0, 6) ?? [];
  if (!own.length) return null;
  return (
    <section>
      <SectionHeader title="Ваши плейлисты" index={index} href="/library" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{own.map((p) => <PlaylistCard key={p.id} playlist={p} />)}</div>
    </section>
  );
}

export { MixCover };
