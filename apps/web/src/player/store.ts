"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { NormalizationMode } from "@/player/gain";
import { type PlayerEvent, type PlayerStatus, transition } from "@/player/machine";
import type { PlayContext, Queue } from "@/player/queue";

export type RequestedQuality = "auto" | "hires" | "lossless" | "high" | "normal" | "low";

export interface PlayerState {
  queue: Queue | null;
  context: PlayContext | null;
  status: PlayerStatus;
  error: string | null;
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  volume: number;
  muted: boolean;
  quality: RequestedQuality;
  /** What the current stream actually delivers (after clamping). */
  activeQuality: string | null;
  /** Real waveform peaks (0–255) of the current track, when analysed. */
  waveform: number[] | null;
  normalization: NormalizationMode;
  nowPlayingOpen: boolean;
  dispatch: (event: PlayerEvent) => void;
  patch: (partial: Partial<PlayerState>) => void;
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set) => ({
      queue: null,
      context: null,
      status: "idle",
      error: null,
      positionMs: 0,
      durationMs: 0,
      bufferedMs: 0,
      volume: 0.9,
      muted: false,
      quality: "auto",
      activeQuality: null,
      waveform: null,
      normalization: "auto",
      nowPlayingOpen: false,
      dispatch: (event) =>
        set((s) => {
          const status = transition(s.status, event);
          return status === s.status ? s : { status, error: status === "error" ? s.error : null };
        }),
      patch: (partial) => set(partial),
    }),
    {
      name: "sonora-player",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Position is saved separately (throttled); transient playback state is never restored.
      partialize: (s) => ({
        queue: s.queue,
        context: s.context,
        volume: s.volume,
        muted: s.muted,
        quality: s.quality,
        normalization: s.normalization,
      }),
    },
  ),
);

const POSITION_KEY = "sonora-player-position";

export function saveResumePosition(trackId: string, positionMs: number): void {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ trackId, positionMs: Math.floor(positionMs) }));
  } catch {
    // Storage full or disabled: resuming is a nicety, not a requirement.
  }
}

export function readResumePosition(trackId: string): number {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null") as {
      trackId: string;
      positionMs: number;
    } | null;
    return saved?.trackId === trackId ? saved.positionMs : 0;
  } catch {
    return 0;
  }
}
