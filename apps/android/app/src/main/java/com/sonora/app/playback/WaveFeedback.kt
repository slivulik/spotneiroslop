package com.sonora.app.playback

import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import com.sonora.app.data.repo.WaveRepository
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Turns real player events into «Моя волна» feedback for items queued from a wave session:
 * `started` when an item begins playing, `finished` when it ends by itself, `skipped` (+ played_ms)
 * when the user moves to another item before the end, `liked` / `disliked` from the UI.
 * The listener sits on the service's player, so it reports with the UI closed too. Main thread only.
 */
@Singleton
class WaveFeedback @Inject constructor(private val waves: WaveRepository) {
    private var startedId: String? = null
    /** Disliked item the player is about to leave: that skip is already explained. */
    private var dislikedId: String? = null

    fun listener(player: Player): Player.Listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (!isPlaying) return
            val item = player.currentMediaItem ?: return
            if (startedId == item.mediaId) return
            startedId = item.mediaId
            send(item, "started")
        }

        override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
            val old = oldPosition.mediaItem ?: return
            val left = oldPosition.mediaItemIndex != newPosition.mediaItemIndex || old.mediaId != newPosition.mediaItem?.mediaId
            when (reason) {
                Player.DISCONTINUITY_REASON_AUTO_TRANSITION -> send(old, "finished")
                Player.DISCONTINUITY_REASON_SEEK -> if (left) {
                    if (dislikedId == old.mediaId) dislikedId = null else send(old, "skipped", oldPosition.positionMs)
                }
                else -> Unit
            }
            if (left && startedId == old.mediaId) startedId = null
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            // The last item of a queue ends without a transition.
            if (playbackState == Player.STATE_ENDED) player.currentMediaItem?.let { send(it, "finished") }
        }
    }

    fun liked(item: MediaItem) = send(item, "liked")

    fun disliked(item: MediaItem, positionMs: Long) {
        if (sessionOf(item) == null) return
        dislikedId = item.mediaId
        send(item, "disliked", positionMs)
    }

    private fun send(item: MediaItem, action: String, playedMs: Long? = null) {
        val session = sessionOf(item) ?: return
        waves.feedback(session, item.mediaId, action, playedMs)
    }

    companion object {
        /** Wave session of a queue item (its context id), or null outside the wave. */
        fun sessionOf(item: MediaItem?): String? = QueueCodec.context(item)?.takeIf { it.type == "wave" }?.id
    }
}
