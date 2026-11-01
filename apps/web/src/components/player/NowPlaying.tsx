"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { tokens } from "@sonora/design-tokens";
import { Artwork } from "@/components/Artwork";
import { QualityBadge } from "@/components/Badges";
import { ChevronDownIcon, ListIcon, LyricsIcon } from "@/components/icons";
import { ProgressBar, QualitySelect, TransportControls, VolumeControl } from "@/components/player/Controls";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { TrackTitle } from "@/components/player/PlayerBar";
import { formatDuration } from "@/lib/format";
import { useLyrics } from "@/lib/queries";
import { player } from "@/player/controller";
import { upcoming } from "@/player/queue";
import { usePlayer } from "@/player/store";

const sheet = tokens.motion.spring.sheet;

/** Line-synced lyrics: the current line glows, the list follows it, tapping a line seeks. */
function LyricsPanel({ trackId }: { trackId: string }) {
  const lyrics = useLyrics(trackId, true);
  const position = usePlayer((s) => s.positionMs);
  const list = useRef<HTMLDivElement>(null);
  const lines = lyrics.data?.lines ?? [];
  let active = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.start_ms <= position + 250) active = i;

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  if (lyrics.isPending) return <div className="p-6 text-text-primary/60">Загружаем текст…</div>;
  if (lyrics.isError || !lyrics.data) return <div className="flex h-full items-center justify-center p-6 text-center text-body-l text-text-primary/60">У этого трека пока нет текста</div>;
  if (lyrics.data.type === "static") {
    return <div className="h-full overflow-auto whitespace-pre-line p-6 font-display text-title-3 leading-relaxed text-text-primary/90">{lyrics.data.text}</div>;
  }
  return (
    <div ref={list} className="h-full overflow-auto px-6 py-[30vh] [mask-image:linear-gradient(transparent,#000_18%,#000_82%,transparent)]">
      {lines.map((line, i) => (
        <button
          key={`${line.start_ms}-${i}`}
          type="button"
          data-line={i}
          onClick={() => player.seek(line.start_ms)}
          className="block w-full py-2 text-left font-display text-[clamp(22px,2.6vw,34px)] font-extrabold leading-tight transition-all duration-500 ease-standard"
          style={{
            opacity: i === active ? 1 : i < active ? 0.35 : 0.5,
            filter: i === active ? "none" : `blur(${Math.min(Math.abs(i - active), 3) * 0.6}px)`,
            transform: i === active ? "scale(1.02)" : "scale(1)",
            transformOrigin: "left center",
            textShadow: i === active ? "0 0 30px color-mix(in srgb, var(--bg-c2) 70%, transparent)" : "none",
          }}
        >
          {line.text || "♪"}
        </button>
      ))}
    </div>
  );
}

function QueuePanel() {
  const queue = usePlayer((s) => s.queue);
  if (!queue) return null;
  const next = upcoming(queue, 50);
  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-2 px-2 text-micro uppercase text-text-primary/60">Далее</div>
      {next.length === 0 ? <div className="px-2 text-text-primary/60">Очередь пуста</div> : null}
      {next.map((t, i) => (
        <button key={`${t.id}-${i}`} type="button" onClick={() => player.playAt(queue.cursor + 1 + i)} className="flex w-full items-center gap-3 rounded-2xl p-2 text-left hover:bg-white/10">
          <Artwork artwork={t.release.artwork} alt={t.title} sizes="44px" className="h-11 w-11 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-body font-semibold">{t.title}</div>
            <div className="truncate text-caption text-text-primary/60">{t.artists.map((a) => a.name).join(", ")}</div>
          </div>
          <span className="text-caption tabular-nums text-text-primary/50">{formatDuration(t.durationMs)}</span>
        </button>
      ))}
    </div>
  );
}

