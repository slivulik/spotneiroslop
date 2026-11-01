"use client";

import Link from "next/link";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Artwork } from "@/components/Artwork";
import { QualityBadge } from "@/components/Badges";
import { CloseIcon, GripIcon, InfoIcon, LyricsIcon, QueueIcon, TrashIcon } from "@/components/icons";
import { LikeButton } from "@/components/LikeButton";
import { useCurrentTrack } from "@/components/player/hooks";
import { TrackMenuButton } from "@/components/TrackMenu";
import { formatDuration, releaseTypeLabel } from "@/lib/format";
import { useLyrics, useRelease, useTrack } from "@/lib/queries";
import { player } from "@/player/controller";
import { type QueueTrack, queueView } from "@/player/queue";
import { usePlayer } from "@/player/store";

export type PanelKind = "lyrics" | "info" | "queue";

export const PANEL_META: Record<PanelKind, { title: string; icon: React.ReactNode }> = {
  lyrics: { title: "Текст", icon: <LyricsIcon size={18} /> },
  info: { title: "О треке", icon: <InfoIcon size={18} /> },
  queue: { title: "Очередь", icon: <QueueIcon size={18} /> },
};

/**
 * Lyrics bound to the playing track: keyed by track id so the previous song's text can never
 * linger; synced lines follow playback and seek on click; plain text stays selectable.
 */
export function LyricsPanel({ trackId, big = false }: { trackId: string; big?: boolean }) {
  const lyrics = useLyrics(trackId, true);
  const position = usePlayer((s) => s.positionMs);
  const list = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(0);
  const lines = lyrics.data?.lines ?? [];
  let active = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.start_ms <= position + 250) active = i;

  useEffect(() => {
    // Don't fight the user: pause auto-follow for 4 s after they scroll.
    if (Date.now() - userScrolled.current < 4000) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  if (lyrics.isPending) return <div className="flex flex-col gap-3 p-6">{[70, 90, 60, 80].map((w) => <div key={w} className="skeleton h-6 rounded-md" style={{ width: `${w}%` }} />)}</div>;
  if (lyrics.isError || !lyrics.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <LyricsIcon size={28} className="text-text-tertiary" />
        <p className="text-body text-text-secondary">У этого трека пока нет текста</p>
      </div>
    );
  }
  if (lyrics.data.type === "static") {
    return <div className={`selectable h-full overflow-auto whitespace-pre-line p-6 leading-relaxed text-text-primary/90 ${big ? "font-display text-title-3" : "text-body-l"}`}>{lyrics.data.text}</div>;
  }
  return (
    <div
      ref={list}
      onWheel={() => (userScrolled.current = Date.now())}
      onTouchMove={() => (userScrolled.current = Date.now())}
      className="h-full overflow-auto px-6 py-[30%] [mask-image:linear-gradient(transparent,#000_15%,#000_85%,transparent)]"
    >
      {lines.map((line, i) => (
        <button
          key={`${line.start_ms}-${i}`}
          type="button"
          data-line={i}
          onClick={() => player.seek(line.start_ms)}
          className={`block w-full py-1.5 text-left font-display font-bold leading-tight transition-[opacity,transform,filter] duration-500 ease-standard ${big ? "text-[clamp(22px,2.6vw,34px)]" : "text-title-3"}`}
          style={{
            opacity: i === active ? 1 : i < active ? 0.32 : 0.5,
            filter: i === active ? "none" : `blur(${Math.min(Math.abs(i - active), 3) * 0.4}px)`,
            transform: i === active ? "scale(1.02)" : "scale(1)",
            transformOrigin: "left center",
          }}
        >
          {line.text || "♪"}
        </button>
      ))}
    </div>
  );
}

