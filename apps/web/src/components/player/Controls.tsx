"use client";

import { MoonIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, ShuffleIcon, VolumeIcon } from "@/components/icons";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { WaveformSeek } from "@/components/visual/Sonic";
import { formatDuration } from "@/lib/format";
import { player } from "@/player/controller";
import { useEffect, useRef, useState } from "react";
import { useSleep } from "@/player/sleep";
import { useSettings } from "@/lib/settings";
import { canDecode } from "@/player/engine";
import { type Rendition, type RequestedQuality, usePlayer } from "@/player/store";

/** One 36×36 slot for every icon button in the dock, so the row reads evenly. */
export const dockButton = (on = false, onColor = false) =>
  `flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
    on ? "text-accent hover:bg-fg/8" : onColor ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-text-secondary hover:bg-fg/8 hover:text-text-primary"
  }`;

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
  // Large (full-screen player): bigger slots; dock: the shared 36 px slot, all five evenly spaced.
  const slot = (on: boolean, primary = false) =>
    large
      ? `flex h-14 w-14 items-center justify-center rounded-full transition-colors hover:bg-white/10 ${on ? "text-accent" : primary ? "text-white" : "text-white/70 hover:text-white"}`
      : dockButton(on).replace("text-text-secondary", primary ? "text-text-primary" : "text-text-secondary");
  const side = large ? 24 : 18;
  const skip = large ? 30 : 20;
  return (
    <div className={`flex items-center ${large ? "gap-5" : "gap-2"}`}>
      <button type="button" aria-label="Перемешать" aria-pressed={shuffle} onClick={() => player.toggleShuffle()} className={slot(shuffle)}>
        <ShuffleIcon size={side} />
      </button>
      <button type="button" aria-label="Предыдущий" onClick={() => player.prev()} className={slot(false, true)}>
        <PrevIcon size={skip} />
      </button>
      <PlayPauseButton size={large ? 72 : 40} />
      <button type="button" aria-label="Следующий" onClick={() => player.next()} className={slot(false, true)}>
        <NextIcon size={skip} />
      </button>
      <button
        type="button"
        aria-label={repeat === "one" ? "Повтор трека" : repeat === "all" ? "Повтор очереди" : "Повтор выключен"}
        onClick={() => player.cycleRepeat()}
        className={slot(repeat !== "off")}
      >
        <RepeatIcon size={side} one={repeat === "one"} />
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

export function VolumeControl({ compact = false }: { compact?: boolean }) {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const level = muted ? 0 : volume;
  const box = useRef<HTMLDivElement>(null);

  // Wheel over the control changes volume (non-passive, so the page does not scroll instead).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = usePlayer.getState();
      player.setVolume(Math.min(1, Math.max(0, (s.muted ? 0 : s.volume) - Math.sign(e.deltaY) * 0.05)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const slider = (
    <input
      type="range"
      aria-label="Громкость"
      className={`slider ${compact ? "w-28" : "w-24"}`}
      min={0}
      max={1}
      step={0.01}
      value={level}
      style={{ ["--fill" as string]: `${level * 100}%` }}
      onChange={(e) => player.setVolume(Number(e.target.value))}
    />
  );
  const mute = (
    <button type="button" aria-label={muted ? "Включить звук" : "Выключить звук"} title="Громкость: колесо мыши, M — без звука" onClick={() => player.toggleMute()} className={dockButton()}>
      <VolumeIcon size={18} level={level} />
    </button>
  );
  if (!compact) {
    return (
      <div ref={box} className="flex items-center gap-1">
        {mute}
        {slider}
      </div>
    );
  }
  // Dock: just the icon; the slider floats above it on hover or keyboard focus.
  return (
    <div ref={box} className="group relative">
      {mute}
      <div className="invisible absolute bottom-full left-1/2 z-50 -translate-x-1/2 pb-2 opacity-0 transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <div className="player-surface flex items-center gap-3 rounded-full px-4 py-3">
          {slider}
          <span className="w-8 text-right font-mono text-micro tabular-nums text-text-secondary">{Math.round(level * 100)}</span>
        </div>
      </div>
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

const SLEEP_OPTIONS: { label: string; value: number | "track" }[] = [
  { label: "15 минут", value: 15 },
  { label: "30 минут", value: 30 },
  { label: "45 минут", value: 45 },
  { label: "1 час", value: 60 },
  { label: "До конца трека", value: "track" },
];

/** Sleep timer: the music fades out gently and pauses. Shows the minutes left while it runs. */
export function SleepTimer({ onColor = false }: { onColor?: boolean }) {
  const { endsAt, endOfTrack } = useSleep();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);
  const on = endsAt !== null || endOfTrack;

  useEffect(() => {
    if (!endsAt) return;
    const update = () => setNow(Date.now());
    const first = setTimeout(update, 0);
    const id = setInterval(update, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [endsAt]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const left = endsAt ? Math.max(1, Math.ceil((endsAt - now) / 60_000)) : null;
  const badge = left !== null ? `${left} мин` : endOfTrack ? "трек" : null;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={on ? `Таймер сна: ${badge}` : "Таймер сна"}
        title="Таймер сна"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`relative ${dockButton(on, onColor)}`}
      >
        <MoonIcon size={18} />
        {badge ? (
          <span className="pointer-events-none absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[9px] font-bold leading-4 tabular-nums text-accent-on">
            {left ?? "♪"}
          </span>
        ) : null}
      </button>
      {open ? (
        <div role="menu" aria-label="Таймер сна" className="player-surface reveal absolute bottom-full right-0 z-50 mb-2 w-52 rounded-xl p-1.5 text-text-primary">
          <div className="px-3 pb-1 pt-2 text-micro uppercase tracking-[0.14em] text-text-tertiary">Выключить музыку через</div>
          {SLEEP_OPTIONS.map((o) => {
            const chosen = o.value === "track" ? endOfTrack : false;
            return (
              <button
                key={o.label}
                type="button"
                role="menuitemradio"
                aria-checked={chosen}
                onClick={() => {
                  player.setSleep(o.value);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-body-s hover:bg-fg/8"
              >
                {o.label}
                {chosen ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
              </button>
            );
          })}
          {on ? (
            <button type="button" role="menuitem" onClick={() => { player.setSleep(null); setOpen(false); }} className="mt-1 w-full rounded-lg px-3 py-2 text-left text-body-s text-state-danger hover:bg-fg/8">
              Выключить таймер
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
