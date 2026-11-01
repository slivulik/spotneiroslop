"use client";

/**
 * Session-scoped cache of HLS segments (init + media) so seeking back, replaying and switching
 * between recent tracks never re-downloads audio.
 *
 * Why the app needs its own cache: segment links are signed per playlist fetch, so the same bytes
 * arrive under a different URL every time and the HTTP cache cannot help; and browsers cap the MSE
 * audio buffer (Chrome ≈ 12 MB, about 90 s of lossless), evicting what was already played.
 *
 * Identity is the storage object path (bucket/track-prefix/quality/segment): the prefix contains
 * the upload job id, so a re-encoded track gets new keys, and qualities never mix.
 */
import type { HlsConfig, Loader, LoaderCallbacks, LoaderConfiguration, LoaderContext } from "hls.js";

const DEFAULT_MAX_BYTES = 160 * 1024 * 1024;

export interface CacheStats {
  hits: number;
  misses: number;
  bytes: number;
  entries: number;
  maxBytes: number;
}

class SegmentCache {
  private readonly map = new Map<string, ArrayBuffer>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  maxBytes = DEFAULT_MAX_BYTES;

  get(key: string): ArrayBuffer | undefined {
    const hit = this.map.get(key);
    if (!hit) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    // LRU: re-insert to mark as most recently used.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  put(key: string, data: ArrayBuffer): void {
    if (data.byteLength === 0 || data.byteLength > this.maxBytes / 4) return;
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.byteLength;
      this.map.delete(key);
    }
    this.map.set(key, data);
    this.bytes += data.byteLength;
    this.evict();
  }

  setLimit(maxBytes: number): void {
    this.maxBytes = Math.max(16 * 1024 * 1024, maxBytes);
    this.evict();
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, bytes: this.bytes, entries: this.map.size, maxBytes: this.maxBytes };
  }

  private evict(): void {
    for (const [key, value] of this.map) {
      if (this.bytes <= this.maxBytes) break;
      this.map.delete(key);
      this.bytes -= value.byteLength;
    }
  }
}

export const segmentCache = new SegmentCache();

if (typeof window !== "undefined") {
  // Read-only window into the cache for diagnostics and end-to-end tests.
  (window as unknown as { __sonoraCache?: () => CacheStats }).__sonoraCache = () => segmentCache.stats();
}

/**
 * Stable cache key of a segment URL. Direct storage links key on their path (signature dropped);
 * legacy `/v1/stream/<token>/<path>` links key on track id + path (the token changes per fetch).
 */
export function segmentKey(url: string, trackId: string): string {
  const parsed = new URL(url, typeof location === "undefined" ? "http://localhost" : location.href);
  const legacy = parsed.pathname.match(/\/v1\/stream\/[^/]+\/(.+)$/);
  return legacy ? `${trackId}/${legacy[1]}` : parsed.pathname;
}

type LoaderClass = new (config: HlsConfig) => Loader<LoaderContext>;

/** Wrap hls.js's default loader: answer from the cache when possible, fill it otherwise. */
export function cachingLoader(Base: LoaderClass, trackId: string): LoaderClass {
  return class CachingLoader extends (Base as new (config: HlsConfig) => Loader<LoaderContext>) {
    load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
      const key = segmentKey(context.url, trackId);
      const hit = segmentCache.get(key);
      if (hit) {
        const now = performance.now();
        const stats = this.stats;
        stats.loading.start = stats.loading.first = now;
        stats.loading.end = now + 1;
        stats.loaded = stats.total = hit.byteLength;
        // hls.js may transfer the buffer to its worker (detaching it): hand out a copy.
        callbacks.onSuccess({ url: context.url, data: hit.slice(0) }, stats, context, null);
        return;
      }
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, ctx, networkDetails) => {
          if (response.data instanceof ArrayBuffer) segmentCache.put(key, response.data.slice(0));
          callbacks.onSuccess(response, stats, ctx, networkDetails);
        },
      });
    }
  };
}

/** Fetch a segment into the cache ahead of time (next-track preload). */
export async function warmSegment(url: string, trackId: string, signal?: AbortSignal): Promise<void> {
  const key = segmentKey(url, trackId);
  if (segmentCache.has(key)) return;
  const response = await fetch(url, { signal });
  if (!response.ok) return;
  segmentCache.put(key, await response.arrayBuffer());
}