/** About the playing track: artwork, credits, release facts, actions. */
export function InfoPanel({ trackId }: { trackId: string }) {
  const track = useTrack(trackId).data;
  const release = useRelease(track?.release.id ?? "").data;
  if (!track) return <div className="p-5"><div className="skeleton aspect-square w-full rounded-lg" /></div>;
  const facts = [
    release ? releaseTypeLabel(release.type) : null,
    release?.release_date ? new Date(release.release_date).getFullYear() : null,
    release?.genres?.map((g) => g.name).slice(0, 2).join(", ") || null,
  ].filter(Boolean);
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-5">
      <Artwork artwork={track.release.artwork} alt={track.release.title} sizes="360px" className="aspect-square w-full rounded-lg shadow-artwork" />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-title-3 leading-tight">{track.title}{track.version ? <span className="text-text-secondary"> ({track.version})</span> : null}</h3>
          <div className="mt-1 text-body text-text-secondary">
            {track.artists.map((a, i) => (
              <span key={a.id}>{i ? ", " : ""}<Link href={`/artist/${a.id}`} className="hover:text-text-primary hover:underline">{a.name}</Link></span>
            ))}
          </div>
        </div>
        <LikeButton kind="tracks" id={track.id} size={22} />
        <TrackMenuButton track={track} context={{ type: "tracks", id: null, title: track.title }} />
      </div>
      <Link href={`/album/${track.release.id}`} className="flex items-center gap-3 rounded-lg bg-fg/5 p-3 transition-colors hover:bg-fg/8">
        <Artwork artwork={track.release.artwork} alt="" sizes="48px" className="h-12 w-12 rounded-md" />
        <span className="min-w-0">
          <span className="block truncate text-body font-semibold">{track.release.title}</span>
          <span className="block truncate text-caption text-text-secondary">{facts.join(" · ") || "Релиз"}</span>
        </span>
      </Link>
      <dl className="grid grid-cols-2 gap-2 text-caption">
        <div className="rounded-md bg-fg/4 p-2.5"><dt className="text-text-tertiary">Длительность</dt><dd className="font-semibold">{formatDuration(track.duration_ms)}</dd></div>
        <div className="rounded-md bg-fg/4 p-2.5"><dt className="text-text-tertiary">Качество</dt><dd className="font-semibold"><QualityBadge hires={track.audio.hires} lossless={track.audio.lossless} /></dd></div>
        {release?.label ? <div className="col-span-2 rounded-md bg-fg/4 p-2.5"><dt className="text-text-tertiary">Лейбл</dt><dd className="font-semibold">{release.label}</dd></div> : null}
      </dl>
      <div className="flex flex-col gap-1.5">
        {track.artists.map((a) => (
          <Link key={a.id} href={`/artist/${a.id}`} className="rounded-md px-3 py-2 text-caption font-semibold hover:bg-fg/6">Страница артиста: {a.name} →</Link>
        ))}
      </div>
    </div>
  );
}

