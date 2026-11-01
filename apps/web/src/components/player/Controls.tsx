"use client";

import { NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, ShuffleIcon, VolumeIcon } from "@/components/icons";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { WaveformSeek } from "@/components/visual/Sonic";
import { formatDuration } from "@/lib/format";
import { player } from "@/player/controller";
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

/** Seek bar drawn as the current track's real waveform (seeded signature until analysed). */
export function ProgressBar({ showTimes = true, onColor = false, large = false }: { showTimes?: boolean; onColor?: boolean; large?: boolean }) {
  const position = usePlayer((s) => s.positionMs);
  const duration = usePlayer((s) => s.durationMs);
  const waveform = usePlayer((s) => s.waveform);
  const trackId = useCurrentTrack()?.id ?? "";
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  // Over the artwork colour field the default tertiary grey disappears.
  const timeClass = `w-10 font-mono text-micro tabular-nums ${onColor ? "text-text-primary/75" : "text-text-tertiary"}`;
  return (
    <div className="flex w-full items-center gap-3">
      {showTimes ? <span className={`${timeClass} text-right`}>{formatDuration(position)}</span> : null}
      <WaveformSeek
        peaks={waveform}
        seed={trackId}
        progress={progress}
        count={large ? 120 : 90}
        height={large ? 40 : 22}
        className="flex-1"
        onSeek={(f) => player.seek(f * duration)}
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
