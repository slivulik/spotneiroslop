import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { components } from "@sonora/api-schema";

type S = components["schemas"];
const API = process.env.SONORA_API_INTERNAL_URL ?? "http://localhost:8000";

/** Absolute site origin for canonical/OG URLs (set in production; falls back for dev). */
export function siteUrl(): URL {
  return new URL(process.env.SONORA_PUBLIC_URL ?? process.env.SONORA_WEB_BASE_URL ?? "http://localhost:3000");
}

export async function apiGet<T>(p: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${p}`, { next: { revalidate: 300 } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Server-side image fetch: public media URLs are rewritten to the in-cluster storage address. */
export async function imageDataUrl(artwork: S["Artwork"] | null | undefined, size = 600): Promise<string | null> {
  if (!artwork) return null;
  const best = artwork.sizes.find((s) => s >= size) ?? artwork.sizes.at(-1) ?? size;
  let url = artwork.url_template.replace("{size}", String(best)).replace("{format}", "jpg");
  const pub = process.env.SONORA_MEDIA_BASE_URL;
  const internal = process.env.SONORA_MEDIA_INTERNAL_URL;
  if (pub && internal && url.startsWith(pub)) url = internal + url.slice(pub.length);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${r.headers.get("content-type") ?? "image/jpeg"};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

let fonts: { name: string; data: ArrayBuffer; weight: 500 | 700; style: "normal" }[] | null = null;

/** Static WOFF fonts (the OG renderer can't read woff2), Cyrillic + Latin. */
export async function ogFonts() {
  if (fonts) return fonts;
  const base = path.join(process.cwd(), "assets", "fonts");
  const load = async (_family: string, file: string) => {
    const b = await readFile(path.join(base, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  fonts = [
    { name: "Unbounded", data: await load("unbounded", "unbounded-cyrillic-700-normal.woff"), weight: 700, style: "normal" },
    { name: "UnboundedLatin", data: await load("unbounded", "unbounded-latin-700-normal.woff"), weight: 700, style: "normal" },
    { name: "Onest", data: await load("onest", "onest-cyrillic-500-normal.woff"), weight: 500, style: "normal" },
    { name: "OnestLatin", data: await load("onest", "onest-latin-500-normal.woff"), weight: 500, style: "normal" },
  ];
  return fonts;
}

export interface ShareCard {
  kicker: string;
  title: string;
  subtitle: string;
  artwork: S["Artwork"] | null | undefined;
  round?: boolean;
}

/** What a share link shows: resolved from the public API (only published, public content). */
export async function shareCard(kind: string, id: string): Promise<ShareCard | null> {
  if (kind === "album") {
    const r = await apiGet<S["ReleaseOut"]>(`/v1/releases/${id}`);
    return r && { kicker: r.type === "single" ? "Сингл" : r.type === "ep" ? "EP" : "Альбом", title: r.title, subtitle: r.artists.map((a) => a.name).join(", "), artwork: r.artwork };
  }
  if (kind === "artist") {
    const a = await apiGet<S["ArtistOut"]>(`/v1/artists/${id}`);
    return a && { kicker: "Артист", title: a.name, subtitle: a.monthly_listeners ? `${a.monthly_listeners.toLocaleString("ru-RU")} слушателей за месяц` : "Слушайте в Sonora", artwork: a.artwork, round: true };
  }
  if (kind === "playlist") {
    const p = await apiGet<S["PlaylistOut"]>(`/v1/playlists/${id}`);
    return p && { kicker: p.type === "editorial" ? "Подборка" : "Плейлист", title: p.title, subtitle: `${p.owner_name ?? "Sonora"} · ${p.track_count} треков`, artwork: p.artwork ?? p.mosaic[0] };
  }
  if (kind === "track") {
    const t = await apiGet<S["TrackOut"]>(`/v1/tracks/${id}`);
    return t && { kicker: "Трек", title: t.title, subtitle: `${t.artists.map((a) => a.name).join(", ")} · ${t.release.title}`, artwork: t.release.artwork };
  }
  return null;
}

/** Shared generateMetadata body for album/artist/playlist/track pages. */
export async function shareMetadata(kind: string, id: string, pagePath: string) {
  const card = await shareCard(kind, id);
  if (!card) return { title: "Sonora" };
  const description = `${card.kicker} · ${card.subtitle} — слушайте в Sonora`;
  const image = `/og/${kind}/${id}`;
  return {
    title: card.title,
    description,
    metadataBase: siteUrl(),
    alternates: { canonical: pagePath },
    openGraph: { type: kind === "artist" ? "profile" : "music.album", title: card.title, description, url: pagePath, siteName: "Sonora", locale: "ru_RU", images: [{ url: image, width: 1200, height: 630, alt: card.title }] },
    twitter: { card: "summary_large_image", title: card.title, description, images: [image] },
  };
}