function Row({ track, onPlay, onRemove, current }: { track: QueueTrack; onPlay: () => void; onRemove?: () => void; current?: boolean }) {
  return (
    <div className={`group flex items-center gap-3 rounded-md p-2 ${current ? "bg-accent-muted" : "hover:bg-fg/6"}`}>
      <button type="button" onClick={onPlay} aria-label={`Слушать: ${track.title}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Artwork artwork={track.release.artwork} alt="" sizes="40px" className="h-10 w-10 shrink-0 rounded-sm" />
        <span className="min-w-0">
          <span className={`block truncate text-caption font-semibold ${current ? "text-accent" : ""}`}>{track.title}</span>
          <span className="block truncate text-micro text-text-secondary">{track.artists.map((a) => a.name).join(", ")}</span>
        </span>
      </button>
      <span className="font-mono text-micro tabular-nums text-text-tertiary">{formatDuration(track.durationMs)}</span>
      {onRemove ? (
        <button type="button" aria-label={`Убрать из очереди: ${track.title}`} onClick={onRemove} className="rounded-sm p-1 text-text-tertiary opacity-100 hover:text-state-danger md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100">
          <TrashIcon size={15} />
        </button>
      ) : null}
    </div>
  );
}

/** Previous / now / next; drag to reorder upcoming tracks, remove, clear. */
export function QueuePanel() {
  const queue = usePlayer((s) => s.queue);
  const context = usePlayer((s) => s.context);
  const [showPrev, setShowPrev] = useState(false);
  const now = useCurrentTrack();
  if (!queue || !now) return <div className="p-6 text-body text-text-secondary">Очередь пуста</div>;
  const view = queueView(queue);
  const firstNext = view.next[0]?.pos ?? queue.cursor + 1;
  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      <div className="mono-label px-2 pb-1 pt-1 text-text-tertiary">Сейчас</div>
      <Row track={now} current onPlay={() => player.toggle()} />
      {context ? <div className="px-2 pt-1 text-micro text-text-tertiary">Играет из: {context.title}</div> : null}
      <div className="flex items-center justify-between px-2 pb-1 pt-4">
        <span className="mono-label text-text-tertiary">Далее · {view.next.length}</span>
        {view.next.length ? <button type="button" onClick={() => player.clearQueue()} className="text-caption font-semibold text-text-secondary hover:text-text-primary">Очистить</button> : null}
      </div>
      {view.next.length === 0 ? <p className="px-2 py-2 text-caption text-text-secondary">Дальше ничего нет. Добавляйте треки через меню «…» → «Добавить в очередь».</p> : null}
      <Reorder.Group
        axis="y"
        values={view.next.map((e) => e.track)}
        onReorder={(order: QueueTrack[]) => {
          // Reorder reports each drag step as one swap of neighbours: apply it as a single move.
          const before = view.next.map((e) => e.track);
          const i = before.findIndex((t, k) => order[k] !== t);
          if (i < 0 || i + 1 >= before.length) return;
          player.moveInQueue(firstNext + i + 1, firstNext + i);
        }}
        className="flex flex-col"
      >
        {view.next.map((e) => (
          <Reorder.Item key={`${e.track.id}-${e.pos}`} value={e.track} className="no-select flex items-center gap-1" whileDrag={{ scale: 1.02, zIndex: 2 }}>
            <span className="cursor-grab px-0.5 text-text-tertiary active:cursor-grabbing" aria-hidden><GripIcon size={16} /></span>
            <div className="min-w-0 flex-1"><Row track={e.track} onPlay={() => player.playAt(e.pos)} onRemove={() => player.removeFromQueue(e.pos)} /></div>
          </Reorder.Item>
        ))}
      </Reorder.Group>
      {view.previous.length ? (
        <div className="pt-4">
          <button type="button" aria-expanded={showPrev} onClick={() => setShowPrev((v) => !v)} className="mono-label px-2 text-text-tertiary hover:text-text-primary">
            Прослушано · {view.previous.length} {showPrev ? "▴" : "▾"}
          </button>
          {showPrev ? view.previous.map((e) => <Row key={`${e.track.id}-${e.pos}`} track={e.track} onPlay={() => player.playAt(e.pos)} onRemove={() => player.removeFromQueue(e.pos)} />) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Docked right panel on desktop (lyrics / info / queue), beside the content. */
export function SidePanel() {
  const kind = usePlayer((s) => s.sidePanel);
  const track = useCurrentTrack();
  const open = kind !== "none" && track !== null;
  useEffect(() => {
    document.documentElement.style.setProperty("--panel", open ? "392px" : "0px");
  }, [open]);
  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          aria-label={PANEL_META[kind as PanelKind].title}
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          className="fixed bottom-[112px] right-3 top-3 z-[var(--sonora-layer-sticky)] hidden w-[380px] flex-col overflow-hidden rounded-xl border border-border-default bg-bg-elevated/95 shadow-lg backdrop-blur-xl lg:flex"
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <div role="tablist" aria-label="Панель" className="flex gap-1">
              {(Object.keys(PANEL_META) as PanelKind[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => usePlayer.getState().patch({ sidePanel: k })} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-caption font-semibold transition-colors ${kind === k ? "bg-accent-muted text-accent" : "text-text-secondary hover:text-text-primary"}`}>
                  {PANEL_META[k].icon} {PANEL_META[k].title}
                </button>
              ))}
            </div>
            <button type="button" aria-label="Закрыть панель" onClick={() => usePlayer.getState().patch({ sidePanel: "none" })} className="rounded-md p-1.5 text-text-secondary hover:bg-fg/8 hover:text-text-primary">
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {kind === "lyrics" ? <LyricsPanel key={track.id} trackId={track.id} /> : kind === "info" ? <InfoPanel key={track.id} trackId={track.id} /> : <QueuePanel />}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
