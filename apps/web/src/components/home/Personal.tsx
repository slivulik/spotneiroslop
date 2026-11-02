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
import { useMyPlaylists } from "@/lib/library";
import { playTracks } from "@/lib/play";
import { playWave, useMixes, useRecent, useTopArtists } from "@/lib/recommend";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

type Mix = components["schemas"]["MixSummary"];

/** The front door of personal listening: one calm row, one action. */
export function WaveCard() {
  const isWave = usePlayer((s) => s.context?.type === "wave");
  const playing = useIsPlaying();
  const active = isWave && playing;
  return (
    <button
      type="button"
      onClick={() => (isWave ? player.toggle() : void playWave())}
      aria-label={isWave && playing ? "Моя волна — пауза" : "Моя волна — слушать"}
      className="group relative flex h-[132px] w-full items-center justify-between overflow-hidden rounded-[20px] px-7 text-left text-white md:h-[150px] md:px-9"
      style={{ background: "linear-gradient(110deg, var(--sonora-color-accent-default), #3b2a9a 60%, #1b1340)" }}
    >
      <span className="min-w-0">
        <span className="block text-[26px] font-bold leading-tight tracking-[-0.02em] md:text-[30px]">Моя волна</span>
        <span className="mt-1.5 block text-body text-white/75">{isWave ? (playing ? "Играет — подбирается под вас" : "На паузе") : "Бесконечный поток под ваш вкус"}</span>
      </span>
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-[#1b1238] shadow-[0_10px_30px_-10px_rgba(0,0,0,.6)] transition-transform duration-200 group-hover:scale-105">
        {active ? <PauseIcon size={22} /> : <PlayIcon size={22} style={{ marginLeft: 3 }} />}
      </span>
    </button>
  );
}

/** Recently played as a quick grid (resume in one tap): 2 columns on phones, 3 on desktop. */
export function ContinueListening() {
  const recent = useRecent();
  const current = useCurrentTrack();
  const playing = useIsPlaying();
  const tracks = recent.data?.items.slice(0, 6) ?? [];
  if (!tracks.length) return null;
  return (
    <div role="group" aria-label="Продолжить слушать" className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
      {tracks.map((t) => {
        const isCurrent = current?.id === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => (isCurrent ? player.toggle() : playTracks(tracks, t.id, { type: "tracks", id: null, title: "Недавнее" }))}
            className="group flex h-14 items-center gap-3 overflow-hidden rounded-lg bg-fg/6 pr-3 text-left hover:bg-fg/10"
          >
            <Artwork artwork={t.release.artwork} alt="" sizes="56px" className="h-14 w-14 shrink-0" />
            <span className={`min-w-0 flex-1 truncate text-caption font-semibold ${isCurrent ? "text-accent" : ""}`}>{t.title}</span>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-on transition-opacity duration-150 ${isCurrent && playing ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
              {isCurrent && playing ? <PauseIcon size={14} /> : <PlayIcon size={14} style={{ marginLeft: 1 }} />}
            </span>
          </button>
        );
      })}
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