export function NowPlaying() {
  const open = usePlayer((s) => s.nowPlayingOpen);
  const context = usePlayer((s) => s.context);
  const track = useCurrentTrack();
  const playing = useIsPlaying();
  const [panel, setPanel] = useState<"none" | "lyrics" | "queue">("none");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && player.setNowPlaying(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open && track ? (
        <motion.div
          role="dialog"
          aria-label="Сейчас играет"
          className="fixed inset-0 z-[var(--sonora-layer-nowplaying)] flex flex-col overflow-hidden bg-black/40 backdrop-blur-3xl"
          initial={{ y: "100%", borderRadius: 40 }}
          animate={{ y: 0, borderRadius: 0 }}
          exit={{ y: "100%", borderRadius: 40 }}
          transition={{ type: "spring", stiffness: sheet.stiffness, damping: sheet.damping, mass: sheet.mass }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 140 || info.velocity.y > 700) player.setNowPlaying(false);
          }}
        >
          {/* Big blurred artwork wash + the live colour fields underneath. */}
          <div className="pointer-events-none absolute inset-0 -z-10 scale-125 opacity-60 blur-[80px] saturate-150">
            <Artwork artwork={track.release.artwork} alt="" sizes="300px" className="h-full w-full" />
          </div>
          <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/10 via-black/30 to-black/70" />

          <div className="relative flex items-center justify-between px-5 pt-[max(16px,env(safe-area-inset-top))]">
            <button type="button" aria-label="Свернуть" onClick={() => player.setNowPlaying(false)} className="liquid flex h-11 w-11 items-center justify-center rounded-full">
              <ChevronDownIcon size={24} />
            </button>
            {context ? (
              <div className="text-center">
                <div className="text-micro uppercase tracking-[0.18em] text-text-primary/60">Играет из</div>
                {context.type === "release" && context.id ? (
                  <Link href={`/album/${context.id}`} onClick={() => player.setNowPlaying(false)} className="text-caption font-bold hover:underline">{context.title}</Link>
                ) : (
                  <div className="text-caption font-bold">{context.title}</div>
                )}
              </div>
            ) : <span />}
            <div className="flex gap-2">
              <button type="button" aria-label="Текст" aria-pressed={panel === "lyrics"} onClick={() => setPanel((p) => (p === "lyrics" ? "none" : "lyrics"))} className={`liquid flex h-11 w-11 items-center justify-center rounded-full ${panel === "lyrics" ? "text-accent" : ""}`}>
                <LyricsIcon size={20} />
              </button>
              <button type="button" aria-label="Очередь" aria-pressed={panel === "queue"} onClick={() => setPanel((p) => (p === "queue" ? "none" : "queue"))} className={`liquid flex h-11 w-11 items-center justify-center rounded-full ${panel === "queue" ? "text-accent" : ""}`}>
                <ListIcon size={20} />
              </button>
            </div>
          </div>

          <div className={`relative mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-6 pb-[max(24px,env(safe-area-inset-bottom))] ${panel === "none" ? "md:grid-cols-[1fr_1fr]" : "md:grid-cols-[minmax(0,420px)_1fr]"}`}>
            <div className="flex flex-col items-center gap-6">
              <motion.div
                layoutId="now-playing-art"
                className="aspect-square w-full max-w-[min(78vw,440px)] overflow-hidden rounded-[32px] shadow-artwork"
                animate={{ scale: playing ? 1 : 0.86 }}
                style={{ boxShadow: "0 40px 90px -20px rgba(0,0,0,.7), 0 0 calc(40px + var(--beat) * 60px) color-mix(in srgb, var(--bg-c2) 45%, transparent)" }}
                transition={{ type: "spring", ...tokens.motion.spring.gentle }}
              >
                <Artwork artwork={track.release.artwork} alt={track.release.title} sizes="440px" className="h-full w-full" priority />
              </motion.div>
              <div className="flex w-full max-w-md flex-col gap-5">
                <div className="flex items-end justify-between gap-4">
                  <TrackTitle large />
                  <QualityBadge hires={track.hires} lossless={track.lossless} />
                </div>
                <ProgressBar onColor />
                <div className="flex justify-center"><TransportControls large /></div>
                <div className="flex items-center justify-between"><QualitySelect /><VolumeControl /></div>
              </div>
            </div>
            <AnimatePresence mode="wait">
              {panel !== "none" ? (
                <motion.div
                  key={panel}
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  transition={{ type: "spring", stiffness: 260, damping: 28 }}
                  className="liquid h-[min(68vh,640px)] overflow-hidden rounded-[32px]"
                >
                  {panel === "lyrics" ? <LyricsPanel trackId={track.id} /> : <QueuePanel />}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
