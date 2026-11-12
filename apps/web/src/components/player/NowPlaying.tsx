"use client";

import Link from "next/link";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { useEffect, useState } from "react";
import { tokens } from "@sonora/design-tokens";
import { Artwork } from "@/components/Artwork";
import { ChevronDownIcon } from "@/components/icons";
import { LikeButton } from "@/components/LikeButton";
import { LyricsView } from "@/components/player/Lyrics";
import { InfoPanel, PANEL_META, type PanelKind, QueuePanel } from "@/components/player/Panels";
import { ProgressBar, QualitySelect, SleepTimer, TransportControls, VolumeControl } from "@/components/player/Controls";
import { useCurrentTrack, useIsPlaying, useWaveKind } from "@/components/player/hooks";
import { TrackTitle } from "@/components/player/PlayerBar";
import { vivid } from "@/components/visual/LiveBackground";
import { DislikeButton, WaveActions } from "@/components/wave/WaveActions";
import { useIsPhone } from "@/lib/media";
import { player } from "@/player/controller";
import type { QueueTrack } from "@/player/queue";
import { usePlayer } from "@/player/store";

const sheet = tokens.motion.spring.sheet;
const TABS: PanelKind[] = ["lyrics", "queue", "info"];
type Panel = "none" | PanelKind;

/**
 * The full-screen player is dark in every theme (it sits on the cover's own colours): the base —
 * dark — token palette is applied to its subtree, for both the `--sonora-*` variables and the
 * Tailwind colour utilities that resolved them at :root. The runtime accent stays as it is.
 */
const DARK_INK: Record<string, string> = (() => {
  const vars: Record<string, string> = {};
  for (const [group, entries] of Object.entries(tokens.color)) {
    if (group === "accent" || group === "wave") continue;
    for (const [name, value] of Object.entries(entries)) {
      vars[`--sonora-color-${group}-${name}`] = String(value);
      vars[`--color-${name === "default" ? group : `${group}-${name}`}`] = String(value);
    }
  }
  vars["--color-fg"] = tokens.color.text.primary;
  return vars;
})();

/** Cover with depth: a deep shadow plus a glow in its own colour; it settles back a little on pause. */
function Cover({
  track,
  playing,
  width,
  onPointerDown,
  thumb = false,
}: {
  track: QueueTrack;
  playing: boolean;
  width: string;
  onPointerDown?: (e: React.PointerEvent) => void;
  /** Small header thumbnail: no deep shadow. */
  thumb?: boolean;
}) {
  return (
    <motion.div
      layoutId="now-playing-art"
      onPointerDown={onPointerDown}
      className={`relative aspect-square shrink-0 overflow-hidden ${thumb ? "rounded-md shadow-md" : "np-cover rounded-[20px]"} ${onPointerDown ? "touch-none" : ""}`}
      style={{ width }}
      animate={{ scale: playing ? 1 : 0.94 }}
      transition={{ type: "spring", ...tokens.motion.spring.gentle }}
    >
      <Artwork artwork={track.release.artwork} alt={track.release.title} sizes="(min-width: 900px) 520px, 90vw" className="h-full w-full" priority />
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]" aria-hidden />
    </motion.div>
  );
}

/** Title and artists; the like sits here unless the wave row below carries it. */
function TitleRow({ track, wave }: { track: QueueTrack; wave: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <TrackTitle large className="flex-1" />
      {wave ? null : <LikeButton kind="tracks" id={track.id} size={24} className="h-11 w-11 shrink-0 hover:bg-fg/8" />}
    </div>
  );
}

/** Quality on the left, the wave's row in the middle, sleep timer and volume on the right. */
function UtilityRow() {
  return (
    <div className="flex items-center justify-between gap-3">
      <QualitySelect />
      <WaveActions />
      <div className="flex items-center gap-1">
        <SleepTimer onColor />
        <span className="max-md:hidden">
          <VolumeControl />
        </span>
      </div>
    </div>
  );
}

