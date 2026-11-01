package com.sonora.app.playback

import android.app.PendingIntent
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.sonora.app.MainActivity
import com.sonora.app.data.db.QueueState
import com.sonora.app.data.db.SonoraDatabase
import com.sonora.app.data.repo.EventsRepository
import com.sonora.app.data.repo.SettingsRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.io.File
import javax.inject.Inject
import javax.inject.Named

/**
 * Background playback: ExoPlayer + HLS behind a MediaSession (notification, lock screen,
 * Bluetooth/headset buttons, Android Auto-style controllers). Audio focus and "becoming noisy"
 * (headphones unplugged) are handled by ExoPlayer itself.
 */
@UnstableApi
@AndroidEntryPoint
class PlaybackService : MediaSessionService() {
    @Inject lateinit var resolver: StreamResolver
    @Inject @Named("media") lateinit var mediaClient: OkHttpClient
    @Inject lateinit var settings: SettingsRepository
    @Inject lateinit var events: EventsRepository
    @Inject lateinit var db: SonoraDatabase

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val main = Handler(Looper.getMainLooper())
    private lateinit var player: ExoPlayer
    private var session: MediaSession? = null
    private val equalizer = EqualizerController()
    private var networkWait: ConnectivityManager.NetworkCallback? = null
    private var retriesForItem = 0

    // Listening time of the current item, for play_start / play_end events.
    private var listenedMs = 0L
    private var playingSince = 0L
    private var startedFor: String? = null

