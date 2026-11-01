"use client";

import type { components } from "@sonora/api-schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { useSession } from "@/lib/session";

type S = components["schemas"];
export type SavedKind = "tracks" | "releases" | "artists" | "playlists";
type Ids = S["LibraryIds"];

const IDS = ["library", "ids"] as const;

function useAuthed(): boolean {
  return useSession((s) => s.status === "authenticated");
}

/** Every saved id of the viewer (one small request renders all hearts). */
export function useLibraryIds() {
  const authed = useAuthed();
  return useQuery({ queryKey: IDS, enabled: authed, staleTime: 5 * 60_000, queryFn: () => unwrap(api.GET("/v1/me/library")) });
}

export function useIsSaved(kind: SavedKind, id: string | undefined): boolean {
  const ids = useLibraryIds().data;
  return Boolean(id && ids?.[kind].includes(id));
}

/** Toggle with an optimistic update; rolls back if the server refuses. */
export function useToggleSaved() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, id, saved }: { kind: SavedKind; id: string; saved: boolean }) => {
      const params = { params: { path: { kind, target_id: id } } };
      if (saved) await unwrap(api.PUT("/v1/me/library/{kind}/{target_id}", params));
      else await unwrap(api.DELETE("/v1/me/library/{kind}/{target_id}", params));
    },
    onMutate: async ({ kind, id, saved }) => {
      await client.cancelQueries({ queryKey: IDS });
      const before = client.getQueryData<Ids>(IDS);
      if (before) {
        const list = before[kind].filter((x) => x !== id);
        client.setQueryData<Ids>(IDS, { ...before, [kind]: saved ? [id, ...list] : list });
      }
      return { before };
    },
    onError: (_e, _v, context) => {
      if (context?.before) client.setQueryData(IDS, context.before);
    },
    onSettled: (_d, _e, { kind }) => {
      void client.invalidateQueries({ queryKey: IDS });
      void client.invalidateQueries({ queryKey: ["library", kind] });
      if (kind === "playlists") void client.invalidateQueries({ queryKey: ["library", "playlists"] });
    },
  });
}

export function useLikedTracks() {
  const authed = useAuthed();
  return useQuery({
    queryKey: ["library", "tracks"],
    enabled: authed,
    queryFn: () => unwrap(api.GET("/v1/me/library/tracks", { params: { query: { limit: 200 } } })),
  });
}

export function useLikedReleases() {
  const authed = useAuthed();
  return useQuery({ queryKey: ["library", "releases"], enabled: authed, queryFn: () => unwrap(api.GET("/v1/me/library/releases")) });
}

export function useFollowedArtists() {
  const authed = useAuthed();
  return useQuery({ queryKey: ["library", "artists"], enabled: authed, queryFn: () => unwrap(api.GET("/v1/me/library/artists")) });
}

export function useMyPlaylists() {
  const authed = useAuthed();
  return useQuery({ queryKey: ["library", "playlists"], enabled: authed, queryFn: () => unwrap(api.GET("/v1/me/playlists")) });
}

export function useHistory(limit = 50) {
  const authed = useAuthed();
  return useQuery({
    queryKey: ["library", "history", limit],
    enabled: authed,
    queryFn: () => unwrap(api.GET("/v1/me/history", { params: { query: { limit } } })),
  });
}

/** Shared invalidation after any playlist change. */
export function usePlaylistInvalidate() {
  const client = useQueryClient();
  return (id?: string) => {
    void client.invalidateQueries({ queryKey: ["library", "playlists"] });
    if (id) void client.invalidateQueries({ queryKey: ["playlist", id] });
  };
}

export async function createPlaylist(title: string, trackIds: string[] = []) {
  return unwrap(api.POST("/v1/me/playlists", { body: { title, track_ids: trackIds, is_public: false } }));
}

export async function addToPlaylist(playlistId: string, trackIds: string[]) {
  return unwrap(api.POST("/v1/me/playlists/{playlist_id}/tracks", { params: { path: { playlist_id: playlistId } }, body: { track_ids: trackIds } }));
}
