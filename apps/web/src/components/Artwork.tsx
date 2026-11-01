"use client";

import type { Artwork as ArtworkData } from "@sonora/api-schema";
import { decode } from "blurhash";
import { useEffect, useMemo, useRef, useState } from "react";
import { artworkSrcSet, artworkUrl } from "@/lib/artwork";

const TONES = ["#FF5A36", "#FFB23F", "#2FE0C8", "#5B6CFF"];

/** Fallback when there is no image: Sonora tones with resonance rings off a seeded centre. */
function Placeholder({ seed }: { seed: string }) {
  const h = [...seed].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const a = TONES[h % 4]!;
  const b = TONES[(h >> 3) % 4 === h % 4 ? (h % 4 + 1) % 4 : (h >> 3) % 4]!;
  const cx = 25 + (h % 50);
  const cy = 25 + ((h >> 5) % 50);
  return (
    <div className="absolute inset-0" style={{ background: `radial-gradient(circle at ${cx}% ${cy}%, ${a}, color-mix(in srgb, ${b} 45%, #0a0908) 75%)` }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        {[14, 24, 34, 46, 60].map((r, i) => (
          <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke="white" strokeOpacity={0.22 - i * 0.035} strokeWidth={i === 0 ? 1.2 : 0.7} />
        ))}
      </svg>
    </div>
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
