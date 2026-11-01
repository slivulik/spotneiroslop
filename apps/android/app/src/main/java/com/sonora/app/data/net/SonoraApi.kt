package com.sonora.app.data.net

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/** The subset of the Sonora REST API (/v1) the Android app uses. */
interface SonoraApi {
    // auth
    @POST("v1/auth/login") suspend fun login(@Body body: LoginIn): TokenOut
    @POST("v1/auth/refresh") fun refreshBlocking(@Body body: RefreshIn): retrofit2.Call<TokenOut>
    @POST("v1/auth/logout") suspend fun logout(): Response<Unit>
    @GET("v1/me") suspend fun me(): Me

    // catalogue
    @GET("v1/home") suspend fun home(): Home
    @GET("v1/search") suspend fun search(@Query("q") q: String, @Query("limit") limit: Int = 20, @Query("sort") sort: String? = null): SearchResult
    @GET("v1/search/popular") suspend fun popularSearches(): Queries
    @GET("v1/releases/{id}") suspend fun release(@Path("id") id: String): Release
    @GET("v1/artists/{id}") suspend fun artist(@Path("id") id: String): Artist
    @GET("v1/artists/{id}/top-tracks") suspend fun artistTopTracks(@Path("id") id: String): TrackList
    @GET("v1/artists/{id}/releases") suspend fun artistReleases(@Path("id") id: String, @Query("limit") limit: Int = 50): ReleasePage
    @GET("v1/artists/{id}/similar") suspend fun similarArtists(@Path("id") id: String): List<ArtistSummary>
    @GET("v1/playlists/{id}") suspend fun playlist(@Path("id") id: String): Playlist
    @GET("v1/genres/{slug}") suspend fun genre(@Path("slug") slug: String): GenreDetail
    @GET("v1/tracks/{id}") suspend fun track(@Path("id") id: String): Track
    @GET("v1/tracks/{id}/lyrics") suspend fun lyrics(@Path("id") id: String): Response<Lyrics>
    @GET("v1/tracks/{id}/stream") fun streamBlocking(@Path("id") id: String, @Query("quality") quality: String?): retrofit2.Call<Stream>

    // personal
    @GET("v1/me/wave") suspend fun wave(@Query("limit") limit: Int = 25, @Query("exclude") exclude: List<String> = emptyList()): List<Track>
    @GET("v1/me/mixes/{key}") suspend fun mix(@Path("key") key: String): Mix
    @GET("v1/me/recent") suspend fun recent(): TrackList
    @GET("v1/me/history") suspend fun history(@Query("limit") limit: Int = 100): History
    @GET("v1/me/library") suspend fun libraryIds(): LibraryIds
    @GET("v1/me/library/tracks") suspend fun likedTracks(@Query("offset") offset: Int = 0, @Query("limit") limit: Int = 200): TrackPage
    @GET("v1/me/library/releases") suspend fun likedReleases(): List<ReleaseSummary>
    @GET("v1/me/library/artists") suspend fun followedArtists(): List<ArtistSummary>
    @PUT("v1/me/library/{kind}/{id}") suspend fun save(@Path("kind") kind: String, @Path("id") id: String): Response<Unit>
    @DELETE("v1/me/library/{kind}/{id}") suspend fun unsave(@Path("kind") kind: String, @Path("id") id: String): Response<Unit>
    @GET("v1/me/playlists") suspend fun myPlaylists(): List<PlaylistSummary>
    @POST("v1/me/playlists") suspend fun createPlaylist(@Body body: PlaylistIn): Playlist
    @POST("v1/me/playlists/{id}/tracks") suspend fun addToPlaylist(@Path("id") id: String, @Body body: TrackIdsIn): Response<Unit>
    @GET("v1/me/search-history") suspend fun searchHistory(): Queries
    @POST("v1/me/search-history") suspend fun recordSearch(@Body body: QueryIn): Response<Unit>
    @DELETE("v1/me/search-history") suspend fun clearSearchHistory(): Response<Unit>
    @GET("v1/me/settings") suspend fun settings(): SettingsDoc
    @PATCH("v1/me/settings") suspend fun patchSettings(@Body patch: SettingsDoc): SettingsDoc
    @POST("v1/events/batch") suspend fun events(@Body body: EventsIn): Response<Unit>
}