function PanelView({ panel, track, phone }: { panel: PanelKind; track: QueueTrack; phone: boolean }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={panel}
        id="np-panel"
        role="tabpanel"
        aria-label={PANEL_META[panel].title}
        className="h-full min-h-0"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
      >
        {panel === "lyrics" ? (
          <LyricsView key={track.id} trackId={track.id} size={phone ? "medium" : "large"} />
        ) : (
          <div className="h-full overflow-hidden rounded-[22px] bg-black/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]">
            {panel === "info" ? <InfoPanel key={track.id} trackId={track.id} /> : <QueuePanel />}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Full-screen player. The ground is the cover itself — blurred once and drifting on the
 * compositor — under two glows in its palette and a film grain; the artwork floats above with a
 * shadow in its own colour. Lyrics, queue and details open as tabs: beside the player on desktop,
 * in place of the artwork on phones (controls stay at hand). Swipe down or Esc to close.
 */
export function NowPlaying() {
  const open = usePlayer((s) => s.nowPlayingOpen);
  const context = usePlayer((s) => s.context);
  const track = useCurrentTrack();
  const playing = useIsPlaying();
  const wave = useWaveKind() !== null;
  const phone = useIsPhone();
  const drag = useDragControls();
  const [panel, setPanel] = useState<Panel>("none");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && player.setNowPlaying(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const palette = track?.release.artwork?.palette;
  const glowA = vivid(palette?.vibrant ?? palette?.dominant, "#5b3fd6");
  const glowB = vivid(palette?.dominant ?? palette?.muted_dark, "#2a2f8f");
  const startDrag = (e: React.PointerEvent) => drag.start(e);

  return (
    <AnimatePresence>
      {open && track ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Сейчас играет"
          className="no-select fixed inset-0 z-[var(--sonora-layer-nowplaying)] overflow-hidden"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: sheet.stiffness, damping: sheet.damping, mass: sheet.mass }}
          drag="y"
          dragControls={drag}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 140 || info.velocity.y > 700) player.setNowPlaying(false);
          }}
        >
          <div className="np-ink relative isolate flex h-full flex-col bg-bg-base text-text-primary" style={{ ...DARK_INK, ["--np-a" as string]: glowA, ["--np-b" as string]: glowB }}>
            {/* Ground: the cover blown up, its two glows, a scrim that deepens behind lyrics, film grain. */}
            <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
              <div className="np-backdrop">
                <Artwork artwork={track.release.artwork} alt="" sizes="160px" className="h-full w-full" />
              </div>
              <div className="np-glow absolute inset-0" />
              <div className={`absolute inset-0 bg-black transition-opacity duration-500 ${panel === "lyrics" ? "opacity-60" : "opacity-40"}`} />
              <div className="noise absolute inset-0 opacity-[0.07] mix-blend-overlay" />
            </div>

            {/* Top: grab handle (phones), close, where it plays from, panel tabs. */}
            <div onPointerDown={startDrag} className="relative shrink-0 touch-none px-4 pt-[max(10px,env(safe-area-inset-top))] md:px-6 md:pt-[max(18px,env(safe-area-inset-top))]">
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-fg/25 md:hidden" aria-hidden />
              <div className="flex items-center justify-between gap-3">
                <button type="button" aria-label="Свернуть" onClick={() => player.setNowPlaying(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fg/8 transition-colors hover:bg-fg/14">
                  <ChevronDownIcon size={24} />
                </button>
                {context ? (
                  <div className="min-w-0 flex-1 text-center">
                    <div className="text-micro text-text-tertiary">Играет из</div>
                    {context.type === "release" && context.id ? (
                      <Link href={`/album/${context.id}`} onClick={() => player.setNowPlaying(false)} className="block truncate text-caption font-bold hover:underline">
                        {context.title}
                      </Link>
                    ) : (
                      <div className="truncate text-caption font-bold">{context.title}</div>
                    )}
                  </div>
                ) : (
                  <span className="flex-1" />
                )}
                <div role="tablist" aria-label="Текст, очередь и сведения" className="flex shrink-0 rounded-full bg-fg/8 p-1">
                  {TABS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={panel === k}
                      aria-controls={panel === k ? "np-panel" : undefined}
                      title={PANEL_META[k].title}
                      onClick={() => setPanel((p) => (p === k ? "none" : k))}
                      className={`no-press relative flex h-9 items-center rounded-full px-2.5 text-caption font-semibold transition-colors md:px-3.5 ${panel === k ? "text-bg-base" : "text-text-secondary hover:text-text-primary"}`}
                    >
                      {panel === k ? <motion.span layoutId="np-tab" className="absolute inset-0 rounded-full bg-text-primary" transition={{ type: "spring", stiffness: 520, damping: 40 }} /> : null}
                      <span className="relative flex items-center gap-2">
                        {PANEL_META[k].icon}
                        <span className="max-md:sr-only">{PANEL_META[k].title}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {panel === "none" ? (
              // Stage: the cover and everything about it in one column, sized to fit any screen.
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-2">
                <div className="flex flex-col gap-6 md:gap-7" style={{ width: "min(100vw - 48px, max(240px, 100dvh - 420px), 520px)" }}>
                  <Cover track={track} playing={playing} width="100%" onPointerDown={startDrag} />
                  <div className="flex flex-col gap-4">
                    <TitleRow track={track} wave={wave} />
                    <ProgressBar onColor large />
                  </div>
                  <div className="flex justify-center">
                    <TransportControls large />
                  </div>
                  <UtilityRow />
                </div>
              </div>
            ) : phone ? (
              // Phone with a panel: a compact header, the panel, the controls within thumb reach.
              <div className="flex min-h-0 flex-1 flex-col px-5 pb-[max(16px,env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-3 py-3">
                  <Cover track={track} playing width="52px" thumb />
                  <TrackTitle className="flex-1" />
                  {wave ? <DislikeButton size={20} className="h-10 w-10" /> : null}
                  <LikeButton kind="tracks" id={track.id} size={22} className="h-10 w-10 shrink-0" />
                </div>
                <div className="min-h-0 flex-1">
                  <PanelView panel={panel} track={track} phone />
                </div>
                <div className="flex flex-col gap-2 pt-3">
                  <ProgressBar onColor large />
                  <div className="flex justify-center">
                    <TransportControls large />
                  </div>
                </div>
              </div>
            ) : (
              // Desktop with a panel: the player keeps its column, the panel takes the rest.
              <div className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-[minmax(0,400px)_minmax(0,1fr)] items-center gap-14 px-12 pb-8">
                <div className="flex min-w-0 flex-col gap-6">
                  <Cover track={track} playing={playing} width="min(100%, max(220px, 100dvh - 460px))" />
                  <div className="flex flex-col gap-4">
                    <TitleRow track={track} wave={wave} />
                    <ProgressBar onColor large />
                  </div>
                  <div className="flex justify-center">
                    <TransportControls large />
                  </div>
                  <UtilityRow />
                </div>
                <div className="h-[min(78vh,760px)] min-w-0">
                  <PanelView panel={panel} track={track} phone={false} />
                </div>
              </div>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
