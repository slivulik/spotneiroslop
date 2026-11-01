"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useState } from "react";
import { ArtistCard } from "@/components/ArtistCard";
import { Artwork } from "@/components/Artwork";
import { PlaylistCard, ReleaseCard } from "@/components/home/Blocks";
import { HeartIcon, PlayIcon, PlusIcon, ShuffleIcon } from "@/components/icons";
import { LikeButton } from "@/components/LikeButton";
import { Skeleton } from "@/components/Page";
import { TrackList } from "@/components/TrackList";
import { api } from "@/lib/api";
import { formatTotal } from "@/lib/format";
import { createPlaylist, useFollowedArtists, useHistory, useLikedReleases, useLikedTracks, useMyPlaylists, usePlaylistInvalidate } from "@/lib/library";
import { navigate } from "@/lib/navigation";
import { playTracks } from "@/lib/play";
import { useSession } from "@/lib/session";
import { useQueryClient } from "@tanstack/react-query";

const TABS = [
  { key: "playlists", label: "Плейлисты" },
  { key: "tracks", label: "Любимые треки" },
  { key: "albums", label: "Альбомы" },
  { key: "artists", label: "Артисты" },
  { key: "history", label: "История" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-default px-6 py-14 text-center">
      <p className="font-display text-title-3">{title}</p>
      <p className="max-w-md text-body text-text-secondary">{text}</p>
      {action}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">{children}</div>;
}

function Playlists() {
  const playlists = useMyPlaylists();
  const invalidate = usePlaylistInvalidate();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const p = await createPlaylist("Новый плейлист");
      invalidate();
      navigate(`/playlist/${p.id}`);
    } finally {
      setBusy(false);
    }
  };
  if (!playlists.data) return <Grid>{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-xl" />)}</Grid>;
  return (
    <Grid>
      <button type="button" disabled={busy} onClick={() => void create()} className="group flex aspect-square flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-strong text-text-secondary transition-colors hover:border-accent hover:text-text-primary">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-muted text-accent transition-transform group-hover:scale-110"><PlusIcon size={22} /></span>
        <span className="text-body font-semibold">Новый плейлист</span>
      </button>
      {playlists.data.map((p) => <PlaylistCard key={p.id} playlist={p} />)}
    </Grid>
  );
}

function LikedTracks() {
  const liked = useLikedTracks();
  if (!liked.data) return <div className="flex flex-col gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>;
  const tracks = liked.data.items;
  if (!tracks.length) return <Empty title="Пока пусто" text="Нажмите на сердечко рядом с треком — он появится здесь." />;
  const context = { type: "tracks" as const, id: null, title: "Любимые треки" };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-accent text-accent-on"><HeartIcon size={28} filled /></span>
        <div className="flex-1">
          <div className="font-display text-title-2">Любимые треки</div>
          <div className="text-caption text-text-secondary">{liked.data.total} · {formatTotal(tracks.reduce((n, t) => n + t.duration_ms, 0))}</div>
        </div>
        <button type="button" aria-label="Слушать по порядку" data-ripple onClick={() => playTracks(tracks, tracks.find((t) => t.playable)?.id ?? tracks[0]!.id, context)} className="btn-accent flex h-12 w-12 items-center justify-center rounded-full"><PlayIcon size={22} style={{ marginLeft: 2 }} /></button>
        <button type="button" aria-label="Перемешать" onClick={() => playTracks(tracks, tracks[Math.floor(Math.random() * tracks.length)]!.id, context, { shuffle: true })} className="flex h-12 w-12 items-center justify-center rounded-full border border-border-default text-text-secondary hover:text-text-primary"><ShuffleIcon size={20} /></button>
      </div>
      <TrackList tracks={tracks} context={context} variant="popular" />
    </div>
  );
}

function Albums() {
  const releases = useLikedReleases();
  if (!releases.data) return <Grid>{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-xl" />)}</Grid>;
  if (!releases.data.length) return <Empty title="Нет сохранённых альбомов" text="Откройте альбом или сингл и нажмите на сердечко в шапке." />;
  return <Grid>{releases.data.map((r) => <ReleaseCard key={r.id} release={r} />)}</Grid>;
}

function Artists() {
  const artists = useFollowedArtists();
  if (!artists.data) return <Grid>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-xl" />)}</Grid>;
  if (!artists.data.length) return <Empty title="Вы ни на кого не подписаны" text="Подпишитесь на артиста на его странице — новые релизы окажутся под рукой." />;
  return (
    <Grid>
      {artists.data.map((a) => <ArtistCard key={a.id} artist={a} />)}
    </Grid>
  );
}

function History() {
  const history = useHistory(100);
  const client = useQueryClient();
  if (!history.data) return <div className="flex flex-col gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>;
  const items = history.data.items;
  if (!items.length) return <Empty title="История пуста" text="Здесь появятся треки, которые вы слушали." />;
  const tracks = items.map((e) => e.track);
  const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Очистить историю прослушиваний?")) void api.DELETE("/v1/me/history").then(() => client.invalidateQueries({ queryKey: ["library", "history"] }));
          }}
          className="rounded-full bg-fg/6 px-4 py-2 text-caption font-semibold hover:bg-fg/10"
        >
          Очистить историю
        </button>
      </div>
      <ol className="flex flex-col">
        {items.map((e, i) => (
          <li key={`${e.track.id}-${e.played_at}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-fg/5">
            <button type="button" aria-label={`Слушать ${e.track.title}`} onClick={() => playTracks(tracks, e.track.id, { type: "tracks", id: null, title: "История" })} className="relative shrink-0">
              <Artwork artwork={e.track.release.artwork} alt="" sizes="48px" className="h-12 w-12 rounded-md" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body font-semibold">{e.track.title}</div>
              <div className="truncate text-caption text-text-secondary">{e.track.artists.map((a) => a.name).join(", ")}</div>
            </div>
            <time className="hidden text-caption tabular-nums text-text-tertiary sm:block" dateTime={e.played_at}>{fmt.format(new Date(e.played_at))}</time>
            <LikeButton kind="tracks" id={e.track.id} size={18} />
            <span className="sr-only">{i + 1}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function LibraryPage() {
  const status = useSession((s) => s.status);
  const [tab, setTab] = useState<Tab>("playlists");
  if (status === "anonymous") {
    return (
      <div className="mx-auto max-w-[1680px] px-4 md:px-8">
        <h1 className="mb-6 font-display text-display-l">Медиатека</h1>
        <Empty title="Войдите, чтобы собрать свою медиатеку" text="Любимые треки, альбомы, артисты и плейлисты синхронизируются между веб-версией и телефоном." action={<Link href="/login?next=/library" className="btn-accent mt-2 rounded-full px-6 py-2.5 text-body font-bold">Войти</Link>} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1680px] px-4 md:px-8">
      <h1 className="mb-6 font-display text-display-l">Медиатека</h1>
      <div role="tablist" aria-label="Разделы медиатеки" className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`relative rounded-full px-4 py-2 text-caption font-semibold transition-colors ${tab === t.key ? "text-accent-on" : "bg-fg/5 text-text-secondary hover:text-text-primary"}`}>
            {tab === t.key ? <motion.span layoutId="library-tab" className="absolute inset-0 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "playlists" ? <Playlists /> : tab === "tracks" ? <LikedTracks /> : tab === "albums" ? <Albums /> : tab === "artists" ? <Artists /> : <History />}
      </div>
    </div>
  );
}
