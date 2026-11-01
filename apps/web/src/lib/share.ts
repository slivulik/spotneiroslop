"use client";

import { toast } from "@/components/admin/ui";

/** Absolute link to a page of this site (works behind any host/port). */
export function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

/**
 * Share a page: the system share sheet where the browser has one (phones), otherwise copy the
 * link. The page's Open Graph tags make the link unfurl into a card in messengers.
 */
export async function share(path: string, title: string, text?: string): Promise<void> {
  const url = absoluteUrl(path);
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
  if (nav.share && (!nav.canShare || nav.canShare({ url, title }))) {
    try {
      await nav.share({ url, title, text });
      return;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
    }
  }
  await copyLink(path);
}

export async function copyLink(path: string): Promise<void> {
  const url = absoluteUrl(path);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Plain-http origins have no async clipboard: fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("Ссылка скопирована");
}