    override fun onCreate() {
        super.onCreate()
        val upstream = OkHttpDataSource.Factory(mediaClient)
        val cached = CacheDataSource.Factory()
            .setCache(cache(this, settings.initial.cacheMb))
            .setUpstreamDataSourceFactory(upstream)
            // Storage links are re-signed on every resolve: key segments by path, not by signature.
            .setCacheKeyFactory { spec -> spec.uri.buildUpon().clearQuery().build().toString() }
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        val sources = DefaultMediaSourceFactory(this).setDataSourceFactory(ResolvingDataSource.Factory(cached, resolver))

        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(sources)
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        player.setAudioSessionId(Util.generateAudioSessionIdV21(this))
        equalizer.attach(player.audioSessionId)
        player.addListener(listener)

        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        setMediaNotificationProvider(
            androidx.media3.session.DefaultMediaNotificationProvider.Builder(this).build().apply { setSmallIcon(com.sonora.app.R.drawable.ic_notification) },
        )
        session = MediaSession.Builder(this, player)
            .setCallback(SessionCallback())
            .setSessionActivity(open)
            .build()

        scope.launch {
            settings.settings.map { Triple(it.eqEnabled, it.eqBands, it.eqPreamp) }.distinctUntilChanged().collect { (on, bands, _) ->
                equalizer.apply(on, bands)
                applyVolume()
            }
        }
        scope.launch { restoreQueue() }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /** Swiping the app away keeps music playing; stop the service only when nothing plays. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        endListening()
        saveQueue()
        networkWait?.let { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it) }
        equalizer.release()
        session?.run {
            player.release()
            release()
        }
        session = null
        scope.cancel()
        super.onDestroy()
    }

    private inner class SessionCallback : MediaSession.Callback {
        /** Controllers send ids + metadata only; the playable URI is attached here. */
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> = Futures.immediateFuture(mediaItems.map(::playable).toMutableList())

        /** "Play" from a headset or the system media controls after the app was killed. */
        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val future = com.google.common.util.concurrent.SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
            scope.launch {
                val saved = withContext(Dispatchers.IO) { db.queue().get() }
                val items = saved?.let { QueueCodec.decode(it.json) }.orEmpty()
                if (items.isEmpty()) future.setException(UnsupportedOperationException("Nothing to resume"))
                else future.set(MediaSession.MediaItemsWithStartPosition(items.map(::playable), saved!!.index, saved.positionMs))
            }
            return future
        }
    }

    private fun playable(item: MediaItem): MediaItem =
        item.buildUpon().setUri(StreamResolver.uriFor(item.mediaId)).setMimeType(MimeTypes.APPLICATION_M3U8).build()

    private val listener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            endListening()
            retriesForItem = 0
            applyVolume()
            saveQueue()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            val item = player.currentMediaItem ?: return
            if (isPlaying) {
                playingSince = System.currentTimeMillis()
                if (startedFor != item.mediaId) {
                    startedFor = item.mediaId
                    listenedMs = 0
                    record("play_start", item, 0)
                }
                applyVolume()
            } else {
                if (playingSince > 0) listenedMs += System.currentTimeMillis() - playingSince
                playingSince = 0
                saveQueue()
            }
        }

        override fun onPlaybackStateChanged(state: Int) {
            if (state == Player.STATE_ENDED) endListening()
        }

        override fun onPlayerError(error: PlaybackException) {
            val id = player.currentMediaItem?.mediaId ?: return
            val wasPlaying = player.playWhenReady
            val position = player.currentPosition
            val http = (error.cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode
            when {
                // Expired or revoked links: resolve again and continue in place.
                (http == 401 || http == 403 || http == 404 || http == 410) && retriesForItem < 2 -> {
                    retriesForItem++
                    resolver.invalidate(id)
                    resume(position, wasPlaying)
                }
                // No network: wait for it, then continue from the same position.
                error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
                    error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> waitForNetwork(position, wasPlaying)
                // Unplayable item: skip it rather than stopping the whole queue.
                player.hasNextMediaItem() && retriesForItem >= 1 -> {
                    player.seekToNextMediaItem()
                    player.prepare()
                    player.playWhenReady = wasPlaying
                }
                else -> {
                    retriesForItem++
                    resolver.invalidate(id)
                    if (retriesForItem <= 1) resume(position, wasPlaying)
                }
            }
        }
    }

    private fun resume(position: Long, play: Boolean) {
        player.seekTo(position)
        player.prepare()
        player.playWhenReady = play
    }

    private fun waitForNetwork(position: Long, play: Boolean) {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        networkWait?.let { cm.unregisterNetworkCallback(it) }
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                main.post {
                    networkWait?.let { cm.unregisterNetworkCallback(it) }
                    networkWait = null
                    resume(position, play)
                }
            }
        }
        networkWait = callback
        cm.registerDefaultNetworkCallback(callback)
    }

    private fun applyVolume() {
        val item = player.currentMediaItem ?: return
        val s = settings.settings.value
        val inAlbum = item.mediaMetadata.extras?.getString(QueueCodec.CONTEXT_TYPE) == "release"
        val gain = resolver.gainFactor(item.mediaId, s.normalization, inAlbum) ?: 1f
        val preamp = if (s.eqEnabled && s.eqPreamp < 0) Math.pow(10.0, s.eqPreamp / 20.0).toFloat() else 1f
        player.volume = (gain * preamp).coerceIn(0f, 1f)
    }

    private fun record(type: String, item: MediaItem, ms: Long) {
        val extras = item.mediaMetadata.extras
        events.record(type, item.mediaId, ms, extras?.getString(QueueCodec.CONTEXT_TYPE), extras?.getString(QueueCodec.CONTEXT_ID))
    }

    private fun endListening() {
        val id = startedFor ?: return
        if (playingSince > 0) listenedMs += System.currentTimeMillis() - playingSince
        val item = (0 until player.mediaItemCount).map(player::getMediaItemAt).firstOrNull { it.mediaId == id }
        if (item != null) record("play_end", item, listenedMs)
        startedFor = null
        listenedMs = 0
        playingSince = if (player.isPlaying) System.currentTimeMillis() else 0
    }

    private fun saveQueue() {
        if (player.mediaItemCount == 0) return
        val items = (0 until player.mediaItemCount).map(player::getMediaItemAt)
        val state = QueueState(json = QueueCodec.encode(items), index = player.currentMediaItemIndex, positionMs = player.currentPosition)
        CoroutineScope(Dispatchers.IO).launch { db.queue().put(state) }
    }

    private suspend fun restoreQueue() {
        if (player.mediaItemCount > 0) return
        val saved = withContext(Dispatchers.IO) { db.queue().get() } ?: return
        val items = QueueCodec.decode(saved.json)
        if (items.isEmpty() || player.mediaItemCount > 0) return
        player.setMediaItems(items.map(::playable), saved.index.coerceIn(0, items.lastIndex), saved.positionMs)
        player.prepare() // paused: the user decides when to continue
    }

    companion object {
        @Volatile private var simpleCache: SimpleCache? = null

        /** One process-wide segment cache (LRU, size from settings, applied on next start). */
        fun cache(context: android.content.Context, megabytes: Int): SimpleCache =
            simpleCache ?: synchronized(this) {
                simpleCache ?: SimpleCache(
                    File(context.cacheDir, "audio"),
                    LeastRecentlyUsedCacheEvictor(megabytes.coerceIn(64, 4096) * 1024L * 1024L),
                    StandaloneDatabaseProvider(context),
                ).also { simpleCache = it }
            }
    }
}
