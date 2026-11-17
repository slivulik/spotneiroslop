package com.sonora.app.playback

import android.content.ComponentName
import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.sonora.app.data.net.Track
import com.sonora.app.data.repo.WaveRepository
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
    private val waves: WaveRepository,
    private val feedback: WaveFeedback,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var controller: MediaController? = null
    private val _state = MutableStateFlow(PlayerUi())
    val state: StateFlow<PlayerUi> = _state
    private var ticker: Job? = null
    private var refilling = false
    /** Changes when the wave's upcoming items are replaced; a refill started before is then dropped. */
    private var waveGeneration = 0
    /** After a refill that added nothing, wait before asking again (no request storm per player event). */
    private var refillPausedUntil = 0L
    private var waveRestart: Job? = null

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

    /** Fine-grained position for the karaoke lyrics (the published state ticks only twice a second). */
    fun positionMs(): Long = controller?.currentPosition?.coerceAtLeast(0) ?: _state.value.positionMs

    /**
     * Endless «Моя волна»: a new server session with the current wave settings; its id travels with
     * every queued item (and survives process death through the saved queue). False if it failed.
     */
    suspend fun startWave(): Boolean {
        val batch = waves.start() ?: return false
        val tracks = batch.tracks.filter { it.playable }
        if (tracks.isEmpty()) return false
        waveGeneration++
        refillPausedUntil = 0
        play(tracks, 0, waveContext(batch.sessionId))
        return true
    }

    private fun waveContext(sessionId: String?) = PlayContext("wave", sessionId, WAVE_TITLE)

    private fun maybeRefillWave(items: List<MediaItem>, index: Int) {
        val ctx = QueueCodec.context(items.getOrNull(index)) ?: return
        if (ctx.type != "wave" || refilling || items.size - index > 3) return
        if (System.currentTimeMillis() < refillPausedUntil) return
        // The newest session sits at the end of the queue (settings changes replace upcoming items).
        val session = items.asReversed().firstNotNullOfOrNull { WaveFeedback.sessionOf(it) } ?: ctx.id
        val generation = waveGeneration
        refilling = true
        scope.launch {
            val queued = items.map { it.mediaId }
            val batch = waves.more(session, queued)
            // The server never repeats within a session; a fresh session (after a restart) might.
            val recent = queued.takeLast(30).toHashSet()
            val fresh = batch?.tracks.orEmpty().filter { it.playable && it.id !in recent }
            val c = controller
            if (generation == waveGeneration) {
                if (c != null && batch != null && fresh.isNotEmpty()) {
                    c.addMediaItems(fresh.map { QueueCodec.item(it, waveContext(batch.sessionId)) })
                } else {
                    refillPausedUntil = System.currentTimeMillis() + 30_000
                }
            }
            refilling = false
        }
    }

    /**
     * Wave settings changed: while the wave plays, start a new session and replace the upcoming
     * items (never the current track). Debounced, so tapping through the chips makes one request.
     */
    fun onWaveSettingsChanged() {
        waveRestart?.cancel()
        waveRestart = scope.launch {
            delay(600)
            if (QueueCodec.context(controller?.currentMediaItem)?.type != "wave") return@launch
            val batch = waves.start() ?: return@launch
            val c = controller ?: return@launch
            val current = c.currentMediaItem ?: return@launch
            if (QueueCodec.context(current)?.type != "wave") return@launch
            val fresh = batch.tracks.filter { it.playable && it.id != current.mediaId }
            if (fresh.isEmpty()) return@launch
            waveGeneration++
            refillPausedUntil = 0
            refilling = true // removing items must not trigger a refill from the old session
            val from = c.currentMediaItemIndex + 1
            if (from < c.mediaItemCount) c.removeMediaItems(from, c.mediaItemCount)
            c.addMediaItems(fresh.map { QueueCodec.item(it, waveContext(batch.sessionId)) })
            refilling = false
        }
    }

    /** Liked in the app: during the wave this is also a strong positive signal for the session. */
    fun onLiked(trackId: String) {
        val item = controller?.currentMediaItem ?: return
        if (item.mediaId == trackId) feedback.liked(item)
    }

    /** «Не нравится» in the wave: tell the session, then move on. */
    fun dislike() {
        val c = controller ?: return
        val item = c.currentMediaItem ?: return
        feedback.disliked(item, c.currentPosition)
        c.seekToNextMediaItem()
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

    private companion object {
        const val WAVE_TITLE = "Моя волна"
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
