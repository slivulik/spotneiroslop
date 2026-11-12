package com.sonora.app.ui

import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.sonora.app.data.net.Track
import com.sonora.app.playback.PlayContext

/** What every screen needs to know about the session and the player — plain data, easy to fake in tests. */
data class Env(
    val currentId: String? = null,
    val currentContext: PlayContext? = null,
    val playing: Boolean = false,
    val likedTracks: Set<String> = emptySet(),
    val savedReleases: Set<String> = emptySet(),
    val followed: Set<String> = emptySet(),
    val savedPlaylists: Set<String> = emptySet(),
    val signedIn: Boolean = false,
    val userName: String? = null,
    val email: String? = null,
    val isAdmin: Boolean = false,
    /** The full-screen player covers everything: screens below can pause their animations. */
    val playerOpen: Boolean = false,
) {
    fun saved(kind: String, id: String) = when (kind) {
        "tracks" -> id in likedTracks
        "releases" -> id in savedReleases
        "artists" -> id in followed
        else -> id in savedPlaylists
    }

    fun isPlayingFrom(ctx: PlayContext) = playing && currentContext?.type == ctx.type && currentContext.id == ctx.id
}

/** Everything a screen can ask the app to do. */
interface Actions {
    fun navigate(route: String)
    fun back()
    fun play(tracks: List<Track>, index: Int, ctx: PlayContext, shuffle: Boolean = false)
    fun togglePlay()
    fun playWave()
    fun openWaveSettings()
    fun toggleSaved(kind: String, id: String)
    fun openTrackMenu(track: Track, ctx: PlayContext)
    fun share(path: String, title: String)
    fun say(message: String)
}

object NoActions : Actions {
    override fun navigate(route: String) = Unit
    override fun back() = Unit
    override fun play(tracks: List<Track>, index: Int, ctx: PlayContext, shuffle: Boolean) = Unit
    override fun togglePlay() = Unit
    override fun playWave() = Unit
    override fun openWaveSettings() = Unit
    override fun toggleSaved(kind: String, id: String) = Unit
    override fun openTrackMenu(track: Track, ctx: PlayContext) = Unit
    override fun share(path: String, title: String) = Unit
    override fun say(message: String) = Unit
}

val LocalEnv = compositionLocalOf { Env() }
val LocalActions = staticCompositionLocalOf<Actions> { NoActions }

/** Height of the bottom bar + mini player, so lists can scroll clear of them. */
val LocalBottomInset = compositionLocalOf<Dp> { 80.dp }
