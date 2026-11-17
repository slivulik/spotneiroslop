"use client";

import { current } from "@/player/queue";
import { usePlayer } from "@/player/store";

export function useCurrentTrack() {
  return usePlayer((s) => (s.queue ? current(s.queue) : null));
}

export function useIsPlaying() {
  return usePlayer((s) => s.status === "playing" || s.status === "buffering" || s.status === "loading");
}

/** «Моя волна» ("wave"), a radio from a track / artist ("radio") — both wave sessions — or neither. */
export function useWaveKind(): "wave" | "radio" | null {
  return usePlayer((s) => (s.context?.type === "wave" ? (s.context.id ? "radio" : "wave") : null));
}
