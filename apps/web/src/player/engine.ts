"use client";

/**
 * Imperative playback engine: one <audio> element, hls.js where MSE is available (native HLS on
 * Safari/iOS), and a Web Audio gain node for loudness normalisation. It knows nothing about
 * queues; the controller tells it what to load and reacts to its callbacks.
 */
import type Hls from "hls.js";
import type { ErrorData } from "hls.js";
import type { StreamOut } from "@sonora/api-schema";
import { api } from "@/lib/api";
import type { PlayerEvent } from "@/player/machine";
import type { RequestedQuality } from "@/player/store";
import { cachingLoader, warmSegment } from "@/player/segmentCache";

type Quality = Exclude<RequestedQuality, "auto">;

/** Centre frequencies of the 10-band equaliser (Hz), the same bands Android uses. */
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export interface Equalizer {
  enabled: boolean;
  /** dB, −12…12, one per EQ_FREQUENCIES entry. */
  bands: number[];
  preamp: number;
}
const ORDER: Quality[] = ["hires", "lossless", "high", "normal", "low"];
const MSE_CODECS: Record<string, string[]> = {
  flac: ['audio/mp4; codecs="flac"', 'audio/mp4; codecs="fLaC"'],
  aac: ['audio/mp4; codecs="mp4a.40.2"'],
  "he-aac": ['audio/mp4; codecs="mp4a.40.5"'],
  mp3: ['audio/mp4; codecs="mp4a.40.34"', 'audio/mp4; codecs="mp3"'],
};

