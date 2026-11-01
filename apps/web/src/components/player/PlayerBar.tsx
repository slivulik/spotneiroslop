"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Artwork } from "@/components/Artwork";
import { ExplicitBadge } from "@/components/Badges";
import { NextIcon } from "@/components/icons";
import { PlayPauseButton, ProgressBar, QualitySelect, TransportControls, VolumeControl } from "@/components/player/Controls";
import { useCurrentTrack } from "@/components/player/hooks";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

/** Text that scrolls back and forth only when it doesn't fit. */
function Marquee({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (o && i) setShift(Math.max(0, i.scrollWidth - o.clientWidth));
  }, [children]);
  return (
    <div ref={outer} className={`overflow-hidden whitespace-nowrap ${className}`} style={shift ? { maskImage: "linear-gradient(90deg, #000 85%, transparent)" } : undefined}>
      <span ref={inner} className={`inline-block ${shift ? "marquee" : ""}`} style={{ ["--marquee-shift" as string]: `-${shift}px` }}>
        {children}
      </span>
    </div>
  );
}

export function TrackTitle({ className = "", large = false }: { className?: string; large?: boolean }) {
  const track = useCurrentTrack();
  if (!track) return null;
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex items-center gap-1.5">
        <Marquee className="min-w-0">
          <Link
            href={`/album/${track.release.id}`}
            onClick={() => player.setNowPlaying(false)}
            className={`hover:underline ${large ? "font-display text-title-1" : "text-body font-bold"}`}
          >
            {track.title}
            {track.version ? <span className="text-text-secondary"> ({track.version})</span> : null}
          </Link>
        </Marquee>
        {track.explicit ? <ExplicitBadge /> : null}
      </div>
      <div className={`truncate ${large ? "mt-1 text-body-l text-text-primary/75" : "text-caption text-text-secondary"}`}>
        {track.artists.map((a, i) => (
          <span key={a.id}>
            {i > 0 ? ", " : null}
            <Link href={`/artist/${a.id}`} onClick={() => player.setNowPlaying(false)} className="hover:text-text-primary hover:underline">
              {a.name}
            </Link>
          </span>
        ))}
      </div>
    </div>
  );
}

export function PlayerBar() {
  const track = useCurrentTrack();
  const error = usePlayer((s) => s.error);
  const position = usePlayer((s) => s.positionMs);
  const duration = usePlayer((s) => s.durationMs);
  if (!track) return null;
  const fill = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <motion.div
      initial={{ y: 120, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[var(--sonora-layer-miniplayer)] md:inset-x-auto md:bottom-4 md:left-[calc(var(--rail)+16px)] md:right-4"
      style={{ ["--slider-fill" as string]: "var(--sonora-color-accent-default)" }}
    >
      {/* Mobile capsule */}
      <div className="liquid liquid-strong relative overflow-hidden rounded-lg md:hidden">
        <div className="flex items-center gap-3 p-2" onClick={() => player.setNowPlaying(true)}>
          <motion.div layoutId="now-playing-art" className="h-11 w-11 shrink-0 overflow-hidden rounded-md">
            <Artwork artwork={track.release.artwork} alt={track.release.title} sizes="44px" className="h-full w-full" />
          </motion.div>
          <TrackTitle className="flex-1" />
          <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
            <PlayPauseButton size={38} />
            <button type="button" aria-label="Следующий" onClick={() => player.next()} className="p-2"><NextIcon size={20} /></button>
          </div>
        </div>
        <div className="absolute inset-x-3 bottom-0 h-[2px] overflow-hidden rounded-full bg-fg/10">
          <div className="h-full rounded-full" style={{ width: `${fill}%`, background: "var(--sonora-color-accent-default)" }} />
        </div>
      </div>

      {/* Desktop capsule */}
      <div className="liquid liquid-strong hidden h-[84px] grid-cols-[minmax(0,1fr)_minmax(380px,1.6fr)_minmax(0,1fr)] items-center gap-6 rounded-xl px-3 md:grid">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" aria-label="Открыть плеер" onClick={() => player.setNowPlaying(true)} className="group relative shrink-0">
            <motion.div layoutId="now-playing-art" className="h-[60px] w-[60px] overflow-hidden rounded-lg shadow-md transition-transform group-hover:scale-105">
              <Artwork artwork={track.release.artwork} alt={track.release.title} sizes="60px" className="h-full w-full" />
            </motion.div>
          </button>
          <TrackTitle />
        </div>
        <div className="flex flex-col items-center gap-1">
          <TransportControls />
          <ProgressBar />
        </div>
        <div className="flex items-center justify-end gap-4 pr-2">
          {error ? <span className="truncate text-caption text-state-danger">{error}</span> : null}
          <QualitySelect />
          <VolumeControl />
        </div>
      </div>
    </motion.div>
  );
}
