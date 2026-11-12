"use client";

import { toast } from "@/components/admin/ui";
import { DislikeIcon } from "@/components/icons";
import { LikeButton } from "@/components/LikeButton";
import { useCurrentTrack, useWaveKind } from "@/components/player/hooks";
import { WaveSettingsButton } from "@/components/wave/WaveSettings";
import { dislikeCurrent } from "@/lib/recommend";

/** «Не нравится» (wave and radios only): the wave learns from it and the next track starts at once. */
export function DislikeButton({ size = 20, className = "" }: { size?: number; className?: string }) {
  const kind = useWaveKind();
  if (!kind) return null;
  return (
    <button
      type="button"
      aria-label="Не нравится"
      title="Не нравится — пропустить и больше не предлагать"
      onClick={() => {
        dislikeCurrent();
        toast("Этот трек больше не попадётся в волне");
      }}
      className={`flex shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-text-primary ${className}`}
    >
      <DislikeIcon size={size} />
    </button>
  );
}

/** The wave's own row in the full-screen player: like, «Не нравится», and tuning for «Моя волна» itself. */
export function WaveActions() {
  const kind = useWaveKind();
  const track = useCurrentTrack();
  if (!kind || !track) return null;
  const slot = "h-11 w-11 bg-fg/8 hover:bg-fg/14";
  return (
    <div role="group" aria-label={kind === "wave" ? "Моя волна" : "Радио"} className="flex items-center gap-2">
      <LikeButton kind="tracks" id={track.id} size={21} className={slot} />
      <DislikeButton size={21} className={slot} />
      {kind === "wave" ? <WaveSettingsButton appearance="icon" className={`${slot} text-text-secondary hover:text-text-primary`} /> : null}
    </div>
  );
}
