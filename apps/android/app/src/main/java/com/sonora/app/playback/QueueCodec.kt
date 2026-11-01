package com.sonora.app.playback

import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.sonora.app.data.net.Track
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** Where playback started (album, playlist, wave…), sent with play events like the web app does. */
data class PlayContext(val type: String, val id: String?, val title: String)

/** MediaItem <-> Track: the full track travels in the metadata extras, so every screen can render it. */
object QueueCodec {
    const val TRACK = "sonora.track"
    const val CONTEXT_TYPE = "sonora.ctx.type"
    const val CONTEXT_ID = "sonora.ctx.id"
    const val CONTEXT_TITLE = "sonora.ctx.title"
    /** App-side kind (may be "wave" or "mix"); CONTEXT_TYPE/ID are what the events API accepts. */
    const val CONTEXT_KIND = "sonora.ctx.kind"
    private val uuid = Regex("^[0-9a-fA-F-]{36}$")
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Serializable
    private data class Saved(val track: Track, val ctxType: String? = null, val ctxId: String? = null, val ctxTitle: String? = null)

    fun item(track: Track, context: PlayContext?): MediaItem {
        val extras = Bundle().apply {
            putString(TRACK, json.encodeToString(Track.serializer(), track))
            context?.let {
                val apiType = apiContextType(it.type)
                putString(CONTEXT_KIND, it.type)
                putString(CONTEXT_TYPE, apiType)
                if (apiType == it.type && it.id != null && uuid.matches(it.id)) putString(CONTEXT_ID, it.id)
                putString(CONTEXT_TITLE, it.title)
                it.id?.let { id -> putString("sonora.ctx.raw_id", id) }
            }
        }
        val metadata = MediaMetadata.Builder()
            .setTitle(track.fullTitle)
            .setArtist(track.artistLine)
            .setAlbumTitle(track.release.title)
            .setArtworkUri(track.release.artwork?.let { Uri.parse(it.url(600)) })
            .setDurationMs(track.durationMs)
            .setIsPlayable(track.playable)
            .setIsBrowsable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
            .setExtras(extras)
            .build()
        return MediaItem.Builder().setMediaId(track.id).setMediaMetadata(metadata).build()
    }

    fun track(item: MediaItem?): Track? =
        item?.mediaMetadata?.extras?.getString(TRACK)?.let { runCatching { json.decodeFromString(Track.serializer(), it) }.getOrNull() }

    fun context(item: MediaItem?): PlayContext? {
        val e = item?.mediaMetadata?.extras ?: return null
        val type = e.getString(CONTEXT_KIND) ?: return null
        return PlayContext(type, e.getString("sonora.ctx.raw_id"), e.getString(CONTEXT_TITLE) ?: "")
    }

    fun encode(items: List<MediaItem>): String = json.encodeToString(
        ListSerializer(Saved.serializer()),
        items.mapNotNull { item ->
            val t = track(item) ?: return@mapNotNull null
            val c = context(item)
            Saved(t, c?.type, c?.id, c?.title)
        },
    )

    fun decode(raw: String): List<MediaItem> = runCatching {
        json.decodeFromString(ListSerializer(Saved.serializer()), raw).map { s ->
            item(s.track, s.ctxType?.let { PlayContext(it, s.ctxId, s.ctxTitle ?: "") })
        }
    }.getOrDefault(emptyList())

    /** The API accepts release, artist, playlist, tracks, home, genre; app-only contexts map to "tracks". */
    private fun apiContextType(type: String) = when (type) {
        "release", "artist", "playlist", "home", "genre", "tracks" -> type
        else -> "tracks"
    }
}
