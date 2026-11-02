"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { tokens } from "@sonora/design-tokens";
import { Artwork } from "@/components/Artwork";
import { QualityBadge } from "@/components/Badges";
import { ChevronDownIcon } from "@/components/icons";
import { LikeButton } from "@/components/LikeButton";
import { InfoPanel, LyricsPanel, PANEL_META, type PanelKind, QueuePanel } from "@/components/player/Panels";
import { ProgressBar, QualitySelect, TransportControls, VolumeControl } from "@/components/player/Controls";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { TrackTitle } from "@/components/player/PlayerBar";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

const sheet = tokens.motion.spring.sheet;

export function NowPlaying() {
  const open = usePlayer((s) => s.nowPlayingOpen);
  const context = usePlayer((s) => s.context);
  const track = useCurrentTrack();
  const playing = useIsPlaying();
  const [panel, setPanel] = useState<"none" | PanelKind>("none");

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
          className="no-select fixed inset-0 z-[var(--sonora-layer-nowplaying)] flex flex-col overflow-hidden bg-bg-base/60 backdrop-blur-3xl"
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
          <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-bg-base/10 via-bg-base/40 to-bg-base/80" />

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
              {(Object.keys(PANEL_META) as PanelKind[]).map((k) => (
                <button key={k} type="button" aria-label={PANEL_META[k].title} title={PANEL_META[k].title} aria-pressed={panel === k} onClick={() => setPanel((p) => (p === k ? "none" : k))} className={`liquid flex h-11 w-11 items-center justify-center rounded-full ${panel === k ? "text-accent" : ""}`}>
                  {PANEL_META[k].icon}
                </button>
              ))}
            </div>
          </div>

          <div className={`relative mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-6 pb-[max(24px,env(safe-area-inset-bottom))] ${panel === "none" ? "grid-cols-[minmax(0,1fr)] justify-items-center" : "grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,420px)_1fr]"}`}>
            <div className="flex w-full min-w-0 flex-col items-center gap-6">
              <motion.div
                layoutId="now-playing-art"
                className="aspect-square w-full max-w-[min(78vw,440px)] overflow-hidden rounded-2xl shadow-artwork"
                animate={{ scale: playing ? 1 : 0.86 }}
                style={{ boxShadow: "0 40px 90px -20px rgba(0,0,0,.6), 0 0 calc(40px + var(--beat) * 60px) color-mix(in srgb, var(--sonora-color-accent-default) 35%, transparent)" }}
                transition={{ type: "spring", ...tokens.motion.spring.gentle }}
              >
                <Artwork artwork={track.release.artwork} alt={track.release.title} sizes="440px" className="h-full w-full" priority />
              </motion.div>
              <div className="flex w-full min-w-0 max-w-md flex-col gap-5">
                <div className="flex items-end justify-between gap-3">
                  <TrackTitle large />
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="hidden sm:inline-flex"><QualityBadge hires={track.hires} lossless={track.lossless} /></span>
                    <LikeButton kind="tracks" id={track.id} size={24} />
                  </div>
                </div>
                <ProgressBar onColor large />
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
                  className="liquid h-[min(68vh,640px)] overflow-hidden rounded-2xl"
                >
                  {panel === "lyrics" ? <LyricsPanel key={track.id} trackId={track.id} big /> : panel === "info" ? <InfoPanel key={track.id} trackId={track.id} /> : <QueuePanel />}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
