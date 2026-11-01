"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Every user preference of the web client. Persisted locally; synced to the account via /v1/me/settings. */
export interface Settings {
  theme: "dark" | "light" | "system";
  accent: "default" | "dynamic" | "custom";
  customAccent: string;
  density: "standard" | "compact";
  motion: "system" | "full" | "reduced";
  progressStyle: "line" | "wave";
  preloadNext: boolean;
  cacheMb: number;
  set: (patch: Partial<Omit<Settings, "set">>) => void;
}

export const DEFAULT_SETTINGS = {
  theme: "dark",
  accent: "default",
  customAccent: "#7352F5",
  density: "standard",
  motion: "system",
  progressStyle: "line",
  preloadNext: true,
  cacheMb: 160,
} as const satisfies Omit<Settings, "set">;

export const SETTINGS_KEY = "sonora-settings";

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
    }),
    { name: SETTINGS_KEY, version: 1 },
  ),
);
