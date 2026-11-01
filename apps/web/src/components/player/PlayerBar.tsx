"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Artwork } from "@/components/Artwork";
import { ExplicitBadge } from "@/components/Badges";
import { NextIcon } from "@/components/icons";
import { PlayPauseButton, ProgressBar, QualitySelect, TransportControls, VolumeControl } from "@/components/player/Controls";
import { useCurrentTrack } from "@/components/player/hooks";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

export function TrackTitle({ className = "", large = false }: { className?: string; large?: boolean }) {
  const track = useCurrentTrack();
  if (!track) return null;
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex items-center gap-1.5">
        <Link
          href={`/album/${track.release.id}`}
          onClick={() => player.setNowPlaying(false)}
          className={`truncate hover:underline ${large ? "font-display text-title-1" : "text-body font-semibold"}`}
        >
          {track.title}
          {track.version ? <span className="text-text-secondary"> ({track.version})</span> : null}
        </Link>
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
    <div className="fixed inset-x-0 bottom-[calc(52px+env(safe-area-inset-bottom))] z-[var(--sonora-layer-miniplayer)] px-2 md:bottom-0 md:px-0">
      {/* Mobile mini player */}
      <div className="glass-thick relative overflow-hidden rounded-lg border border-border-subtle md:hidden">
        <div className="flex items-center gap-3 p-2" onClick={() => player.setNowPlaying(true)}>
          <motion.div layoutId="now-playing-art" className="h-11 w-11 shrink-0 overflow-hidden rounded-sm">
            <Artwork artwork={track.release.artwork} alt={track.release.title} sizes="44px" className="h-full w-full" />
          </motion.div>
          <TrackTitle className="flex-1" />
          <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
            <PlayPauseButton size={36} />
            <button type="button" aria-label="Следующий" onClick={() => player.next()} className="p-2 text-text-primary">
              <NextIcon size={20} />
            </button>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
          <div className="h-full bg-text-primary" style={{ width: `${fill}%` }} />
        </div>
      </div>

      {/* Desktop bar */}
      <div className="glass-thick hidden h-22 grid-cols-[1fr_minmax(380px,2fr)_1fr] items-center gap-6 border-t border-border-subtle px-4 md:grid">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" aria-label="Открыть плеер" onClick={() => player.setNowPlaying(true)} className="shrink-0">
            <motion.div layoutId="now-playing-art" className="h-14 w-14 overflow-hidden rounded-artwork shadow-md">
              <Artwork artwork={track.release.artwork} alt={track.release.title} sizes="56px" className="h-full w-full" />
            </motion.div>
          </button>
          <TrackTitle />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <TransportControls />
          <ProgressBar />
        </div>
        <div className="flex items-center justify-end gap-4">
          {error ? <span className="truncate text-caption text-state-danger">{error}</span> : null}
          <QualitySelect />
          <VolumeControl />
        </div>
      </div>
    </div>
  );
}
