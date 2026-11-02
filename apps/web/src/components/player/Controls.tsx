"use client";

import { NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, ShuffleIcon, VolumeIcon } from "@/components/icons";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { WaveformSeek } from "@/components/visual/Sonic";
import { formatDuration } from "@/lib/format";
import { player } from "@/player/controller";
import { useState } from "react";
import { useSettings } from "@/lib/settings";
import { canDecode } from "@/player/engine";
import { type Rendition, type RequestedQuality, usePlayer } from "@/player/store";

export function PlayPauseButton({ size = 40, className = "" }: { size?: number; className?: string }) {
  const playing = useIsPlaying();
  const loading = usePlayer((s) => s.status === "loading" || s.status === "buffering");
  return (
    <button
      type="button"
      aria-label={playing ? "Пауза" : "Играть"}
      data-ripple
      onClick={() => player.toggle()}
      className={`relative flex items-center justify-center rounded-full btn-accent transition-transform hover:scale-105 active:scale-95 ${className}`}
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

/** Solid seek line: played (accent), buffered, rest; enlarges and shows a knob on hover. */
function LineSeek({ progress, buffered, large, onSeek }: { progress: number; buffered: number; large: boolean; onSeek: (f: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Перемотка"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className={`group relative flex flex-1 cursor-pointer items-center ${large ? "h-6" : "h-4"}`}
      onPointerMove={(e) => setHover(pick(e))}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => onSeek(pick(e))}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(Math.min(1, progress + 0.02));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.02));
      }}
    >
      <div className={`relative w-full overflow-hidden rounded-full bg-fg/15 transition-[height] duration-150 ${large ? "h-1.5 group-hover:h-2" : "h-1 group-hover:h-1.5"}`}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-fg/15" style={{ width: `${buffered * 100}%` }} />
        {hover !== null ? <div className="absolute inset-y-0 left-0 rounded-full bg-fg/20" style={{ width: `${hover * 100}%` }} /> : null}
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
      </div>
      <span
        className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-primary opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ left: `${progress * 100}%` }}
      />
    </div>
  );
}

/** Seek bar: solid line (default) or the track's real waveform, per Settings → Playback. */
export function ProgressBar({ showTimes = true, onColor = false, large = false }: { showTimes?: boolean; onColor?: boolean; large?: boolean }) {
  const position = usePlayer((s) => s.positionMs);
  const duration = usePlayer((s) => s.durationMs);
  const waveform = usePlayer((s) => s.waveform);
  const buffered = usePlayer((s) => s.bufferedMs);
  const style = useSettings((s) => s.progressStyle);
  const trackId = useCurrentTrack()?.id ?? "";
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  // Over the artwork colour field the default tertiary grey disappears.
  const timeClass = `w-10 font-mono text-micro tabular-nums ${onColor ? "text-text-primary/75" : "text-text-tertiary"}`;
  return (
    <div className="flex w-full items-center gap-3">
      {showTimes ? <span className={`${timeClass} text-right`}>{formatDuration(position)}</span> : null}
      {style === "wave" ? (
        <WaveformSeek
          peaks={waveform}
          seed={trackId}
          progress={progress}
          count={large ? 120 : 90}
          height={large ? 40 : 22}
          className="flex-1"
          onSeek={(f) => player.seek(f * duration)}
        />
      ) : (
        <LineSeek progress={progress} buffered={duration > 0 ? Math.min(1, buffered / duration) : 0} large={large} onSeek={(f) => player.seek(f * duration)} />
      )}
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

/** Human description of a rendition from its real encoded parameters. */
export function describeRendition(r: Rendition): string {
  const codec = r.codec === "he-aac" ? "HE-AAC" : r.codec.toUpperCase();
  if (r.codec === "flac") return `${codec} ${r.bit_depth ?? 16} бит · ${(r.sample_rate / 1000).toLocaleString("ru-RU")} кГц`;
  return `${codec} ${Math.round((r.bitrate ?? 0) / 1000)} кбит/с`;
}

/** Only the qualities this track really has and this browser can decode; "Авто" lets ABR choose. */
export function QualitySelect() {
  const quality = usePlayer((s) => s.quality);
  const active = usePlayer((s) => s.activeQuality);
  const renditions = usePlayer((s) => s.renditions).filter((r) => canDecode(r.codec));
  const current = renditions.find((r) => r.quality === active);
  const label = quality === "auto" ? "Авто" : QUALITY_LABELS[(active as RequestedQuality) ?? quality];
  const special = active === "hires" || active === "lossless";
  return (
    <label className="relative flex items-center" title={current ? describeRendition(current) : undefined}>
      <span className="sr-only">Качество</span>
      <span
        className={`pointer-events-none whitespace-nowrap rounded-full border px-2.5 py-1 text-micro uppercase ${
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
        value={quality === "auto" || renditions.some((r) => r.quality === quality) ? quality : (active ?? "auto")}
        onChange={(e) => player.setQuality(e.target.value as RequestedQuality)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label="Качество воспроизведения"
      >
        <option value="auto">Авто — по скорости сети</option>
        {renditions.map((r) => (
          <option key={r.quality} value={r.quality}>
            {QUALITY_LABELS[r.quality as RequestedQuality]} — {describeRendition(r)}
          </option>
        ))}
      </select>
    </label>
  );
}
