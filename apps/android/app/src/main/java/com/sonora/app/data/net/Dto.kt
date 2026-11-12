package com.sonora.app.data.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// Mirrors packages/api-schema/openapi.json (snake_case on the wire). Unknown fields are ignored,
// so new server fields never break older app versions.

@Serializable
data class Artwork(
    @SerialName("url_template") val urlTemplate: String,
    val sizes: List<Int> = emptyList(),
    val blurhash: String? = null,
    val palette: Palette? = null,
) {
    /** Smallest rendition that covers [px]; WebP decodes natively on every supported Android. */
    fun url(px: Int): String {
        val size = sizes.sorted().firstOrNull { it >= px } ?: sizes.maxOrNull() ?: px
        return urlTemplate.replace("{size}", size.toString()).replace("{format}", "webp")
    }
}

@Serializable
data class Palette(
    val dominant: String? = null,
    val vibrant: String? = null,
    val muted: String? = null,
    val accent: String? = null,
    @SerialName("muted_dark") val mutedDark: String? = null,
)

@Serializable
data class ArtistRef(val id: String, val name: String, val slug: String = "", val role: String? = null)

@Serializable
data class ReleaseRef(val id: String, val title: String, val slug: String = "", val type: String = "album", val artwork: Artwork? = null)

@Serializable
data class AudioBadges(val hires: Boolean = false, val lossless: Boolean = false)

@Serializable
data class Track(
    val id: String,
    val title: String,
    val version: String? = null,
    @SerialName("duration_ms") val durationMs: Long,
    @SerialName("disc_number") val discNumber: Int = 1,
    @SerialName("track_number") val trackNumber: Int = 1,
    @SerialName("is_explicit") val isExplicit: Boolean = false,
    val artists: List<ArtistRef> = emptyList(),
    val release: ReleaseRef,
    val audio: AudioBadges = AudioBadges(),
    @SerialName("has_lyrics") val hasLyrics: Boolean = false,
    @SerialName("lyrics_type") val lyricsType: String? = null,
    val playable: Boolean = true,
    /** Open licence of an imported track (Jamendo, Internet Archive); null for the owner's own uploads. */
    val license: TrackLicense? = null,
) {
    val artistLine: String get() = artists.joinToString(", ") { it.name }
    val fullTitle: String get() = if (version.isNullOrBlank()) title else "$title ($version)"
}

@Serializable
data class TrackLicense(
    val code: String,
    val url: String? = null,
    val source: String? = null,
    @SerialName("source_url") val sourceUrl: String? = null,
    val attribution: String? = null,
)

@Serializable
data class ReleaseSummary(
    val id: String,
    val title: String,
    val type: String = "album",
    val artwork: Artwork? = null,
    val artists: List<ArtistRef> = emptyList(),
    @SerialName("release_date") val releaseDate: String? = null,
    @SerialName("track_count") val trackCount: Int = 0,
)

@Serializable
data class GenreRef(val id: String, val name: String, val slug: String)

@Serializable
data class Release(
    val id: String,
    val title: String,
    val type: String = "album",
    @SerialName("release_date") val releaseDate: String? = null,
    val label: String? = null,
    val artwork: Artwork? = null,
    val artists: List<ArtistRef> = emptyList(),
    val genres: List<GenreRef> = emptyList(),
    @SerialName("total_duration_ms") val totalDurationMs: Long = 0,
    @SerialName("track_count") val trackCount: Int = 0,
    val tracks: List<Track> = emptyList(),
)

@Serializable
data class ArtistSummary(val id: String, val name: String, val artwork: Artwork? = null, val verified: Boolean = false)

@Serializable
data class Artist(
    val id: String,
    val name: String,
    val bio: String? = null,
    val artwork: Artwork? = null,
    @SerialName("monthly_listeners") val monthlyListeners: Long = 0,
    val verified: Boolean = false,
    @SerialName("photo_credit") val photoCredit: String? = null,
    @SerialName("bio_source") val bioSource: String? = null,
)

