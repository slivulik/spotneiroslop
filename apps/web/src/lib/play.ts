"use client";

import type { TrackOut } from "@sonora/api-schema";
import { api, unwrap } from "@/lib/api";
import { navigate } from "@/lib/navigation";
import { useSession } from "@/lib/session";
import { player } from "@/player/controller";
import { type PlayContext, toQueueTrack } from "@/player/queue";

export function requireLogin(): boolean {
  if (useSession.getState().status === "authenticated") return true;
  navigate(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  return false;
}

export function playTracks(tracks: TrackOut[], startId: string | null, context: PlayContext, options: { shuffle?: boolean } = {}): void {
  if (!requireLogin()) return;
  const playable = tracks.filter((t) => t.playable);
  const start = Math.max(0, startId ? playable.findIndex((t) => t.id === startId) : 0);
  player.playTracks(playable.map(toQueueTrack), start, context, options);
}

export async function playRelease(id: string, shuffle = false): Promise<void> {
  if (!requireLogin()) return;
  const release = await unwrap(api.GET("/v1/releases/{release_id}", { params: { path: { release_id: id } } }));
  const playable = release.tracks.filter((t) => t.playable);
  player.playTracks(playable.map(toQueueTrack), 0, { type: "release", id, title: release.title }, { shuffle });
}

export async function playPlaylist(id: string, shuffle = false): Promise<void> {
  if (!requireLogin()) return;
  const playlist = await unwrap(api.GET("/v1/playlists/{playlist_id}", { params: { path: { playlist_id: id } } }));
  const playable = playlist.tracks.filter((t) => t.playable);
  player.playTracks(playable.map(toQueueTrack), 0, { type: "playlist", id, title: playlist.title }, { shuffle });
}
