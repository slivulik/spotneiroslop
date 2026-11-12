"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useSettings } from "@/lib/settings";

/** Live result of a CSS media query (`serverValue` during SSR and hydration). */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}

/** Motion off when the app setting says so, or when it follows a system that asks for less motion. */
export function useReducedMotion(): boolean {
  const setting = useSettings((s) => s.motion);
  const system = useMediaQuery("(prefers-reduced-motion: reduce)");
  return setting === "reduced" || (setting === "system" && system);
}

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** The theme actually applied to the page (ThemeController resolves "system"). */
export function useAppliedTheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeTheme, () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"), () => "dark");
}

/** Phone-sized layout (below the `md` breakpoint, 900 px). */
export function useIsPhone(): boolean {
  return useMediaQuery("(max-width: 899.98px)");
}
