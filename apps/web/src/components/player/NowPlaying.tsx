"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { tokens } from "@sonora/design-tokens";
import { Artwork } from "@/components/Artwork";
import { ChevronDownIcon } from "@/components/icons";
import { LikeButton } from "@/components/LikeButton";
import { LyricsView } from "@/components/player/Lyrics";
import { InfoPanel, PANEL_META, type PanelKind, QueuePanel } from "@/components/player/Panels";
import { ProgressBar, QualitySelect, SleepTimer, TransportControls, VolumeControl } from "@/components/player/Controls";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { TrackTitle } from "@/components/player/PlayerBar";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

const sheet = tokens.motion.spring.sheet;

/**
 * Full-screen player. The backdrop is the cover itself, blurred once and drifting by transform
 * (no full-screen backdrop-filter). With lyrics open it reads like Apple Music: artwork and
 * controls on the left, big lines on the right; on a phone the lyrics take the screen.
 */
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

  const lyrics = panel === "lyrics";
  const side = panel === "info" || panel === "queue";

  return (
    <AnimatePresence>
      {open && track ? (
        <motion.div
          role="dialog"
          aria-label="Сейчас играет"
          className="no-select fixed inset-0 z-[var(--sonora-layer-nowplaying)] flex flex-col overflow-hidden bg-[#0b0a10] text-white"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: sheet.stiffness, damping: sheet.damping, mass: sheet.mass }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          dragListener={!lyrics}
          onDragEnd={(_, info) => {
            if (info.offset.y > 140 || info.velocity.y > 700) player.setNowPlaying(false);
          }}
        >
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
            <div className="np-backdrop">
              <Artwork artwork={track.release.artwork} alt="" sizes="160px" className="h-full w-full" />
            </div>
            <div className="absolute inset-0 bg-black/45" />
          </div>

          {/* Top: close, where it plays from, panels. */}
          <div className="relative flex items-center justify-between gap-3 px-5 pt-[max(16px,env(safe-area-inset-top))]">
            <button type="button" aria-label="Свернуть" onClick={() => player.setNowPlaying(false)} className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
              <ChevronDownIcon size={24} />
            </button>
            {context ? (
              <div className="min-w-0 text-center">
                <div className="text-micro uppercase tracking-[0.18em] text-white/60">Играет из</div>
                {context.type === "release" && context.id ? (
                  <Link href={`/album/${context.id}`} onClick={() => player.setNowPlaying(false)} className="block truncate text-caption font-bold hover:underline">{context.title}</Link>
                ) : (
                  <div className="truncate text-caption font-bold">{context.title}</div>
                )}
              </div>
            ) : <span />}
            <div className="flex shrink-0 gap-2">
              {(Object.keys(PANEL_META) as PanelKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-label={PANEL_META[k].title}
                  title={PANEL_META[k].title}
                  aria-pressed={panel === k}
                  onClick={() => setPanel((p) => (p === k ? "none" : k))}
                  className={`flex h-11 w-11 items-center justify-center rounded-full ${panel === k ? "bg-white text-black" : "glass"}`}
                >
                  {PANEL_META[k].icon}
                </button>
              ))}
            </div>
          </div>

          {/* Phone + lyrics: compact header, lyrics fill the screen, controls at the bottom. */}
          {lyrics ? (
            <div className="flex min-h-0 flex-1 flex-col px-6 pb-[max(20px,env(safe-area-inset-bottom))] md:hidden">
              <div className="flex items-center gap-3 py-4">
                <Artwork artwork={track.release.artwork} alt="" sizes="56px" className="h-14 w-14 shrink-0 rounded-lg" />
                <TrackTitle className="flex-1" />
                <LikeButton kind="tracks" id={track.id} size={22} />
              </div>
              <div className="min-h-0 flex-1">
                <LyricsView key={track.id} trackId={track.id} size="medium" />
              </div>
              <div className="flex flex-col gap-3 pt-3">
                <ProgressBar onColor large />
                <div className="flex justify-center"><TransportControls large /></div>
              </div>
            </div>
          ) : null}

          <div
            className={`relative mx-auto min-h-0 w-full max-w-7xl flex-1 items-center gap-12 px-6 pb-[max(24px,env(safe-area-inset-bottom))] md:px-12 ${lyrics ? "hidden md:grid" : "grid"} ${
              panel === "none" ? "grid-cols-[minmax(0,1fr)] justify-items-center" : "grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,400px)_1fr]"
            }`}
          >
            <div className={`flex w-full min-w-0 flex-col items-center gap-6 ${side ? "max-md:hidden" : ""}`}>
              <motion.div
                layoutId="now-playing-art"
                className={`aspect-square w-full overflow-hidden rounded-2xl ${panel === "none" ? "max-w-[min(78vw,460px)]" : "max-w-[400px]"}`}
                animate={{ scale: playing ? 1 : 0.9 }}
                style={{ boxShadow: "0 40px 90px -24px rgba(0,0,0,.7)" }}
                transition={{ type: "spring", ...tokens.motion.spring.gentle }}
              >
                <Artwork artwork={track.release.artwork} alt={track.release.title} sizes="460px" className="h-full w-full" priority />
              </motion.div>
              <div className="flex w-full min-w-0 max-w-[460px] flex-col gap-5">
                <div className="flex items-center justify-between gap-3">
                  <TrackTitle large />
                  <LikeButton kind="tracks" id={track.id} size={24} />
                </div>
                <ProgressBar onColor large />
                <div className="flex justify-center"><TransportControls large /></div>
                <div className="flex items-center justify-between"><QualitySelect /><div className="flex items-center gap-1"><SleepTimer onColor /><VolumeControl /></div></div>
              </div>
            </div>
            {panel !== "none" ? (
              <div key={panel} className="reveal h-[min(78vh,760px)] min-w-0">
                {lyrics ? (
                  <LyricsView key={track.id} trackId={track.id} />
                ) : (
                  <div className="h-full overflow-hidden rounded-2xl bg-black/25">
                    {panel === "info" ? <InfoPanel key={track.id} trackId={track.id} /> : <QueuePanel />}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
