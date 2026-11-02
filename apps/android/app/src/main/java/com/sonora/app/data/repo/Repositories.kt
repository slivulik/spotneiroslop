package com.sonora.app.data.repo

import android.os.Build
import com.sonora.app.BuildConfig
import com.sonora.app.data.db.CachedJson
import com.sonora.app.data.db.PendingEvent
import com.sonora.app.data.db.SonoraDatabase
import com.sonora.app.data.net.ArtistSummary
import com.sonora.app.data.net.DeviceIn
import com.sonora.app.data.net.ErrorEnvelope
import com.sonora.app.data.net.EventsIn
import com.sonora.app.data.net.LibraryIds
import com.sonora.app.data.net.LoginIn
import com.sonora.app.data.net.PlayEvent
import com.sonora.app.data.net.PlaylistIn
import com.sonora.app.data.net.QueryIn
import com.sonora.app.data.net.SessionStore
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.net.TrackIdsIn
import com.sonora.app.di.AppModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import retrofit2.HttpException
import java.io.IOException
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** Base URL of the server (settings override, else the build default). */
@Singleton
class ServerAddress @Inject constructor(private val settings: dagger.Lazy<SettingsRepository>) {
    fun current(): String = settings.get().settings.value.baseUrl.ifBlank { AppModule.DEFAULT_BASE_URL }
    fun absolute(pathOrUrl: String): String =
        if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) pathOrUrl
        else current().trimEnd('/') + "/" + pathOrUrl.trimStart('/')
}

/** Result of a screen load: data plus whether it came from the offline cache. */
data class Loaded<T>(val data: T, val offline: Boolean)

private val MESSAGES = mapOf(
    "invalid_credentials" to "Неверная почта или пароль",
    "email_taken" to "Этот e-mail уже зарегистрирован — войдите",
    "account_blocked" to "Аккаунт заблокирован",
    "validation_error" to "Проверьте введённые данные",
    "rate_limited" to "Слишком много попыток — подождите минуту",
    "maintenance" to "Сервис на обслуживании, попробуйте позже",
)

fun Throwable.userMessage(json: Json): String = when (this) {
    is IOException -> "Нет соединения с сервером"
    is HttpException -> response()?.errorBody()?.string()
        ?.let { body -> runCatching { json.decodeFromString<ErrorEnvelope>(body).error }.getOrNull() }
        ?.let { MESSAGES[it.code] ?: it.message }
        ?: "Ошибка сервера (${code()})"
    else -> message ?: "Что-то пошло не так"
}

/** Network first; on failure the last good copy from Room (stale-while-offline). */
@Singleton
class OfflineCache @Inject constructor(private val db: SonoraDatabase, val json: Json) {
    suspend fun <T> load(key: String, serializer: KSerializer<T>, fetch: suspend () -> T): Loaded<T> =
        try {
            val fresh = fetch()
            db.cache().put(CachedJson(key, json.encodeToString(serializer, fresh), System.currentTimeMillis()))
            Loaded(fresh, offline = false)
        } catch (e: Exception) {
            if (e is HttpException && e.code() in 400..499 && e.code() != 401) throw e
            val cached = db.cache().get(key) ?: throw e
            Loaded(json.decodeFromString(serializer, cached.json), offline = true)
        }

    suspend inline fun <reified T> load(key: String, noinline fetch: suspend () -> T): Loaded<T> = load(key, serializer(), fetch)

    suspend fun clear() = db.cache().clear()
}

