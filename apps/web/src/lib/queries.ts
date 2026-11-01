"use client";

import type { components } from "@sonora/api-schema";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { useSession } from "@/lib/session";

type S = components["schemas"];

/** Personalised fields (`playable`) depend on the viewer, so the session is part of every key. */
function useViewerKey(): string {
  const { status, user } = useSession();
  return status === "authenticated" ? (user?.id ?? "user") : status;
}

export function useNewReleases() {
  const viewer = useViewerKey();
  return useInfiniteQuery({
    queryKey: ["releases", "new", viewer],
    enabled: viewer !== "unknown",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap<S["Page_ReleaseSummary_"]>(api.GET("/v1/releases", { params: { query: { limit: 24, cursor: pageParam } } })),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useRelease(id: string) {
  const viewer = useViewerKey();
  return useQuery({
    queryKey: ["release", id, viewer],
    enabled: viewer !== "unknown",
    queryFn: () => unwrap<S["ReleaseOut"]>(api.GET("/v1/releases/{release_id}", { params: { path: { release_id: id } } })),
  });
}

export function useArtist(id: string) {
  return useQuery({
    queryKey: ["artist", id],
    queryFn: () => unwrap<S["ArtistOut"]>(api.GET("/v1/artists/{artist_id}", { params: { path: { artist_id: id } } })),
  });
}

export function useArtistTopTracks(id: string) {
  const viewer = useViewerKey();
  return useQuery({
    queryKey: ["artist", id, "top", viewer],
    enabled: viewer !== "unknown",
    queryFn: () =>
      unwrap<S["TrackList"]>(api.GET("/v1/artists/{artist_id}/top-tracks", { params: { path: { artist_id: id } } })),
  });
}

export function useArtistReleases(id: string) {
  return useQuery({
    queryKey: ["artist", id, "releases"],
    queryFn: () =>
      unwrap<S["Page_ReleaseSummary_"]>(
        api.GET("/v1/artists/{artist_id}/releases", { params: { path: { artist_id: id }, query: { limit: 50 } } }),
      ),
  });
}
