package com.sonora.app.data.net

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Route
import javax.inject.Inject
import javax.inject.Provider
import javax.inject.Singleton

private val Context.sessionStore by preferencesDataStore(name = "session")

data class Tokens(val access: String, val refresh: String, val deviceId: String)

/** Access/refresh tokens in DataStore, mirrored in memory for the OkHttp interceptors. */
@Singleton
class SessionStore @Inject constructor(@ApplicationContext private val context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val access = stringPreferencesKey("access")
    private val refresh = stringPreferencesKey("refresh")
    private val device = stringPreferencesKey("device")
    private val _tokens = MutableStateFlow<Tokens?>(null)
    val tokens: StateFlow<Tokens?> = _tokens

    /** Device id survives logout so a re-login on this phone reuses the same device row. */
    @Volatile var deviceId: String? = null
        private set

    init {
        runBlocking(Dispatchers.IO) {
            val p = context.sessionStore.data.first()
            deviceId = p[device]
            val a = p[access]
            val r = p[refresh]
            if (a != null && r != null) _tokens.value = Tokens(a, r, p[device] ?: "")
        }
    }

    fun save(t: TokenOut) {
        _tokens.value = Tokens(t.accessToken, t.refreshToken, t.deviceId)
        deviceId = t.deviceId
        scope.launch {
            context.sessionStore.edit {
                it[access] = t.accessToken
                it[refresh] = t.refreshToken
                it[device] = t.deviceId
            }
        }
    }

    fun clear() {
        _tokens.value = null
        scope.launch {
            context.sessionStore.edit {
                it.remove(access)
                it.remove(refresh)
            }
        }
    }
}

class AuthInterceptor @Inject constructor(private val session: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val token = session.tokens.value?.access
        val request = chain.request()
        if (token == null || request.header("Authorization") != null) return chain.proceed(request)
        return chain.proceed(request.newBuilder().header("Authorization", "Bearer $token").build())
    }
}

/**
 * On 401 swap the refresh token for a new pair once and retry; concurrent 401s share one refresh.
 * A rejected refresh token signs the user out (the UI observes [SessionStore.tokens]).
 */
class TokenAuthenticator @Inject constructor(
    private val session: SessionStore,
    private val api: Provider<SonoraApi>,
) : Authenticator {
    override fun authenticate(route: Route?, response: okhttp3.Response): Request? {
        if (response.request.url.encodedPath.endsWith("/auth/refresh")) return null
        if (responseCount(response) >= 2) return null
        val sent = response.request.header("Authorization")?.removePrefix("Bearer ")
        synchronized(this) {
            val current = session.tokens.value ?: return null
            if (current.access != sent) {
                return response.request.newBuilder().header("Authorization", "Bearer ${current.access}").build()
            }
            val refreshed = runCatching { api.get().refreshBlocking(RefreshIn(current.refresh)).execute() }.getOrNull()
            val body = refreshed?.body()
            if (refreshed == null) return null // network error: keep the session, fail this call
            if (!refreshed.isSuccessful || body == null) {
                session.clear()
                return null
            }
            session.save(body)
            return response.request.newBuilder().header("Authorization", "Bearer ${body.accessToken}").build()
        }
    }

    private fun responseCount(response: okhttp3.Response): Int {
        var n = 1
        var r = response.priorResponse
        while (r != null) {
            n++
            r = r.priorResponse
        }
        return n
    }
}
