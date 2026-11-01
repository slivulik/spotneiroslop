package com.sonora.app.playback

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.net.Stream
import com.sonora.app.data.repo.ServerAddress
import com.sonora.app.data.repo.SettingsRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.pow

/**
 * Queue items carry `sonora://track/{id}`; when ExoPlayer opens one, this asks the API for a stream
 * (a media playlist whose segments are absolute, short-lived storage URLs) in the quality the
 * current network allows. Results are reused until shortly before they expire.
 */
@UnstableApi
@Singleton
class StreamResolver @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: SonoraApi,
    private val server: ServerAddress,
    private val settings: SettingsRepository,
) : ResolvingDataSource.Resolver {
    private data class Entry(val stream: Stream, val expiresAt: Long)
    private val resolved = ConcurrentHashMap<String, Entry>()

    override fun resolveDataSpec(dataSpec: DataSpec): DataSpec {
        if (dataSpec.uri.scheme != SCHEME) return dataSpec
        val id = dataSpec.uri.lastPathSegment ?: return dataSpec
        val stream = streamFor(id, dataSpec)
        return dataSpec.withUri(Uri.parse(server.absolute(stream.url)))
    }

    private fun streamFor(id: String, spec: DataSpec): Stream {
        resolved[id]?.takeIf { it.expiresAt > System.currentTimeMillis() }?.let { return it.stream }
        val response = try {
            api.streamBlocking(id, quality()).execute()
        } catch (e: IOException) {
            throw HttpDataSource.HttpDataSourceException(e, spec, androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, HttpDataSource.HttpDataSourceException.TYPE_OPEN)
        }
        val body = response.body()
        if (!response.isSuccessful || body == null) {
            throw HttpDataSource.InvalidResponseCodeException(response.code(), response.message(), null, emptyMap(), spec, ByteArray(0))
        }
        val ttl = (body.expiresIn - 300).coerceAtLeast(60) * 1000
        resolved[id] = Entry(body, System.currentTimeMillis() + ttl)
        return body
    }

    /** Forget a stream link (expired or revoked); the next open asks the API again. */
    fun invalidate(id: String) {
        resolved.remove(id)
    }

    /** Volume factor for loudness normalisation: never above 1 (no clipping), null when unknown. */
    fun gainFactor(id: String, mode: String, inAlbumContext: Boolean): Float? {
        val s = resolved[id]?.stream ?: return null
        val db = when (mode) {
            "off" -> return 1f
            "album" -> s.albumGain ?: s.trackGain
            "track" -> s.trackGain
            else -> if (inAlbumContext) s.albumGain ?: s.trackGain else s.trackGain
        } ?: return 1f
        return 10.0.pow(db / 20.0).toFloat().coerceIn(0.05f, 1f)
    }

    private fun quality(): String {
        val s = settings.settings.value
        val cellular = isCellular()
        val chosen = if (cellular) s.qualityCellular else s.qualityWifi
        return when (chosen) {
            "auto" -> if (cellular) "high" else "lossless"
            else -> chosen
        }
    }

    private fun isCellular(): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    companion object {
        const val SCHEME = "sonora"
        fun uriFor(trackId: String): Uri = Uri.parse("$SCHEME://track/$trackId")
    }
}
