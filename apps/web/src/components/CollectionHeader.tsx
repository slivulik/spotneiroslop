"use client";

import { motion } from "motion/react";
import { PauseIcon, PlayIcon, ShuffleIcon } from "@/components/icons";
import { Tilt } from "@/components/visual/Reveal";

/** Shared header for album / playlist / genre pages: big cover, tinted glass, actions. */
export function CollectionHeader({
  cover,
  kicker,
  title,
  meta,
  badge,
  description,
  tint,
  playing,
  onPlay,
  onShuffle,
  disabled,
  actions,
}: {
  cover: React.ReactNode;
  kicker: string;
  title: string;
  meta: React.ReactNode;
  badge?: React.ReactNode;
  description?: string | null;
  tint?: string | null;
  playing: boolean;
  onPlay: () => void;
  onShuffle?: () => void;
  disabled?: boolean;
  /** Extra controls after play/shuffle: like, share, edit… */
  actions?: React.ReactNode;
}) {
  return (
    <header className="relative mx-4 mt-2 overflow-hidden rounded-2xl md:mx-8">
      <div className="absolute inset-0 -z-10 opacity-80" style={{ background: `radial-gradient(120% 140% at 0% 0%, ${tint ?? "var(--bg-c1)"} 0%, transparent 65%)` }} />
      <div className="liquid flex flex-col items-center gap-6 p-6 md:flex-row md:items-end md:gap-10 md:p-10">
        <Tilt max={9} className="w-[68vw] max-w-[280px] shrink-0">{cover}</Tilt>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center md:items-start md:text-left">
          <span className="mono-label text-text-primary/70">{kicker}</span>
          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 24 }} className="font-display text-display-l leading-[0.95] md:text-display-xl">
            {title}
          </motion.h1>
          {description ? <p className="max-w-2xl text-body-l text-text-primary/75">{description}</p> : null}
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-body text-text-primary/80 md:justify-start">{meta}</div>
          {badge}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onPlay}
              disabled={disabled}
              aria-label={playing ? "Пауза" : "Слушать"}
              data-ripple
              className="flex h-16 w-16 items-center justify-center rounded-full btn-accent transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
            >
              {playing ? <PauseIcon size={28} /> : <PlayIcon size={28} style={{ marginLeft: 3 }} />}
            </button>
            {onShuffle ? (
              <button type="button" onClick={onShuffle} disabled={disabled} aria-label="Перемешать" className="liquid flex h-12 w-12 items-center justify-center rounded-full transition-transform hover:scale-110 disabled:opacity-40">
                <ShuffleIcon size={22} />
              </button>
            ) : null}
            {actions}
          </div>
        </div>
      </div>
    </header>
  );
}
