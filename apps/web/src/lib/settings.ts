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
  sidebarCollapsed: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  eqBands: number[];
  eqPreamp: number;
  eqCustom: { name: string; bands: number[]; preamp: number }[];
  /** Local changes not yet acknowledged by the server (survives reloads; local wins on sign-in). */
  syncPending: boolean;
  set: (patch: Partial<Omit<Settings, "set">>) => void;
}

export const DEFAULT_SETTINGS: Omit<Settings, "set"> = {
  theme: "dark",
  accent: "default",
  customAccent: "#7352F5",
  density: "standard",
  motion: "system",
  progressStyle: "line",
  preloadNext: true,
  cacheMb: 160,
  sidebarCollapsed: false,
  eqEnabled: false,
  eqPreset: "flat",
  eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  eqPreamp: 0,
  eqCustom: [],
  syncPending: false,
};

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
