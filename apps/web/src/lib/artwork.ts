import type { Artwork } from "@sonora/api-schema";

export type ImageFormat = "avif" | "webp" | "jpg";

export function artworkUrl(artwork: Artwork, size: number, format: ImageFormat = "webp"): string {
  const best = artwork.sizes.find((s) => s >= size) ?? artwork.sizes.at(-1) ?? size;
  return artwork.url_template.replace("{size}", String(best)).replace("{format}", format);
}

/** srcset over every rendition up to `maxSize`, for one format. */
export function artworkSrcSet(artwork: Artwork, format: ImageFormat, maxSize = 1200): string {
  return artwork.sizes
    .filter((s) => s <= maxSize)
    .map((s) => `${artwork.url_template.replace("{size}", String(s)).replace("{format}", format)} ${s}w`)
    .join(", ");
}
