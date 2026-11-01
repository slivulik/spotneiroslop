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

async function nextWave(exclude: string[], limit = 20) {
  return unwrap(api.GET("/v1/me/wave", { params: { query: { limit, exclude: exclude.slice(-300) } } }));
}

/** Top the wave up when the queue runs low: never repeats a track from this session. */
async function refill(): Promise<void> {
  const queue = usePlayer.getState().queue;
  if (refilling || !queue) return;
  refilling = true;
  try {
    const ids = queue.items.map((t) => t.id);
    let tracks = (await nextWave(ids)).filter((t) => t.playable);
    // Small catalogue exhausted: keep the wave endless by only avoiding the last few tracks.
    if (!tracks.length) tracks = (await nextWave(ids.slice(-10))).filter((t) => t.playable);
    if (tracks.length && usePlayer.getState().context?.type === "wave") player.addToQueue(tracks.map(toQueueTrack), WAVE);
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
