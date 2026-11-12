"use client";

import type { components } from "@sonora/api-schema";
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useHome() {
  const viewer = useViewerKey();
  return useQuery({
    queryKey: ["home", viewer],
    enabled: viewer !== "unknown",
    queryFn: () => unwrap<S["HomeOut"]>(api.GET("/v1/home")),
  });
}

/** Debounced by the caller; superseded requests are aborted (TanStack passes the signal). */
export function useSearch(q: string, sort: "relevance" | "new" | "popular" = "relevance", limit = 12) {
  const viewer = useViewerKey();
  return useQuery({
    queryKey: ["search", q, sort, limit, viewer],
    enabled: q.length > 0 && viewer !== "unknown",
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => unwrap<S["SearchOut"]>(api.GET("/v1/search", { params: { query: { q, limit, sort } }, signal })),
  });
}

export function useSearchHistory() {
  const authed = useSession((s) => s.status === "authenticated");
  return useQuery({ queryKey: ["search-history"], enabled: authed, staleTime: 60_000, queryFn: () => unwrap(api.GET("/v1/me/search-history")) });
}

/** Remember a query in the synced history (signed-in users only; failures are harmless). */
export function useRecordSearch() {
  const client = useQueryClient();
  const authed = useSession((s) => s.status === "authenticated");
  return (query: string) => {
    if (!authed || !query.trim()) return;
    void api.POST("/v1/me/search-history", { body: { query: query.trim() } }).then(() => client.invalidateQueries({ queryKey: ["search-history"] }));
  };
}

export function usePopularSearches() {
  return useQuery({ queryKey: ["search-popular"], staleTime: 10 * 60_000, queryFn: () => unwrap(api.GET("/v1/search/popular")) });
}

export function usePlatform() {
  return useQuery({
    queryKey: ["platform"],
    staleTime: 60_000,
    queryFn: () => unwrap<S["PlatformPublic"]>(api.GET("/v1/platform")),
  });
}

export function usePlaylist(id: string) {
  const viewer = useViewerKey();
  return useQuery({
    queryKey: ["playlist", id, viewer],
    enabled: viewer !== "unknown",
    queryFn: () => unwrap<S["PlaylistOut"]>(api.GET("/v1/playlists/{playlist_id}", { params: { path: { playlist_id: id } } })),
  });
}

export function useGenre(slug: string) {
  const viewer = useViewerKey();
  return useQuery({
    queryKey: ["genre", slug, viewer],
    enabled: viewer !== "unknown",
    queryFn: () => unwrap<S["GenreDetail"]>(api.GET("/v1/genres/{slug}", { params: { path: { slug } } })),
  });
}

export function useGenres() {
  return useQuery({
    queryKey: ["genres"],
    queryFn: () => unwrap<S["GenreList"]>(api.GET("/v1/genres")),
  });
}

/**
 * Lyrics of a track. Asked for even when `has_lyrics` is false: the server then looks them up on
 * demand. "None found" (204, or the not-found error) resolves to null; other failures throw.
 */
export function useLyrics(trackId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["lyrics", trackId],
    enabled: Boolean(trackId) && enabled,
    retry: false,
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/v1/tracks/{track_id}/lyrics", { params: { path: { track_id: trackId! } }, signal });
      if (response.status === 204 || response.status === 404) return null;
      if (!response.ok || !data) throw new Error(`lyrics ${response.status}`);
      return data as S["LyricsOut"];
    },
  });
}

export function useTrack(id: string | null) {
  const viewer = useViewerKey();
  return useQuery({
    queryKey: ["track", id, viewer],
    enabled: Boolean(id) && viewer !== "unknown",
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => unwrap(api.GET("/v1/tracks/{track_id}", { params: { path: { track_id: id! } }, signal })),
  });
}
