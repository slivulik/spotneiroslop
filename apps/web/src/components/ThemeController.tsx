"use client";

import { MotionConfig } from "motion/react";
import { useEffect, useSyncExternalStore } from "react";
import { useCurrentTrack } from "@/components/player/hooks";
import { useSettings } from "@/lib/settings";
import { accentFor, type ThemeName } from "@/lib/theme";
import { segmentCache } from "@/player/segmentCache";

const ACCENT_VARS = ["default", "hover", "pressed", "muted", "on"] as const;

function subscribeScheme(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Applies appearance settings to <html>: theme, accent (default / from artwork / custom), density, motion. */
export function ThemeController({ children }: { children: React.ReactNode }) {
  const { theme, accent, customAccent, density, motion, cacheMb } = useSettings();
  const systemLight = useSyncExternalStore(subscribeScheme, () => window.matchMedia("(prefers-color-scheme: light)").matches, () => false);
  const resolved: ThemeName = theme === "system" ? (systemLight ? "light" : "dark") : theme;
  const vibrant = useCurrentTrack()?.release.artwork?.palette?.vibrant ?? null;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.density = density;
    root.dataset.motion = motion === "reduced" ? "reduced" : "auto";
    root.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", resolved === "light" ? "#F6F5FA" : "#0B0A10");
  }, [resolved, density, motion]);

  useEffect(() => {
    const root = document.documentElement.style;
    const source = accent === "custom" ? customAccent : accent === "dynamic" ? vibrant : null;
    const set = source ? accentFor(source, resolved) : null;
    for (const key of ACCENT_VARS) {
      if (set) root.setProperty(`--sonora-color-accent-${key}`, set[key]);
      else root.removeProperty(`--sonora-color-accent-${key}`);
    }
    if (set) root.setProperty("--sonora-color-wave-a", set.hover);
    else root.removeProperty("--sonora-color-wave-a");
  }, [accent, customAccent, vibrant, resolved]);

  useEffect(() => segmentCache.setLimit(cacheMb * 1024 * 1024), [cacheMb]);

  return <MotionConfig reducedMotion={motion === "reduced" ? "always" : motion === "full" ? "never" : "user"}>{children}</MotionConfig>;
}
