package com.sonora.app.playback

import android.content.ComponentName
import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.net.Track
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

data class PlayerUi(
    val track: Track? = null,
    val context: PlayContext? = null,
    val isPlaying: Boolean = false,
    val buffering: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val queue: List<Track> = emptyList(),
    val index: Int = 0,
    val shuffle: Boolean = false,
    val repeat: Int = Player.REPEAT_MODE_OFF,
    val error: String? = null,
)

/** The UI's handle on the playback service (a MediaController), as observable state + commands. */
@UnstableApi
@Singleton
class PlayerConnection @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: SonoraApi,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var controller: MediaController? = null
    private val _state = MutableStateFlow(PlayerUi())
    val state: StateFlow<PlayerUi> = _state
    private var ticker: Job? = null
    private var refilling = false

    fun connect() {
        if (controller != null) return
        scope.launch {
            val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
            val c = runCatching { MediaController.Builder(context, token).buildAsync().await() }.getOrNull() ?: return@launch
            controller = c
            c.addListener(object : Player.Listener {
                override fun onEvents(player: Player, events: Player.Events) = publish()
            })
            publish()
        }
    }

    private fun publish() {
        val c = controller ?: return
        val items = (0 until c.mediaItemCount).map(c::getMediaItemAt)
        val current = c.currentMediaItem
        _state.value = PlayerUi(
            track = QueueCodec.track(current),
            context = QueueCodec.context(current),
            isPlaying = c.isPlaying,
            buffering = c.playbackState == Player.STATE_BUFFERING,
            positionMs = c.currentPosition.coerceAtLeast(0),
            durationMs = c.duration.takeIf { it > 0 } ?: QueueCodec.track(current)?.durationMs ?: 0,
            queue = items.mapNotNull(QueueCodec::track),
            index = c.currentMediaItemIndex,
            shuffle = c.shuffleModeEnabled,
            repeat = c.repeatMode,
            error = c.playerError?.let { "Не удалось воспроизвести: ${it.errorCodeName}" },
        )
        if (c.isPlaying) startTicker() else stopTicker()
        maybeRefillWave(items, c.currentMediaItemIndex)
    }

    private fun startTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                controller?.let { _state.value = _state.value.copy(positionMs = it.currentPosition.coerceAtLeast(0)) }
                delay(500)
            }
        }
    }

    private fun stopTicker() {
        ticker?.cancel()
        ticker = null
    }

    fun play(tracks: List<Track>, start: Int, ctx: PlayContext, shuffle: Boolean = false) {
        val c = controller ?: return connectThen { play(tracks, start, ctx, shuffle) }
        val playable = tracks.filter { it.playable }
        if (playable.isEmpty()) return
        val startTrack = tracks.getOrNull(start)?.takeIf { it.playable } ?: playable.first()
        c.shuffleModeEnabled = shuffle
        c.setMediaItems(playable.map { QueueCodec.item(it, ctx) }, playable.indexOf(startTrack), 0)
        c.prepare()
        c.play()
    }

    /** Endless "Моя волна": new tracks from /v1/me/wave, never repeating what is already queued. */
    fun playWave() = scope.launch {
        val tracks = runCatching { api.wave(25) }.getOrNull().orEmpty()
        if (tracks.isNotEmpty()) play(tracks, 0, PlayContext("wave", null, "Моя волна"))
    }

    private fun maybeRefillWave(items: List<MediaItem>, index: Int) {
        val ctx = QueueCodec.context(items.getOrNull(index)) ?: return
        if (ctx.type != "wave" || refilling || items.size - index > 3) return
        refilling = true
        scope.launch {
            val queued = items.map { it.mediaId }
            var more = runCatching { api.wave(25, queued.takeLast(200)) }.getOrNull().orEmpty()
            if (more.isEmpty()) more = runCatching { api.wave(25, queued.takeLast(10)) }.getOrNull().orEmpty()
            controller?.addMediaItems(more.map { QueueCodec.item(it, ctx) })
            refilling = false
        }
    }

    fun toggle() {
        val c = controller ?: return
        if (c.isPlaying) c.pause() else {
            if (c.playbackState == Player.STATE_IDLE) c.prepare()
            c.play()
        }
    }

    fun next() {
        controller?.seekToNextMediaItem()
    }

    fun previous() {
        val c = controller ?: return
        if (c.currentPosition > 3000 || !c.hasPreviousMediaItem()) c.seekTo(0) else c.seekToPreviousMediaItem()
    }

    fun seekTo(ms: Long) {
        controller?.seekTo(ms)
    }

    fun skipTo(index: Int) {
        val c = controller ?: return
        c.seekToDefaultPosition(index)
        c.play()
    }

    fun setShuffle(on: Boolean) {
        controller?.shuffleModeEnabled = on
    }

    fun cycleRepeat() {
        val c = controller ?: return
        c.repeatMode = when (c.repeatMode) {
            Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
            Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
    }

    fun playNext(track: Track, ctx: PlayContext) {
        val c = controller ?: return connectThen { playNext(track, ctx) }
        if (c.mediaItemCount == 0) return play(listOf(track), 0, ctx)
        c.addMediaItem(c.currentMediaItemIndex + 1, QueueCodec.item(track, ctx))
    }

    fun addToQueue(track: Track, ctx: PlayContext) {
        val c = controller ?: return connectThen { addToQueue(track, ctx) }
        if (c.mediaItemCount == 0) return play(listOf(track), 0, ctx)
        c.addMediaItem(QueueCodec.item(track, ctx))
    }

    fun removeAt(index: Int) {
        val c = controller ?: return
        if (index != c.currentMediaItemIndex) c.removeMediaItem(index)
    }

    fun move(from: Int, to: Int) {
        controller?.moveMediaItem(from, to)
    }

    private fun connectThen(action: () -> Unit) {
        connect()
        scope.launch {
            repeat(20) {
                if (controller != null) return@launch action()
                delay(100)
            }
        }
    }
}
