"use client";

import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { requireLogin } from "@/lib/play";
import { useSession } from "@/lib/session";
import { player } from "@/player/controller";
import { toQueueTrack } from "@/player/queue";
import { usePlayer } from "@/player/store";

const WAVE = { type: "wave" as const, id: null, title: "Моя волна" };
let refilling = false;

type Seed = { seed_track?: string; seed_artist?: string };

/** Radio contexts carry their seed in the id: "track:<uuid>" or "artist:<uuid>"; plain wave has none. */
function seedOf(id: string | null | undefined): Seed {
  const [kind, value] = (id ?? "").split(":");
  if (kind === "track" && value) return { seed_track: value };
  if (kind === "artist" && value) return { seed_artist: value };
  return {};
}

async function nextWave(exclude: string[], seed: Seed = {}, limit = 20) {
  return unwrap(api.GET("/v1/me/wave", { params: { query: { limit, exclude: exclude.slice(-300), ...seed } } }));
}

/** Top the wave (or a radio) up when the queue runs low: never repeats a track from this session. */
async function refill(): Promise<void> {
  const { queue, context } = usePlayer.getState();
  if (refilling || !queue || context?.type !== "wave") return;
  refilling = true;
  try {
    const seed = seedOf(context.id);
    const ids = queue.items.map((t) => t.id);
    let tracks = (await nextWave(ids, seed)).filter((t) => t.playable);
    // Small catalogue exhausted: keep the wave endless by only avoiding the last few tracks.
    if (!tracks.length) tracks = (await nextWave(ids.slice(-10), seed)).filter((t) => t.playable);
    const now = usePlayer.getState().context;
    if (tracks.length && now?.type === "wave" && now.id === context.id) player.addToQueue(tracks.map(toQueueTrack), now);
  } finally {
    refilling = false;
  }
}

/** Start "Моя волна": an endless, personal radio from the listener's taste. */
export async function playWave(): Promise<void> {
  if (!requireLogin()) return;
  const tracks = (await nextWave([])).filter((t) => t.playable);
  if (!tracks.length) return;
  player.setQueueLowHandler(() => void refill());
  player.playTracks(tracks.map(toQueueTrack), 0, WAVE);
}

/**
 * Endless radio around one track or artist: similar music, still bent to the listener's taste.
 * A track radio starts with the track itself, then flows on.
 */
export async function playRadio(seed: { trackId: string; title: string } | { artistId: string; title: string }): Promise<boolean> {
  if (!requireLogin()) return false;
  const query: Seed = "trackId" in seed ? { seed_track: seed.trackId } : { seed_artist: seed.artistId };
  const id = "trackId" in seed ? `track:${seed.trackId}` : `artist:${seed.artistId}`;
  let tracks = (await nextWave([], query)).filter((t) => t.playable);
  if ("trackId" in seed) {
    const first = await unwrap(api.GET("/v1/tracks/{track_id}", { params: { path: { track_id: seed.trackId } } })).catch(() => null);
    if (first?.playable) tracks = [first, ...tracks.filter((t) => t.id !== first.id)];
  }
  if (!tracks.length) return false;
  player.setQueueLowHandler(() => void refill());
  player.playTracks(tracks.map(toQueueTrack), 0, { type: "wave", id, title: `Радио: ${seed.title}` });
  return true;
}

function useAuthed() {
  return useSession((s) => s.status === "authenticated");
}

export function useMixes() {
  const authed = useAuthed();
  return useQuery({ queryKey: ["mixes"], enabled: authed, staleTime: 10 * 60_000, queryFn: () => unwrap(api.GET("/v1/me/mixes")) });
}

export function useMix(key: string) {
  const authed = useAuthed();
  return useQuery({ queryKey: ["mix", key], enabled: authed, staleTime: 10 * 60_000, queryFn: () => unwrap(api.GET("/v1/me/mixes/{key}", { params: { path: { key } } })) });
}

export function useTopArtists() {
  const authed = useAuthed();
  return useQuery({ queryKey: ["top-artists"], enabled: authed, staleTime: 10 * 60_000, queryFn: () => unwrap(api.GET("/v1/me/top-artists", { params: { query: { limit: 12 } } })) });
}

export function useRecent() {
  const authed = useAuthed();
  return useQuery({ queryKey: ["recent"], enabled: authed, staleTime: 60_000, queryFn: () => unwrap(api.GET("/v1/me/recent")) });
}

export function useSimilarArtists(id: string) {
  return useQuery({ queryKey: ["artist", id, "similar"], staleTime: 10 * 60_000, queryFn: () => unwrap(api.GET("/v1/artists/{artist_id}/similar", { params: { path: { artist_id: id } } })) });
}

export function useArtistStats(id: string) {
  return useQuery({ queryKey: ["artist", id, "stats"], staleTime: 5 * 60_000, queryFn: () => unwrap(api.GET("/v1/artists/{artist_id}/stats", { params: { path: { artist_id: id } } })) });
}
