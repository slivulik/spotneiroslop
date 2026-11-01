"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { tokens } from "@sonora/design-tokens";
import { Artwork } from "@/components/Artwork";
import { QualityBadge } from "@/components/Badges";
import { ChevronDownIcon } from "@/components/icons";
import { ProgressBar, QualitySelect, TransportControls, VolumeControl } from "@/components/player/Controls";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { TrackTitle } from "@/components/player/PlayerBar";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

const sheet = tokens.motion.spring.sheet;

/** Living background: three blurred blobs in the artwork's colours drifting slowly. */
function ColorField({ dominant, vibrant, dark, moving }: { dominant: string; vibrant: string; dark: string; moving: boolean }) {
  const blob = "absolute rounded-full blur-[90px] opacity-70 will-change-transform";
  const drift = (x: number[], y: number[], duration: number) => ({
    animate: moving ? { x, y } : undefined,
    transition: { duration, repeat: Infinity, repeatType: "mirror" as const, ease: "easeInOut" as const },
  });
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: dark }} aria-hidden>
      <motion.div className={`${blob} -left-[10%] -top-[20%] h-[70vmax] w-[70vmax]`} style={{ background: dominant }} {...drift([0, 80, -40], [0, 60, 20], 18)} />
      <motion.div className={`${blob} -bottom-[30%] -right-[10%] h-[65vmax] w-[65vmax]`} style={{ background: vibrant }} {...drift([0, -70, 30], [0, -50, 10], 22)} />
      <motion.div className={`${blob} left-[30%] top-[40%] h-[40vmax] w-[40vmax] opacity-40`} style={{ background: dominant }} {...drift([0, 50, -60], [0, -40, 30], 26)} />
      <div className="absolute inset-0 bg-black/35" />
    </div>
  );
}

export function NowPlaying() {
  const open = usePlayer((s) => s.nowPlayingOpen);
  const context = usePlayer((s) => s.context);
  const track = useCurrentTrack();
  const playing = useIsPlaying();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && player.setNowPlaying(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const palette = track?.release.artwork?.palette;
  return (
    <AnimatePresence>
      {open && track ? (
        <motion.div
          role="dialog"
          aria-label="Сейчас играет"
          className="fixed inset-0 z-[var(--sonora-layer-nowplaying)] flex flex-col"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: sheet.stiffness, damping: sheet.damping, mass: sheet.mass }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 140 || info.velocity.y > 700) player.setNowPlaying(false);
          }}
        >
          <ColorField
            dominant={palette?.dominant ?? "#3A2A6B"}
            vibrant={palette?.vibrant ?? "#7C5CFF"}
            dark={palette?.muted_dark ?? "#14141A"}
            moving={playing}
          />
          <div className="relative flex items-center justify-between px-5 pt-[max(16px,env(safe-area-inset-top))]">
            <button type="button" aria-label="Свернуть" onClick={() => player.setNowPlaying(false)} className="rounded-full p-2 text-text-primary/80 hover:bg-white/10">
              <ChevronDownIcon size={28} />
            </button>
            {context ? (
              <div className="text-center">
                <div className="text-micro uppercase text-text-primary/60">Играет из</div>
                {context.type === "release" && context.id ? (
                  <Link href={`/album/${context.id}`} onClick={() => player.setNowPlaying(false)} className="text-caption font-semibold hover:underline">
                    {context.title}
                  </Link>
                ) : (
                  <div className="text-caption font-semibold">{context.title}</div>
                )}
              </div>
            ) : (
              <span />
            )}
            <div className="w-11" />
          </div>

          <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 px-6 pb-[max(24px,env(safe-area-inset-bottom))] md:flex-row md:gap-16">
            <motion.div
              layoutId="now-playing-art"
              className="aspect-square w-full max-w-[min(78vw,460px)] overflow-hidden rounded-xl shadow-artwork"
              animate={{ scale: playing ? 1 : 0.88 }}
              transition={{ type: "spring", ...tokens.motion.spring.gentle }}
            >
              <Artwork artwork={track.release.artwork} alt={track.release.title} sizes="(min-width: 900px) 460px, 78vw" className="h-full w-full" priority />
            </motion.div>
            <div className="flex w-full max-w-md flex-col gap-6">
              <div className="flex items-end justify-between gap-4">
                <TrackTitle large />
                <QualityBadge hires={track.hires} lossless={track.lossless} />
              </div>
              <ProgressBar onColor />
              <div className="flex justify-center">
                <TransportControls large />
              </div>
              <div className="flex items-center justify-between">
                <QualitySelect />
                <VolumeControl />
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