@Singleton
class AuthRepository @Inject constructor(
    private val api: SonoraApi,
    private val session: SessionStore,
    private val settings: SettingsRepository,
    private val cache: OfflineCache,
    private val library: LibraryRepository,
) {
    val signedIn: StateFlow<com.sonora.app.data.net.Tokens?> = session.tokens
    private val _me = MutableStateFlow<com.sonora.app.data.net.Me?>(null)
    /** The signed-in account (name for the avatar, role for the admin link). */
    val me: StateFlow<com.sonora.app.data.net.Me?> = _me

    suspend fun refreshMe() {
        if (session.tokens.value == null) return
        runCatching { api.me() }.onSuccess { _me.value = it }
    }

    private fun device() = DeviceIn(
        name = "Sonora на ${Build.MODEL}",
        model = "${Build.MANUFACTURER} ${Build.MODEL}",
        appVersion = BuildConfig.VERSION_NAME,
        deviceId = session.deviceId,
    )

    suspend fun register(name: String, email: String, password: String) {
        val tokens = api.register(com.sonora.app.data.net.RegisterIn(email.trim(), password, name.trim(), device()))
        session.save(tokens)
        _me.value = tokens.user
        settings.pull()
        library.refresh()
    }

    suspend fun login(email: String, password: String) {
        val tokens = api.login(LoginIn(email.trim(), password, device()))
        session.save(tokens)
        _me.value = tokens.user
        settings.pull()
        library.refresh()
    }

    suspend fun logout() {
        runCatching { api.logout() }
        session.clear()
        _me.value = null
        cache.clear()
        library.reset()
    }
}

/** Liked tracks/releases/followed artists as id sets, toggled optimistically and rolled back on failure. */
@Singleton
class LibraryRepository @Inject constructor(private val api: SonoraApi) {
    private val _ids = MutableStateFlow(LibraryIds())
    val ids: StateFlow<LibraryIds> = _ids
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    suspend fun refresh() {
        runCatching { api.libraryIds() }.onSuccess { _ids.value = it }
    }

    fun reset() {
        _ids.value = LibraryIds()
    }

    fun isSaved(kind: String, id: String): Boolean = when (kind) {
        "tracks" -> id in _ids.value.tracks
        "releases" -> id in _ids.value.releases
        "artists" -> id in _ids.value.artists
        else -> id in _ids.value.playlists
    }

    /** Returns false if the server rejected the change (the UI state is rolled back). */
    suspend fun toggle(kind: String, id: String): Boolean {
        val saved = isSaved(kind, id)
        mutate(kind, id, !saved)
        val ok = runCatching { if (saved) api.unsave(kind, id) else api.save(kind, id) }.getOrNull()?.isSuccessful == true
        if (!ok) mutate(kind, id, saved)
        return ok
    }

    private fun mutate(kind: String, id: String, saved: Boolean) = _ids.update { ids ->
        fun List<String>.with() = if (saved) (this + id).distinct() else this - id
        when (kind) {
            "tracks" -> ids.copy(tracks = ids.tracks.with())
            "releases" -> ids.copy(releases = ids.releases.with())
            "artists" -> ids.copy(artists = ids.artists.with())
            else -> ids.copy(playlists = ids.playlists.with())
        }
    }

    suspend fun createPlaylist(title: String, trackIds: List<String>) = api.createPlaylist(PlaylistIn(title, trackIds))
    suspend fun addToPlaylist(id: String, trackIds: List<String>) = api.addToPlaylist(id, TrackIdsIn(trackIds)).isSuccessful
    suspend fun followed(): List<ArtistSummary> = api.followedArtists()
    fun recordSearch(q: String) = scope.launch { runCatching { api.recordSearch(QueryIn(q)) } }
}

/** Play events: written to Room first, sent in batches; survives offline periods and app kills. */
@Singleton
class EventsRepository @Inject constructor(private val db: SonoraDatabase, private val api: SonoraApi, private val json: Json) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val sending = Mutex()

    fun record(type: String, trackId: String, msPlayed: Long, contextType: String?, contextId: String?) {
        val event = PlayEvent(UUID.randomUUID().toString(), type, trackId, msPlayed, Instant.now().toString(), contextType, contextId)
        scope.launch {
            db.events().add(PendingEvent(event.eventId, json.encodeToString(PlayEvent.serializer(), event), System.currentTimeMillis()))
            flush()
        }
    }

    suspend fun flush() = sending.withLock {
        while (true) {
            val batch = db.events().oldest(100)
            if (batch.isEmpty()) return@withLock
            val events = batch.map { json.decodeFromString(PlayEvent.serializer(), it.json) }
            val ok = runCatching { api.events(EventsIn(events)) }.getOrNull()
            when {
                ok == null -> return@withLock // offline: try again later
                ok.isSuccessful || ok.code() in 400..499 && ok.code() != 401 && ok.code() != 429 -> db.events().remove(batch.map { it.eventId })
                else -> return@withLock
            }
        }
    }
}