@Serializable
data class WeeklyPlays(val week: String, val plays: Int)

@Serializable
data class ArtistStats(
    @SerialName("monthly_listeners") val monthlyListeners: Long = 0,
    @SerialName("plays_30d") val plays30d: Long = 0,
    @SerialName("total_plays") val totalPlays: Long = 0,
    @SerialName("first_release") val firstRelease: String? = null,
    val genres: List<GenreRef> = emptyList(),
    val weekly: List<WeeklyPlays> = emptyList(),
)

@Serializable
data class PlaylistSummary(
    val id: String,
    val title: String,
    val description: String? = null,
    val artwork: Artwork? = null,
    val mosaic: List<Artwork> = emptyList(),
    @SerialName("owner_name") val ownerName: String? = null,
    @SerialName("track_count") val trackCount: Int = 0,
    val type: String = "editorial",
)

@Serializable
data class Playlist(
    val id: String,
    val title: String,
    val description: String? = null,
    val artwork: Artwork? = null,
    val mosaic: List<Artwork> = emptyList(),
    @SerialName("owner_name") val ownerName: String? = null,
    @SerialName("owner_id") val ownerId: String? = null,
    @SerialName("track_count") val trackCount: Int = 0,
    @SerialName("total_duration_ms") val totalDurationMs: Long = 0,
    val tracks: List<Track> = emptyList(),
)

@Serializable
data class Genre(val id: String, val slug: String, val name: String, val color: String? = null, val artwork: Artwork? = null)

@Serializable
data class Hero(val artwork: Artwork? = null, val link: String? = null, @SerialName("cta_label") val ctaLabel: String? = null)

@Serializable
data class HomeBlock(
    val id: String,
    val type: String,
    val style: String = "shelf",
    val title: String,
    val subtitle: String? = null,
    val hero: Hero? = null,
    val tracks: List<Track> = emptyList(),
    val releases: List<ReleaseSummary> = emptyList(),
    val playlists: List<PlaylistSummary> = emptyList(),
    val artists: List<ArtistSummary> = emptyList(),
    val genres: List<Genre> = emptyList(),
)

@Serializable
data class GenreList(val items: List<Genre> = emptyList())

@Serializable
data class GenreDetail(
    val genre: Genre,
    val description: String? = null,
    val releases: List<ReleaseSummary> = emptyList(),
    val tracks: List<Track> = emptyList(),
)

@Serializable
data class Home(val sections: List<HomeBlock> = emptyList())

@Serializable
data class SearchResult(
    val tracks: List<Track> = emptyList(),
    val releases: List<ReleaseSummary> = emptyList(),
    val artists: List<ArtistSummary> = emptyList(),
    val playlists: List<PlaylistSummary> = emptyList(),
    val genres: List<Genre> = emptyList(),
)

@Serializable
data class TrackList(val items: List<Track> = emptyList())

@Serializable
data class TrackPage(val items: List<Track> = emptyList(), val total: Int = 0)

@Serializable
data class ReleasePage(val items: List<ReleaseSummary> = emptyList(), @SerialName("next_cursor") val nextCursor: String? = null)

@Serializable
data class MixSummary(
    val key: String,
    val title: String,
    val subtitle: String? = null,
    val mosaic: List<Artwork> = emptyList(),
    @SerialName("track_count") val trackCount: Int = 0,
)

@Serializable
data class Mix(val key: String, val title: String, val subtitle: String? = null, val tracks: List<Track> = emptyList())

/**
 * «Моя волна» 2.0 filters; null means «Любое».
 * character: favorite | discover | popular; mood: energetic | happy | calm | sad;
 * language: russian | foreign | instrumental.
 */
@Serializable
data class WaveSettings(val character: String? = null, val mood: String? = null, val language: String? = null)

