package com.sonora.app.ui.screens

import android.content.Context
import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.net.PlaylistSummary
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.net.Track
import com.sonora.app.data.repo.AuthRepository
import com.sonora.app.data.repo.EventsRepository
import com.sonora.app.data.repo.LibraryRepository
import com.sonora.app.data.repo.ServerAddress
import com.sonora.app.data.repo.SettingsRepository
import com.sonora.app.playback.PlayContext
import com.sonora.app.playback.PlayerConnection
import com.sonora.app.ui.components.TrackActions
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Activity-wide state: session, library ids, player, snackbar messages and the playlist picker. */
@UnstableApi
@HiltViewModel
class AppViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    val auth: AuthRepository,
    val library: LibraryRepository,
    val player: PlayerConnection,
    val settings: SettingsRepository,
    private val events: EventsRepository,
    private val api: SonoraApi,
    private val server: ServerAddress,
) : ViewModel() {
    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    /** Track waiting for a playlist choice (null = picker closed). */
    private val _picking = MutableStateFlow<Track?>(null)
    val picking: StateFlow<Track?> = _picking
    private val _playlists = MutableStateFlow<List<PlaylistSummary>>(emptyList())
    val playlists: StateFlow<List<PlaylistSummary>> = _playlists

    init {
        player.connect()
        viewModelScope.launch {
            if (auth.signedIn.value != null) {
                settings.pull()
                library.refresh()
            }
            events.flush()
        }
    }

    fun say(text: String) {
        _messages.trySend(text)
    }

    fun actions(navigate: (String) -> Unit, context: PlayContext) = TrackActions(
        onPlayNext = { player.playNext(it, context); say("Будет следующим") },
        onAddToQueue = { player.addToQueue(it, context); say("Добавлено в очередь") },
        onAddToPlaylist = ::pickPlaylist,
        onOpenAlbum = { navigate("album/$it") },
        onOpenArtist = { navigate("artist/$it") },
        onShare = { share("/track/${it.id}", "${it.fullTitle} — ${it.artistLine}") },
        isLiked = { library.ids.value.tracks.contains(it) },
        onToggleLike = { toggle("tracks", it.id) },
    )

    fun toggle(kind: String, id: String) = viewModelScope.launch {
        if (!library.toggle(kind, id)) say("Не удалось сохранить — нет соединения")
    }

    fun pickPlaylist(track: Track) {
        _picking.value = track
        viewModelScope.launch { _playlists.value = runCatching { api.myPlaylists() }.getOrDefault(emptyList()).filter { it.type == "user" && it.ownerName == null } }
    }

    fun closePicker() {
        _picking.value = null
    }

    fun addToPlaylist(playlist: PlaylistSummary?) {
        val track = _picking.value ?: return
        _picking.value = null
        viewModelScope.launch {
            val ok = runCatching {
                if (playlist == null) library.createPlaylist(track.title, listOf(track.id)).let { true } else library.addToPlaylist(playlist.id, listOf(track.id))
            }.getOrDefault(false)
            say(if (!ok) "Не удалось добавить" else if (playlist == null) "Плейлист создан" else "Добавлено в «${playlist.title}»")
        }
    }

    /** Same links as the web app's share button (they open the web page with a preview card). */
    fun share(path: String, title: String) {
        val url = server.absolute(path)
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "$title\n$url").putExtra(Intent.EXTRA_SUBJECT, title)
        context.startActivity(Intent.createChooser(send, "Поделиться").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun logout() = viewModelScope.launch { auth.logout() }
}
