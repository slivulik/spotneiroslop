package com.sonora.app.data.repo

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.sonora.app.data.net.SonoraApi
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import javax.inject.Inject
import javax.inject.Singleton

private val Context.settingsStore by preferencesDataStore(name = "settings")

enum class ThemeMode { System, Dark, Light }

data class AppSettings(
    val theme: ThemeMode = ThemeMode.Dark,
    val qualityWifi: String = "auto",
    val qualityCellular: String = "normal",
    val normalization: String = "auto",
    val eqEnabled: Boolean = false,
    val eqPreamp: Float = 0f,
    val eqBands: List<Float> = List(10) { 0f },
    val cacheMb: Int = 512,
    val baseUrl: String = "",
    /** "system" (follow Android's animation scale), "full" or "reduced" — same value as the web app. */
    val motion: String = "system",
)

/** Local settings (DataStore) synced with /v1/me/settings, the same document the web app edits. */
@Singleton
class SettingsRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: SonoraApi,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private object K {
        val theme = stringPreferencesKey("theme")
        val qWifi = stringPreferencesKey("quality_wifi")
        val qCell = stringPreferencesKey("quality_cellular")
        val norm = stringPreferencesKey("normalization")
        val eqOn = booleanPreferencesKey("eq_enabled")
        val eqPre = floatPreferencesKey("eq_preamp")
        val eqBands = stringPreferencesKey("eq_bands")
        val cache = intPreferencesKey("cache_mb")
        val baseUrl = stringPreferencesKey("base_url")
        val motion = stringPreferencesKey("motion")
    }

    private fun read(p: Preferences) = AppSettings(
        theme = when (p[K.theme]) { "light" -> ThemeMode.Light; "system" -> ThemeMode.System; else -> ThemeMode.Dark },
        qualityWifi = p[K.qWifi] ?: "auto",
        qualityCellular = p[K.qCell] ?: "normal",
        normalization = p[K.norm] ?: "auto",
        eqEnabled = p[K.eqOn] ?: false,
        eqPreamp = p[K.eqPre] ?: 0f,
        eqBands = p[K.eqBands]?.split(",")?.mapNotNull { it.toFloatOrNull() }?.takeIf { it.size == 10 } ?: List(10) { 0f },
        cacheMb = p[K.cache] ?: 512,
        baseUrl = p[K.baseUrl] ?: "",
        motion = p[K.motion] ?: "system",
    )

    /** Read once synchronously at startup (theme before the first frame, cache size for the player). */
    val initial: AppSettings = runBlocking(Dispatchers.IO) { read(context.settingsStore.data.first()) }

    val settings: StateFlow<AppSettings> =
        context.settingsStore.data.map(::read).stateIn(scope, SharingStarted.Eagerly, initial)

    fun setTheme(mode: ThemeMode) = update(buildJsonObject { putJsonObject("appearance") { put("theme", mode.name.lowercase()) } }) {
        it[K.theme] = mode.name.lowercase()
    }

    fun setMotion(mode: String) = update(buildJsonObject { putJsonObject("appearance") { put("motion", mode) } }) {
        it[K.motion] = mode
    }

    fun setQuality(wifi: String? = null, cellular: String? = null) = update(buildJsonObject {
        putJsonObject("audio") {
            wifi?.let { put("quality_wifi", it) }
            cellular?.let { put("quality_cellular", it) }
        }
    }) { p ->
        wifi?.let { p[K.qWifi] = it }
        cellular?.let { p[K.qCell] = it }
    }

    fun setNormalization(mode: String) = update(buildJsonObject { putJsonObject("audio") { put("normalization", mode) } }) {
        it[K.norm] = mode
    }

    fun setEqualizer(enabled: Boolean, preamp: Float, bands: List<Float>) = update(buildJsonObject {
        putJsonObject("equalizer") {
            put("enabled", enabled)
            put("preamp", preamp)
            putJsonArray("bands") { bands.forEach { add(JsonPrimitive(it)) } }
            put("preset", "custom")
        }
    }) {
        it[K.eqOn] = enabled
        it[K.eqPre] = preamp
        it[K.eqBands] = bands.joinToString(",")
    }

    /** Device-only settings: not part of the synced document. */
    fun setCacheMb(mb: Int) = scope.launch { context.settingsStore.edit { it[K.cache] = mb } }
    fun setBaseUrl(url: String) = scope.launch { context.settingsStore.edit { it[K.baseUrl] = url.trim().trimEnd('/') } }

    private var pending: Map<String, JsonObject> = emptyMap()
    private var push: Job? = null

    /** Local write now; the server gets one merged patch after edits settle (EQ sliders fire often). */
    private fun update(patch: JsonObject, local: (androidx.datastore.preferences.core.MutablePreferences) -> Unit) {
        scope.launch { context.settingsStore.edit(local) }
        synchronized(this) {
            pending = pending.toMutableMap().apply {
                patch.forEach { (section, value) -> put(section, JsonObject((get(section) ?: JsonObject(emptyMap())) + value.jsonObject)) }
            }
            push?.cancel()
            push = scope.launch {
                delay(700)
                val body = synchronized(this@SettingsRepository) { JsonObject(pending).also { pending = emptyMap() } }
                runCatching { api.patchSettings(body) } // offline: the local value stays and wins until the next change
            }
        }
    }

    /** Pull the account's settings after sign-in or app start; the server document is the source of truth. */
    suspend fun pull() {
        val doc = runCatching { api.settings() }.getOrNull() ?: return
        val appearance = doc["appearance"]?.jsonObject
        val audio = doc["audio"]?.jsonObject
        val eq = doc["equalizer"]?.jsonObject
        context.settingsStore.edit { p ->
            appearance?.get("theme")?.jsonPrimitive?.content?.let { p[K.theme] = it }
            appearance?.get("motion")?.jsonPrimitive?.content?.takeIf { it in setOf("system", "full", "reduced") }?.let { p[K.motion] = it }
            audio?.get("quality_wifi")?.jsonPrimitive?.content?.let { p[K.qWifi] = it }
            audio?.get("quality_cellular")?.jsonPrimitive?.content?.let { p[K.qCell] = it }
            audio?.get("normalization")?.jsonPrimitive?.content?.let { p[K.norm] = it }
            eq?.get("enabled")?.jsonPrimitive?.booleanOrNull?.let { p[K.eqOn] = it }
            eq?.get("preamp")?.jsonPrimitive?.floatOrNull?.let { p[K.eqPre] = it }
            (eq?.get("bands") as? JsonArray)?.jsonArray?.mapNotNull { it.jsonPrimitive.floatOrNull }
                ?.takeIf { it.size == 10 }?.let { p[K.eqBands] = it.joinToString(",") }
        }
    }
}
