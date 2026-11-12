"use client";

import { useRef, useState } from "react";
import { toast } from "@/components/admin/ui";
import { Artwork } from "@/components/Artwork";
import { PauseIcon, PlayIcon } from "@/components/icons";
import { useCurrentTrack, useIsPlaying, useWaveKind } from "@/components/player/hooks";
import { WaveField } from "@/components/visual/WaveField";
import { WaveSettingsButton } from "@/components/wave/WaveSettings";
import { useAppliedTheme, useReducedMotion } from "@/lib/media";
import { playWave } from "@/lib/recommend";
import { useSettings } from "@/lib/settings";
import { waveSummary } from "@/lib/wave";
import { player } from "@/player/controller";

/** What the wave is playing right now; opens the full-screen player. */
function NowOnWave() {
  const track = useCurrentTrack();
  const playing = useIsPlaying();
  if (!track) return null;
  const artists = track.artists.map((a) => a.name).join(", ");
  return (
    <button
      type="button"
      onClick={() => player.setNowPlaying(true)}
      aria-label={`Сейчас играет: ${track.title} — ${artists}. Открыть плеер`}
      className="group flex max-w-full items-center gap-3 rounded-full py-1 pl-1 pr-4 text-left transition-colors hover:bg-fg/8"
    >
      <Artwork artwork={track.release.artwork} alt="" sizes="40px" className="h-10 w-10 shrink-0 rounded-full" />
      <span className="min-w-0">
        <span className="block truncate text-body font-semibold">{track.title}</span>
        <span className="block truncate text-caption text-text-secondary">{artists}</span>
      </span>
      {playing ? (
        <span className="ml-1 flex h-3.5 shrink-0 items-end gap-[2px]" aria-hidden>
          {[0, 0.2, 0.4].map((delay) => (
            <span key={delay} className="eq-bar h-full w-[3px] rounded-sm bg-accent" style={{ animationDelay: `${delay}s` }} />
          ))}
        </span>
      ) : null}
    </button>
  );
}

/**
 * «Моя волна» — the front door of the home page. A field of resonance rings radiates from the
 * play button in the colours of the current cover: breathing slowly at rest, moving with the real
 * spectrum (and ringing out on the beat) while the wave plays. Tuning lives behind «Настроить».
 */
export function WaveHero() {
  const kind = useWaveKind();
  const isWave = kind === "wave";
  const playing = useIsPlaying();
  const active = isWave && playing;
  const palette = useCurrentTrack()?.release.artwork?.palette;
  const still = useReducedMotion();
  const theme = useAppliedTheme();
  const summary = useSettings((s) => waveSummary(s.wave));
  const [starting, setStarting] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  const onPlay = async () => {
    if (isWave) return player.toggle();
    if (starting) return;
    setStarting(true);
    const ok = await playWave();
    setStarting(false);
    if (!ok) toast("Волна не запустилась. Попробуйте ещё раз", "error");
  };

  return (
    <section aria-labelledby="wave-title" className="relative isolate -mx-4 md:-mx-10">
      <WaveField
        anchor={anchor}
        colors={[palette?.vibrant ?? palette?.dominant ?? null, palette?.accent ?? palette?.dominant ?? null, palette?.dominant ?? palette?.muted_dark ?? null]}
        live={active}
        still={still}
        theme={theme}
        className="wave-field absolute inset-0 -z-10 h-full w-full"
      />
      {/* The button's place never depends on the text beside/below it, so the rings stay centred on it. */}
      <div className="flex min-h-[460px] flex-col items-center gap-7 px-6 pb-10 pt-14 text-center md:flex-row md:gap-14 md:px-10 md:py-12 md:text-left lg:pl-[clamp(56px,8vw,148px)]">
        <button
          ref={anchor}
          type="button"
          data-ripple
          onClick={() => void onPlay()}
          aria-label={active ? "Моя волна — пауза" : "Моя волна — слушать"}
          aria-busy={starting}
          className="no-press relative flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-full bg-text-primary text-bg-base shadow-[0_24px_60px_-20px_rgba(0,0,0,.65)] transition-transform duration-300 ease-standard hover:scale-[1.04] active:scale-95 md:h-[120px] md:w-[120px]"
        >
          {active ? <PauseIcon size={40} /> : <PlayIcon size={42} style={{ marginLeft: 5 }} />}
          {starting ? <span className="absolute -inset-2 animate-spin rounded-full border-2 border-transparent border-t-text-primary" aria-hidden /> : null}
        </button>
        <div className="flex min-w-0 max-w-xl flex-col items-center gap-5 md:items-start">
          <div>
            <h1 id="wave-title" className="font-display text-[clamp(44px,7vw,88px)] font-bold leading-[0.95] tracking-[-0.045em]">
              Моя волна
            </h1>
            <p className="mt-3 text-balance text-body-l text-text-secondary">{summary ? `Настроена: ${summary}` : "Бесконечный поток музыки под ваш вкус"}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
            <WaveSettingsButton />
          </div>
          {isWave ? <NowOnWave /> : null}
        </div>
      </div>
    </section>
  );
}