/** Can this browser decode a rendition's codec on the path we play it (MSE or native HLS)? */
export function canDecode(codec: string): boolean {
  if (typeof window === "undefined") return true;
  const types = MSE_CODECS[codec] ?? [];
  const ms = (window as unknown as { MediaSource?: typeof MediaSource; ManagedMediaSource?: typeof MediaSource }).MediaSource
    ?? (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource;
  if (ms?.isTypeSupported) return types.some((t) => ms.isTypeSupported(t));
  // Native HLS (iOS without MSE): Safari plays FLAC and AAC in fMP4.
  return codec !== "mp3" || document.createElement("audio").canPlayType("audio/mpeg") !== "";
}

/** Best decodable quality at or below `wanted` among a track's renditions. */
export function decodableQuality(wanted: Quality, renditions: { quality: string; codec: string }[]): Quality | null {
  const available = new Map(renditions.map((r) => [r.quality, r.codec]));
  for (const q of ORDER.slice(ORDER.indexOf(wanted))) {
    const codec = available.get(q);
    if (codec && canDecode(codec)) return q;
  }
  return null;
}

/** Quality folder of a media playlist URL (…/high/playlist.m3u8 → high). */
function qualityOf(url: string): Quality | null {
  const m = url.match(/\/(hires|lossless|high|normal|low)\/playlist\.m3u8/);
  return (m?.[1] as Quality | undefined) ?? null;
}

/** Only one Sonora tab plays at a time: starting playback pauses the others. */
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("sonora-player");
const TAB_ID = Math.random().toString(36).slice(2);

export interface EngineCallbacks {
  onEvent: (event: PlayerEvent) => void;
  onProgress: (positionMs: number, durationMs: number, bufferedMs: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
  onStream: (stream: StreamOut) => void;
}

export interface LoadOptions {
  autoplay: boolean;
  startAtMs: number;
  quality: RequestedQuality;
  gain: (stream: StreamOut) => number;
}

/** Stream URLs live ≥ 1 h; refetch well before that. */
const STREAM_CACHE_MS = 30 * 60 * 1000;

export class StreamError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchStream(trackId: string, quality: RequestedQuality): Promise<StreamOut> {
  const { data, error, response } = await api.GET("/v1/tracks/{track_id}/stream", {
    params: { path: { track_id: trackId }, query: { quality } },
  });
  if (!data) {
    const detail = (error as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new StreamError(detail?.code ?? `http_${response.status}`, detail?.message ?? "Не удалось начать воспроизведение");
  }
  return data;
}

export class PlayerEngine {
  readonly audio: HTMLAudioElement;
  private hls: Hls | null = null;
  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private preamp: GainNode | null = null;
  private bands: BiquadFilterNode[] = [];
  private eq: Equalizer = { enabled: false, bands: Array(10).fill(0), preamp: 0 };
  private spectrum: Uint8Array<ArrayBuffer> | null = null;
  private generation = 0;
  private current: { trackId: string; opts: LoadOptions; stream: StreamOut } | null = null;
  private readonly cache = new Map<string, { stream: StreamOut; at: number }>();
  private recoveries = 0;
  private waitingOnline = false;

  /** Resolves true when the browser is back online, false if another track took over meanwhile. */
  private untilOnline(generation: number): Promise<boolean> {
    return new Promise((resolve) => {
      const done = () => {
        window.removeEventListener("online", done);
        clearInterval(poll);
        resolve(generation === this.generation);
      };
      const poll = setInterval(() => (navigator.onLine || generation !== this.generation) && done(), 2000);
      window.addEventListener("online", done);
    });
  }
  /** hls.js/MSE (true) or native HLS (false); decided once per browser. */
  private mse: boolean | null = null;
  /** Quality hls.js last settled on: the next track starts there instead of probing bandwidth. */
  private lastLevel: Quality | null = null;
  private preloading: AbortController | null = null;

  /** Diagnostics for tests and support (`window.__sonoraPlayback()`), read-only. */
  playbackSnapshot() {
    const a = this.audio;
    return { paused: a.paused, currentTime: a.currentTime, readyState: a.readyState, error: a.error?.code ?? null, instances: PlayerEngine.instances };
  }

  static instances = 0;

  constructor(private readonly cb: EngineCallbacks) {
    PlayerEngine.instances += 1;
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    this.audio = audio;
    audio.addEventListener("playing", () => {
      cb.onEvent({ type: "PLAYING" });
      channel?.postMessage({ type: "playing", tab: TAB_ID });
    });
    channel?.addEventListener("message", (e: MessageEvent<{ type: string; tab: string }>) => {
      if (e.data?.type === "playing" && e.data.tab !== TAB_ID && !audio.paused) audio.pause();
    });
    audio.addEventListener("waiting", () => cb.onEvent({ type: "WAITING" }));
    audio.addEventListener("pause", () => {
      if (!audio.ended) cb.onEvent({ type: "PAUSE" });
    });
    audio.addEventListener("canplay", () => cb.onEvent({ type: "READY" }));
    audio.addEventListener("ended", () => {
      cb.onEvent({ type: "ENDED" });
      cb.onEnded();
    });
    audio.addEventListener("timeupdate", () => this.reportProgress());
    audio.addEventListener("progress", () => this.reportProgress());
    audio.addEventListener("error", () => {
      if (!this.hls) cb.onError("Ошибка воспроизведения");
    });
  }

  private reportProgress(): void {
    const a = this.audio;
    const buffered = a.buffered.length ? a.buffered.end(a.buffered.length - 1) : 0;
    const duration = Number.isFinite(a.duration) ? a.duration * 1000 : (this.current?.stream.duration_ms ?? 0);
    this.cb.onProgress(a.currentTime * 1000, duration, buffered * 1000);
  }

  private async stream(trackId: string, quality: RequestedQuality, fresh = false): Promise<StreamOut> {
    const key = `${trackId}:${quality}`;
    const hit = this.cache.get(key);
    if (!fresh && hit && Date.now() - hit.at < STREAM_CACHE_MS) return hit.stream;
    let stream = await fetchStream(trackId, quality);
    // The browser may not decode every codec (e.g. FLAC in MP4 on older engines): step down.
    if (stream.quality !== "auto" && stream.codec && !canDecode(stream.codec)) {
      const fallback = decodableQuality(stream.quality as Quality, stream.renditions ?? []);
      if (fallback && fallback !== stream.quality) stream = await fetchStream(trackId, fallback);
    }
    this.cache.set(key, { stream, at: Date.now() });
    return stream;
  }

  /**
   * Warm the next track: its stream link, media playlist, init segment and first media segments
   * go into the segment cache, so pressing "next" (or gapless advance) starts from memory.
   */
  prefetch(trackId: string, quality: RequestedQuality): void {
    this.preloading?.abort();
    const controller = new AbortController();
    this.preloading = controller;
    void (async () => {
      const stream = await this.stream(trackId, quality);
      if (!this.mse || controller.signal.aborted) return;
      const level = stream.quality === "auto" ? (this.lastLevel ?? (stream.qualities.at(-1) as Quality | undefined)) : null;
      const playlistUrl = level ? stream.url.replace(/master\.m3u8$/, `${level}/playlist.m3u8`) : stream.url;
      const text = await (await fetch(playlistUrl, { signal: controller.signal })).text();
      const init = text.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1];
      const segments = text.split("\n").filter((l) => l && !l.startsWith("#")).slice(0, 2);
      for (const url of [init, ...segments].filter(Boolean) as string[]) {
        if (controller.signal.aborted) return;
        await warmSegment(new URL(url, new URL(playlistUrl, location.href)).href, trackId, controller.signal);
      }
    })().catch(() => undefined);
  }

  async load(trackId: string, opts: LoadOptions): Promise<void> {
    const generation = ++this.generation;
    this.cb.onEvent({ type: "LOAD" });
    this.recoveries = 0;
    let stream: StreamOut;
    try {
      stream = await this.stream(trackId, opts.quality);
    } catch (error) {
      if (generation === this.generation) this.cb.onError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (generation !== this.generation) return; // a newer load superseded this one
    this.current = { trackId, opts, stream };
    this.cb.onStream(stream);
    await this.attach(stream, opts, generation);
  }

  private async attach(stream: StreamOut, opts: LoadOptions, generation: number): Promise<void> {
    this.detachHls();
    const audio = this.audio;
    this.applyGain(opts.gain(stream));
    const startAt = opts.startAtMs / 1000;

    this.mse ??= !(audio.canPlayType("application/vnd.apple.mpegurl") && !(await this.mseAvailable()));
    if (!this.mse) {
      audio.src = stream.url;
      if (startAt > 0) audio.currentTime = startAt;
    } else {
      const { default: HlsClass } = await import("hls.js");
      if (generation !== this.generation) return;
      const trackId = this.current?.trackId ?? "";
      const hls = new HlsClass({
        startPosition: startAt > 0 ? startAt : -1,
        autoStartLoad: false,
        // Buffer ahead by time only: hls.js otherwise uses max(maxBufferLength, maxBufferSize·8/bitrate),
        // which for audio (60 MB at 256 kb/s ≈ 30 min) downloads the whole track up front.
        maxBufferLength: 40,
        maxBufferSize: 0,
        // Played audio stays reusable in the segment cache; MSE keeps a short back buffer only.
        backBufferLength: 60,
        fLoader: cachingLoader(HlsClass.DefaultConfig.loader as never, trackId) as never,
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 8000,
            maxLoadTimeMs: 20000,
            timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
            errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
          },
        },
      });
      this.hls = hls;
      hls.on(HlsClass.Events.ERROR, (_event, data) => void this.onHlsError(data, generation));
      hls.on(HlsClass.Events.MANIFEST_PARSED, (_event, data) => {
        // Start where the previous track settled (no low-quality ramp-up on every track).
        const preferred = this.lastLevel ? data.levels.findIndex((l) => qualityOf(l.url[0] ?? "") === this.lastLevel) : -1;
        if (preferred >= 0) hls.startLevel = preferred;
        hls.startLoad(startAt > 0 ? startAt : -1);
      });
      hls.on(HlsClass.Events.LEVEL_SWITCHED, (_event, data) => {
        const q = qualityOf(hls.levels[data.level]?.url[0] ?? "");
        if (q) this.lastLevel = q;
      });
      hls.loadSource(stream.url);
      hls.attachMedia(audio);
    }
    if (opts.autoplay) await this.play();
  }

  private async mseAvailable(): Promise<boolean> {
    const { default: HlsClass } = await import("hls.js");
    return HlsClass.isSupported();
  }

  private async onHlsError(data: ErrorData, generation: number): Promise<void> {
    if (!data.fatal || generation !== this.generation || !this.hls || !this.current) return;
    const { default: HlsClass } = await import("hls.js");
    if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && this.recoveries < 2) {
      this.recoveries += 1;
      this.hls.recoverMediaError();
      return;
    }
    if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
      // Offline: retries would only burn out. Wait for the connection (the audio keeps its
      // position), then resume in place — playing again unless the user paused meanwhile.
      if (!navigator.onLine) {
        if (this.waitingOnline) return;
        this.waitingOnline = true;
        const back = await this.untilOnline(generation);
        this.waitingOnline = false;
        if (!back) return;
        this.recoveries = 0;
      }
      if (this.recoveries < 3) {
        // Expired or revoked stream link, or a network blip: get a fresh URL and resume in place.
        this.recoveries += 1;
        const { trackId, opts } = this.current;
        const resumeAt = this.audio.currentTime * 1000;
        const wasPlaying = !this.audio.paused;
        try {
          const stream = await this.stream(trackId, opts.quality, true);
          if (generation !== this.generation) return;
          this.current = { trackId, opts, stream };
          await this.attach(stream, { ...opts, startAtMs: resumeAt, autoplay: wasPlaying }, generation);
        } catch (error) {
          if (!navigator.onLine) return void this.onHlsError(data, generation);
          this.cb.onError(error instanceof Error ? error.message : "Нет соединения");
        }
        return;
      }
    }
    if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && this.current.opts.quality !== "high" && this.recoveries < 4) {
      // The decoder rejected this rendition: continue in AAC 256 rather than stopping.
      this.recoveries = 4;
      const { trackId, opts } = this.current;
      const resumeAt = this.audio.currentTime * 1000;
      try {
        const stream = await this.stream(trackId, "high", true);
        if (generation !== this.generation) return;
        this.current = { trackId, opts: { ...opts, quality: "high" }, stream };
        this.cb.onStream(stream);
        await this.attach(stream, { ...opts, quality: "high", startAtMs: resumeAt, autoplay: true }, generation);
        return;
      } catch {
        // fall through to the error below
      }
    }
    this.cb.onError(data.type === HlsClass.ErrorTypes.NETWORK_ERROR ? "Нет соединения с сервером" : "Ошибка декодирования");
  }

  private ensureAudioGraph(): void {
    // WebKit outputs silence when a native-HLS element is routed through Web Audio, so
    // normalisation only runs on the MSE path.
    if (this.context || !this.mse || typeof AudioContext === "undefined") return;
    try {
      this.context = new AudioContext();
      const source = this.context.createMediaElementSource(this.audio);
      this.gainNode = this.context.createGain();
      // source → normalisation gain → EQ preamp → 10 EQ bands → analyser (visuals) → output
      this.preamp = this.context.createGain();
      this.bands = EQ_FREQUENCIES.map((frequency, i) => {
        const f = this.context!.createBiquadFilter();
        f.type = i === 0 ? "lowshelf" : i === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking";
        f.frequency.value = frequency;
        f.Q.value = 1.1;
        f.gain.value = 0;
        return f;
      });
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.78;
      this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
      let node: AudioNode = source.connect(this.gainNode).connect(this.preamp);
      for (const band of this.bands) node = node.connect(band);
      node.connect(this.analyser).connect(this.context.destination);
      this.applyEqualizer();
    } catch {
      // Without Web Audio we still play; only loudness normalisation is lost.
      this.context = null;
      this.gainNode = null;
    }
  }

  /** Re-evaluate the normalisation gain of the current stream (settings changed). */
  refreshGain(): void {
    if (this.current) this.applyGain(this.current.opts.gain(this.current.stream));
  }

  /** Real-time EQ on the audio graph (MSE path; Safari's native HLS has no Web Audio graph). */
  setEqualizer(eq: Equalizer): void {
    this.eq = eq;
    this.applyEqualizer();
  }

  get equalizerAvailable(): boolean {
    return this.mse !== false && typeof AudioContext !== "undefined";
  }

  /** Live filter gains (dB) and preamp (linear) from the audio graph, for diagnostics/tests. */
  equalizerSnapshot(): { bands: number[]; preamp: number } | null {
    if (!this.preamp) return null;
    return { bands: this.bands.map((b) => Math.round(b.gain.value * 10) / 10), preamp: Math.round(this.preamp.gain.value * 100) / 100 };
  }

  private applyEqualizer(): void {
    if (!this.context || !this.preamp) return;
    const t = this.context.currentTime;
    const on = this.eq.enabled;
    this.preamp.gain.setTargetAtTime(on ? 10 ** (this.eq.preamp / 20) : 1, t, 0.03);
    this.bands.forEach((band, i) => band.gain.setTargetAtTime(on ? (this.eq.bands[i] ?? 0) : 0, t, 0.03));
  }

  private applyGain(linear: number): void {
    if (!this.gainNode || !this.context) return;
    this.gainNode.gain.setTargetAtTime(linear, this.context.currentTime, 0.05);
  }

  /** Loudness snapshot for visuals: overall energy and bass (0..1); null without Web Audio. */
  levels(): { energy: number; bass: number } | null {
    if (!this.analyser || !this.spectrum || this.audio.paused) return null;
    this.analyser.getByteFrequencyData(this.spectrum);
    const bins = this.spectrum;
    let bass = 0;
    let all = 0;
    const bassBins = 10; // ≈ 0–430 Hz at 44.1 kHz with fftSize 1024
    const used = Math.min(bins.length, 180); // up to ≈ 7.7 kHz: where the music lives
    for (let i = 1; i < used; i++) {
      const v = bins[i]! / 255;
      all += v;
      if (i <= bassBins) bass += v;
    }
    return { energy: all / (used - 1), bass: bass / bassBins };
  }

  /** Time-domain samples (128 = silence) for the oscilloscope; false when nothing is audible. */
  oscilloscope(out: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser || this.audio.paused) return false;
    this.analyser.getByteTimeDomainData(out);
    return true;
  }

  async play(): Promise<void> {
    // The AudioContext must be created/resumed inside a user gesture.
    this.ensureAudioGraph();
    if (this.current) this.applyGain(this.current.opts.gain(this.current.stream));
    await this.context?.resume().catch(() => undefined);
    try {
      await this.audio.play();
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") this.cb.onEvent({ type: "PAUSE" });
    }
  }

  pause(): void {
    this.audio.pause();
  }

  seek(ms: number): void {
    if (Number.isFinite(ms)) this.audio.currentTime = Math.max(0, ms / 1000);
  }

  setVolume(volume: number, muted: boolean): void {
    this.audio.volume = Math.min(1, Math.max(0, volume));
    this.audio.muted = muted;
  }

  get hasSource(): boolean {
    return this.current !== null;
  }

  stop(): void {
    this.generation++;
    this.detachHls();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.current = null;
  }

  private detachHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }
}
