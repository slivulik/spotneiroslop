"use client";

import { NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, ShuffleIcon, VolumeIcon } from "@/components/icons";
import { useIsPlaying } from "@/components/player/hooks";
import { formatDuration } from "@/lib/format";
import { player } from "@/player/controller";
import { type RequestedQuality, usePlayer } from "@/player/store";

export function PlayPauseButton({ size = 40, className = "" }: { size?: number; className?: string }) {
  const playing = useIsPlaying();
  const loading = usePlayer((s) => s.status === "loading" || s.status === "buffering");
  return (
    <button
      type="button"
      aria-label={playing ? "Пауза" : "Играть"}
      onClick={() => player.toggle()}
      className={`relative flex items-center justify-center rounded-full bg-text-primary text-bg-base transition-transform active:scale-95 ${className}`}
      style={{ width: size, height: size }}
    >
      {playing ? <PauseIcon size={size * 0.48} /> : <PlayIcon size={size * 0.48} style={{ marginLeft: size * 0.04 }} />}
      {loading ? (
        <span className="absolute inset-[-3px] animate-spin rounded-full border-2 border-transparent border-t-white/70" />
      ) : null}
    </button>
  );
}

export function TransportControls({ large = false }: { large?: boolean }) {
  const shuffle = usePlayer((s) => s.queue?.shuffle ?? false);
  const repeat = usePlayer((s) => s.queue?.repeat ?? "off");
  const iconSize = large ? 30 : 20;
  const toggleClass = (on: boolean) =>
    `relative p-2 transition-colors ${on ? "text-accent" : "text-text-secondary hover:text-text-primary"}`;
  return (
    <div className={`flex items-center ${large ? "gap-6" : "gap-3"}`}>
      <button type="button" aria-label="Перемешать" aria-pressed={shuffle} onClick={() => player.toggleShuffle()} className={toggleClass(shuffle)}>
        <ShuffleIcon size={large ? 24 : 18} />
      </button>
      <button type="button" aria-label="Предыдущий" onClick={() => player.prev()} className="p-2 text-text-primary/90 hover:text-text-primary">
        <PrevIcon size={iconSize} />
      </button>
      <PlayPauseButton size={large ? 72 : 36} />
      <button type="button" aria-label="Следующий" onClick={() => player.next()} className="p-2 text-text-primary/90 hover:text-text-primary">
        <NextIcon size={iconSize} />
      </button>
      <button
        type="button"
        aria-label={repeat === "one" ? "Повтор трека" : repeat === "all" ? "Повтор очереди" : "Повтор выключен"}
        onClick={() => player.cycleRepeat()}
        className={toggleClass(repeat !== "off")}
      >
        <RepeatIcon size={large ? 24 : 18} one={repeat === "one"} />
      </button>
    </div>
  );
}

export function ProgressBar({ showTimes = true, onColor = false }: { showTimes?: boolean; onColor?: boolean }) {
  const position = usePlayer((s) => s.positionMs);
  const duration = usePlayer((s) => s.durationMs);
  const fill = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  // Over the artwork colour field the default tertiary grey disappears.
  const timeClass = `w-10 text-micro tabular-nums ${onColor ? "text-text-primary/75" : "text-text-tertiary"}`;
  return (
    <div className="flex w-full items-center gap-3">
      {showTimes ? <span className={`${timeClass} text-right`}>{formatDuration(position)}</span> : null}
      <input
        type="range"
        aria-label="Позиция"
        className="slider flex-1"
        min={0}
        max={Math.max(duration, 1)}
        step={250}
        value={Math.min(position, duration)}
        style={{ ["--fill" as string]: `${fill}%` }}
        onChange={(e) => player.seek(Number(e.target.value))}
      />
      {showTimes ? <span className={timeClass}>{formatDuration(duration)}</span> : null}
    </div>
  );
}

export function VolumeControl() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const level = muted ? 0 : volume;
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={muted ? "Включить звук" : "Выключить звук"} onClick={() => player.toggleMute()} className="p-1 text-text-secondary hover:text-text-primary">
        <VolumeIcon size={20} level={level} />
      </button>
      <input
        type="range"
        aria-label="Громкость"
        className="slider w-24"
        min={0}
        max={1}
        step={0.01}
        value={level}
        style={{ ["--fill" as string]: `${level * 100}%` }}
        onChange={(e) => player.setVolume(Number(e.target.value))}
      />
    </div>
  );
}

const QUALITY_LABELS: Record<RequestedQuality, string> = {
  auto: "Авто",
  hires: "Hi-Res",
  lossless: "Lossless",
  high: "Высокое",
  normal: "Обычное",
  low: "Экономия",
};

export function QualitySelect() {
  const quality = usePlayer((s) => s.quality);
  const active = usePlayer((s) => s.activeQuality);
  const label = quality === "auto" ? "Авто" : QUALITY_LABELS[(active as RequestedQuality) ?? quality];
  const special = active === "hires" || active === "lossless";
  return (
    <label className="relative flex items-center">
      <span className="sr-only">Качество</span>
      <span
        className={`pointer-events-none rounded-full border px-2.5 py-1 text-micro uppercase ${
          active === "hires"
            ? "border-badge-hires/50 text-badge-hires"
            : special
              ? "border-badge-lossless/40 text-badge-lossless"
              : "border-border-default text-text-secondary"
        }`}
      >
        {label}
      </span>
      <select
        value={quality}
        onChange={(e) => player.setQuality(e.target.value as RequestedQuality)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {(Object.keys(QUALITY_LABELS) as RequestedQuality[]).map((q) => (
          <option key={q} value={q}>
            {QUALITY_LABELS[q]}
          </option>
        ))}
      </select>
    </label>
  );
}
