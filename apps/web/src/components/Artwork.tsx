"use client";

import type { Artwork as ArtworkData } from "@sonora/api-schema";
import { decode } from "blurhash";
import { useEffect, useMemo, useRef, useState } from "react";
import { artworkSrcSet, artworkUrl } from "@/lib/artwork";

/** Fallback when a release has no cover: a gradient from the brand wave colours. */
function Placeholder({ seed }: { seed: string }) {
  const hue = [...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <div
      className="absolute inset-0"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 38%), hsl(${(hue + 60) % 360} 70% 22%))` }}
    />
  );
}

function BlurhashCanvas({ hash }: { hash: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    try {
      const pixels = decode(hash, 32, 32);
      const image = ctx.createImageData(32, 32);
      image.data.set(pixels);
      ctx.putImageData(image, 0, 0);
    } catch {
      // Invalid hash: keep the dominant-colour background.
    }
  }, [hash]);
  return <canvas ref={ref} width={32} height={32} className="absolute inset-0 h-full w-full" aria-hidden />;
}

interface ArtworkProps {
  artwork: ArtworkData | null | undefined;
  alt: string;
  /** CSS size hint for srcset selection, e.g. "(min-width: 900px) 220px, 45vw". */
  sizes: string;
  className?: string;
  priority?: boolean;
  seed?: string;
}

export function Artwork({ artwork, alt, sizes, className = "", priority = false, seed = alt }: ArtworkProps) {
  const [loaded, setLoaded] = useState(false);
  const sources = useMemo(
    () => (artwork ? { avif: artworkSrcSet(artwork, "avif"), webp: artworkSrcSet(artwork, "webp") } : null),
    [artwork],
  );
  return (
    <div
      className={`relative overflow-hidden bg-bg-raised ${className}`}
      style={{ backgroundColor: artwork?.palette?.dominant ?? undefined }}
    >
      {!artwork ? <Placeholder seed={seed} /> : null}
      {artwork?.blurhash && !loaded ? <BlurhashCanvas hash={artwork.blurhash} /> : null}
      {artwork && sources ? (
        <picture>
          <source type="image/avif" srcSet={sources.avif} sizes={sizes} />
          <source type="image/webp" srcSet={sources.webp} sizes={sizes} />
          <img
            src={artworkUrl(artwork, 640, "jpg")}
            alt={alt}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[var(--sonora-duration-slow)] ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        </picture>
      ) : null}
    </div>
  );
}
