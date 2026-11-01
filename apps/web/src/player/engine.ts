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
  private spectrum: Uint8Array<ArrayBuffer> | null = null;
  private generation = 0;
  private current: { trackId: string; opts: LoadOptions; stream: StreamOut } | null = null;
  private readonly cache = new Map<string, { stream: StreamOut; at: number }>();
  private recoveries = 0;
  /** hls.js/MSE (true) or native HLS (false); decided once per browser. */
  private mse: boolean | null = null;

  constructor(private readonly cb: EngineCallbacks) {
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    this.audio = audio;
    audio.addEventListener("playing", () => cb.onEvent({ type: "PLAYING" }));
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
    const stream = await fetchStream(trackId, quality);
    this.cache.set(key, { stream, at: Date.now() });
    return stream;
  }

  /** Warm the stream URL for the next track so pressing "next" starts instantly. */
  prefetch(trackId: string, quality: RequestedQuality): void {
    void this.stream(trackId, quality).catch(() => undefined);
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
      const hls = new HlsClass({
        startPosition: startAt > 0 ? startAt : -1,
        maxBufferLength: 30,
        backBufferLength: 30,
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
    if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR && this.recoveries < 3) {
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
        this.cb.onError(error instanceof Error ? error.message : "Нет соединения");
      }
      return;
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
      // source → normalisation gain → analyser (visuals) → output
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.78;
      this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
      source.connect(this.gainNode).connect(this.analyser).connect(this.context.destination);
    } catch {
      // Without Web Audio we still play; only loudness normalisation is lost.
      this.context = null;
      this.gainNode = null;
    }
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