@Serializable
data class WaveStartIn(
    val settings: WaveSettings = WaveSettings(),
    @SerialName("seed_track") val seedTrack: String? = null,
    @SerialName("seed_artist") val seedArtist: String? = null,
    val limit: Int = 20,
)

@Serializable
data class WaveSessionOut(
    @SerialName("session_id") val sessionId: String,
    val settings: WaveSettings = WaveSettings(),
    val tracks: List<Track> = emptyList(),
)

/** action: started | finished | skipped | liked | disliked. */
@Serializable
data class WaveFeedbackIn(
    @SerialName("track_id") val trackId: String,
    val action: String,
    @SerialName("played_ms") val playedMs: Long? = null,
)

@Serializable
data class LyricsLine(@SerialName("start_ms") val startMs: Long, @SerialName("end_ms") val endMs: Long, val text: String)

@Serializable
data class Lyrics(val type: String, val lines: List<LyricsLine> = emptyList(), val text: String? = null)

@Serializable
data class HistoryEntry(val track: Track, @SerialName("played_at") val playedAt: String)

@Serializable
data class History(val items: List<HistoryEntry> = emptyList())

@Serializable
data class LibraryIds(
    val tracks: List<String> = emptyList(),
    val releases: List<String> = emptyList(),
    val artists: List<String> = emptyList(),
    val playlists: List<String> = emptyList(),
)

@Serializable
data class Queries(val queries: List<String> = emptyList())

@Serializable
data class QueryIn(val query: String)

@Serializable
data class PlaylistIn(val title: String, @SerialName("track_ids") val trackIds: List<String> = emptyList())

@Serializable
data class TrackIdsIn(@SerialName("track_ids") val trackIds: List<String>)

@Serializable
data class Rendition(val quality: String, val codec: String, val bitrate: Int? = null, @SerialName("sample_rate") val sampleRate: Int = 0, @SerialName("bit_depth") val bitDepth: Int? = null)

@Serializable
data class Stream(
    val url: String,
    val quality: String,
    val codec: String? = null,
    @SerialName("duration_ms") val durationMs: Long = 0,
    @SerialName("track_gain") val trackGain: Double? = null,
    @SerialName("album_gain") val albumGain: Double? = null,
    @SerialName("expires_in") val expiresIn: Long = 0,
    val renditions: List<Rendition> = emptyList(),
    val waveform: List<Int>? = null,
)

@Serializable
data class PlayEvent(
    @SerialName("event_id") val eventId: String,
    val type: String,
    @SerialName("track_id") val trackId: String,
    @SerialName("ms_played") val msPlayed: Long = 0,
    val at: String? = null,
    @SerialName("context_type") val contextType: String? = null,
    @SerialName("context_id") val contextId: String? = null,
)

@Serializable
data class EventsIn(val events: List<PlayEvent>)

@Serializable
data class DeviceIn(
    val name: String,
    val platform: String = "android",
    val model: String? = null,
    @SerialName("app_version") val appVersion: String? = null,
    @SerialName("device_id") val deviceId: String? = null,
)

@Serializable
data class LoginIn(val email: String, val password: String, val device: DeviceIn)

@Serializable
data class RegisterIn(
    val email: String,
    val password: String,
    @SerialName("display_name") val displayName: String,
    val device: DeviceIn,
)

@Serializable
data class RefreshIn(@SerialName("refresh_token") val refreshToken: String)

@Serializable
data class Me(val id: String, val email: String? = null, @SerialName("display_name") val displayName: String? = null, val role: String = "listener")

@Serializable
data class TokenOut(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("device_id") val deviceId: String,
    @SerialName("expires_in") val expiresIn: Long,
    val user: Me? = null,
)

@Serializable
data class ErrorEnvelope(val error: ErrorDetail)

@Serializable
data class ErrorDetail(val code: String, val message: String)

/** /v1/me/settings is a free-form document (JSON Merge Patch on write). */
typealias SettingsDoc = JsonObject
