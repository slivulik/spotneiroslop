"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { type Settings, useSettings } from "@/lib/settings";
import { player } from "@/player/controller";
import { type RequestedQuality, usePlayer } from "@/player/store";

type Synced = Pick<Settings, "theme" | "accent" | "customAccent" | "density" | "motion" | "progressStyle" | "preloadNext" | "eqEnabled" | "eqPreset" | "eqBands" | "eqPreamp" | "eqCustom">;

/** Preferences that follow the account; sidebar state and cache size stay per device. */
const SYNCED = ["theme", "accent", "customAccent", "density", "motion", "progressStyle", "preloadNext", "eqEnabled", "eqPreset", "eqBands", "eqPreamp", "eqCustom"] as const satisfies (keyof Settings)[];

function toServer(s: Synced, quality: RequestedQuality, normalization: string) {
  return {
    appearance: {
      theme: s.theme,
      accent: s.accent,
      custom_accent: s.customAccent,
      density: s.density,
      motion: s.motion,
      progress_style: s.progressStyle,
      preload_next: s.preloadNext,
    },
    equalizer: { enabled: s.eqEnabled, preset: s.eqPreset.slice(0, 32), bands: s.eqBands, preamp: s.eqPreamp, custom_presets: s.eqCustom },
    audio: { quality_wifi: quality, normalization },
  };
}

/**
 * Keeps preferences in step with the account (web ↔ Android): on sign-in the server copy is
 * applied, then local changes are pushed (debounced). Last write wins — preferences are
 * independent values, so there is nothing to merge.
 */
export function SettingsSync() {
  const authed = useSession((s) => s.status === "authenticated");
  const applying = useRef(false);
  const loaded = useRef(false);
  const eqEnabled = useSettings((s) => s.eqEnabled);
  const eqBands = useSettings((s) => s.eqBands);
  const eqPreamp = useSettings((s) => s.eqPreamp);
  const preloadNext = useSettings((s) => s.preloadNext);

  // Settings drive the audio engine whether or not the user is signed in.
  useEffect(() => player.setEqualizer({ enabled: eqEnabled, bands: eqBands, preamp: eqPreamp }), [eqEnabled, eqBands, eqPreamp]);
  useEffect(() => player.setPreloadNext(preloadNext), [preloadNext]);

  useEffect(() => {
    if (!authed) {
      loaded.current = false;
      return;
    }
    let cancelled = false;
    const body = () => {
      const p = usePlayer.getState();
      return toServer(useSettings.getState(), p.quality, p.normalization) as never;
    };
    const flush = async () => {
      const { error } = await api.PATCH("/v1/me/settings", { body: body() });
      if (!error) {
        applying.current = true;
        useSettings.getState().set({ syncPending: false });
        applying.current = false;
      }
    };
    void (async () => {
      if (useSettings.getState().syncPending) {
        // Changes made before a reload/offline haven't reached the server: they win.
        await flush();
      } else {
        const { data } = await api.GET("/v1/me/settings");
        if (cancelled || !data) return;
        applying.current = true;
        const a = data.appearance;
        const eq = data.equalizer;
        useSettings.getState().set({
          ...(a ? { theme: a.theme, accent: a.accent, customAccent: a.custom_accent, density: a.density, motion: a.motion, progressStyle: a.progress_style, preloadNext: a.preload_next } : {}),
          ...(eq ? { eqEnabled: eq.enabled, eqPreset: eq.preset, eqBands: eq.bands, eqPreamp: eq.preamp, eqCustom: eq.custom_presets ?? [] } : {}),
        });
        if (data.audio) usePlayer.getState().patch({ quality: data.audio.quality_wifi as RequestedQuality, normalization: data.audio.normalization as never });
        applying.current = false;
      }
      loaded.current = true;
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const push = () => {
      if (applying.current) return;
      if (!useSettings.getState().syncPending) {
        applying.current = true;
        useSettings.getState().set({ syncPending: true });
        applying.current = false;
      }
      if (!loaded.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), 700);
    };
    // Leaving the page: send what's pending even if the debounce hasn't fired.
    const onHide = () => {
      if (!useSettings.getState().syncPending || !loaded.current) return;
      clearTimeout(timer);
      void flush();
    };
    window.addEventListener("pagehide", onHide);
    const offSettings = useSettings.subscribe((state, prev) => {
      if (SYNCED.some((k) => state[k] !== prev[k])) push();
    });
    const offPlayer = usePlayer.subscribe((s, prev) => {
      if (s.quality !== prev.quality || s.normalization !== prev.normalization) push();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("pagehide", onHide);
      offSettings();
      offPlayer();
    };
  }, [authed]);

  return null;
}
