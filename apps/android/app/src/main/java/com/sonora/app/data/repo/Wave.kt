package com.sonora.app.data.repo

import android.content.Context
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.net.Track
import com.sonora.app.data.net.WaveFeedbackIn
import com.sonora.app.data.net.WaveSettings
import com.sonora.app.data.net.WaveStartIn
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

private val Context.waveStore by preferencesDataStore(name = "wave")

/** Tracks for the queue and the session they belong to (null: server without Wave 2.0 sessions). */
data class WaveBatch(val sessionId: String?, val tracks: List<Track>)

/**
 * «Моя волна» 2.0: the user's wave settings (DataStore, initialised from the server) and the
 * session calls. Settings changed on this phone stay "pending" until a session has been started
 * with them, so a pull never overwrites a choice the server has not seen yet.
 */
@Singleton
class WaveRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: SonoraApi,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private object K {
        val character = stringPreferencesKey("character")
        val mood = stringPreferencesKey("mood")
        val language = stringPreferencesKey("language")
        val pending = booleanPreferencesKey("pending")
    }

    private val _settings = MutableStateFlow(WaveSettings())
    val settings: StateFlow<WaveSettings> = _settings
    private val loaded = CompletableDeferred<Unit>()

    /** Bumped on every local change; a slower network answer never overwrites a newer choice. */
    @Volatile private var version = 0

    init {
        scope.launch {
            val stored = runCatching { read(context.waveStore.data.first()) }.getOrDefault(WaveSettings())
            if (version == 0) _settings.value = stored
            loaded.complete(Unit)
        }
    }

    private fun read(p: Preferences) = WaveSettings(p[K.character], p[K.mood], p[K.language])

    private fun MutablePreferences.write(s: WaveSettings) {
        putOrRemove(K.character, s.character)
        putOrRemove(K.mood, s.mood)
        putOrRemove(K.language, s.language)
    }

    private fun MutablePreferences.putOrRemove(key: Preferences.Key<String>, value: String?) {
        if (value == null) remove(key) else this[key] = value
    }

    /** Local change from the settings sheet (the UI updates at once, DataStore in the background). */
    fun update(s: WaveSettings) {
        version++
        _settings.value = s
        scope.launch {
            context.waveStore.edit {
                it.write(s)
                it[K.pending] = true
            }
        }
    }

    /** Server copy (settings of the latest session), unless this phone has a newer unsent choice. */
    suspend fun pull() {
        loaded.await()
        if (context.waveStore.data.first()[K.pending] == true) return
        val before = version
        val remote = try {
            api.waveSettings()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return
        }
        if (version != before) return
        _settings.value = remote
        context.waveStore.edit { it.write(remote) }
    }

    /** Signed out: forget the previous account's choice. */
    fun reset() {
        version++
        _settings.value = WaveSettings()
        scope.launch { context.waveStore.edit { it.clear() } }
    }

    /** A new session with the current settings; null when offline or the server refused. */
    suspend fun start(exclude: List<String> = emptyList()): WaveBatch? {
        loaded.await()
        val before = version
        val sent = _settings.value
        val session = try {
            api.startWaveSession(WaveStartIn(settings = sent))
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpException) {
            // 404 on this route = a server without Wave 2.0: fall back to the stateless wave.
            return if (e.code() == 404) legacy(exclude) else null
        } catch (e: Exception) {
            return null
        }
        if (version == before) context.waveStore.edit { it[K.pending] = false }
        return WaveBatch(session.sessionId, session.tracks)
    }

    /**
     * More tracks for a playing wave. An unknown session (expired on the server, or the queue was
     * restored after the app was killed) starts a new one with the same settings.
     */
    suspend fun more(sessionId: String?, queued: List<String>): WaveBatch? {
        if (sessionId == null) return start(queued)
        return try {
            WaveBatch(sessionId, api.waveNext(sessionId, 10))
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpException) {
            if (e.code() == 404) start(queued) else null
        } catch (e: Exception) {
            null
        }
    }

    private suspend fun legacy(queued: List<String>): WaveBatch? = try {
        WaveBatch(null, api.wave(25, queued.takeLast(200)))
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    /** Fire-and-forget: feedback never blocks or breaks playback. */
    fun feedback(sessionId: String, trackId: String, action: String, playedMs: Long? = null) {
        scope.launch { runCatching { api.waveFeedback(sessionId, WaveFeedbackIn(trackId, action, playedMs?.coerceAtLeast(0))) } }
    }
}
