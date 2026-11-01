package com.sonora.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.repo.ThemeMode
import com.sonora.app.data.repo.userMessage
import com.sonora.app.di.AppModule
import com.sonora.app.ui.theme.Sonora
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

private val QUALITIES = listOf("auto" to "Авто", "hires" to "Hi-Res", "lossless" to "Lossless", "high" to "Высокое", "normal" to "Обычное", "low" to "Экономия")
private val EQ_LABELS = listOf("31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k")
private val EQ_PRESETS = mapOf(
    "Ровно" to List(10) { 0f },
    "Бас" to listOf(6f, 5f, 4f, 2f, 0f, 0f, 0f, 0f, 0f, 0f),
    "Вокал" to listOf(-2f, -1f, 0f, 2f, 4f, 4f, 3f, 1f, 0f, -1f),
    "Рок" to listOf(4f, 3f, 1f, 0f, -1f, 0f, 1f, 3f, 4f, 4f),
    "Электроника" to listOf(5f, 4f, 1f, 0f, -2f, 1f, 0f, 2f, 4f, 5f),
)

@UnstableApi
@Composable
fun SettingsScreen(app: AppViewModel, navigate: (String) -> Unit) {
    val s by app.settings.settings.collectAsStateWithLifecycle()
    val signedIn by app.auth.signedIn.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Настройки", style = MaterialTheme.typography.headlineMedium)
        Text("Тема, качество, нормализация и эквалайзер синхронизируются с веб-версией.", color = Sonora.colors.textSecondary)

        Group("Оформление") {
            Chips(listOf(ThemeMode.Dark to "Тёмная", ThemeMode.Light to "Светлая", ThemeMode.System to "Как в системе"), s.theme) { app.settings.setTheme(it) }
        }
        Group("Качество по Wi-Fi") { Chips(QUALITIES, s.qualityWifi) { app.settings.setQuality(wifi = it) } }
        Group("Качество в мобильной сети") { Chips(QUALITIES, s.qualityCellular) { app.settings.setQuality(cellular = it) } }
        Text("Новое качество применяется со следующего трека. Сервер не отдаст больше, чем есть у трека.", style = MaterialTheme.typography.bodySmall, color = Sonora.colors.textTertiary)
        Group("Выравнивание громкости") {
            Chips(listOf("auto" to "Авто", "track" to "По треку", "album" to "По альбому", "off" to "Выкл."), s.normalization) { app.settings.setNormalization(it) }
        }

        Group("Эквалайзер") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Включён", modifier = Modifier.weight(1f))
                Switch(checked = s.eqEnabled, onCheckedChange = { app.settings.setEqualizer(it, s.eqPreamp, s.eqBands) })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                EQ_PRESETS.entries.take(3).forEach { (name, bands) -> OutlinedButton(onClick = { app.settings.setEqualizer(true, 0f, bands) }) { Text(name) } }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                EQ_PRESETS.entries.drop(3).forEach { (name, bands) -> OutlinedButton(onClick = { app.settings.setEqualizer(true, 0f, bands) }) { Text(name) } }
            }
            s.eqBands.forEachIndexed { i, db ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(EQ_LABELS[i], modifier = Modifier.width(44.dp), style = MaterialTheme.typography.labelMedium)
                    Slider(
                        value = db, valueRange = -12f..12f, steps = 23, enabled = s.eqEnabled,
                        onValueChange = { v -> app.settings.setEqualizer(true, s.eqPreamp, s.eqBands.toMutableList().also { it[i] = v }) },
                        modifier = Modifier.weight(1f),
                    )
                    Text("%+.0f".format(db), modifier = Modifier.width(40.dp), style = MaterialTheme.typography.labelMedium)
                }
            }
            Text("Полосы телефона сопоставляются с 10 полосами веб-версии по ближайшей частоте.", style = MaterialTheme.typography.bodySmall, color = Sonora.colors.textTertiary)
        }

        Group("Кэш аудио") {
            Text("${s.cacheMb} МБ — уже прослушанное не скачивается повторно", color = Sonora.colors.textSecondary)
            Slider(value = s.cacheMb.toFloat(), valueRange = 128f..4096f, onValueChange = { app.settings.setCacheMb(it.toInt() / 64 * 64) })
            Text("Новый размер применяется после перезапуска приложения.", style = MaterialTheme.typography.bodySmall, color = Sonora.colors.textTertiary)
        }

        Group("Сервер") {
            var url by remember { mutableStateOf(s.baseUrl.ifBlank { AppModule.DEFAULT_BASE_URL }) }
            OutlinedTextField(url, { url = it }, label = { Text("Адрес Sonora") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
            OutlinedButton(onClick = { app.settings.setBaseUrl(url); app.say("Адрес сохранён") }) { Text("Сохранить адрес") }
        }

        HorizontalDivider()
        if (signedIn != null) Button(onClick = { app.logout() }) { Text("Выйти") } else Button(onClick = { navigate("login") }) { Text("Войти") }
    }
}

@Composable
private fun Group(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        content()
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun <T> Chips(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit) {
    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) -> FilterChip(selected = value == selected, onClick = { onSelect(value) }, label = { Text(label) }) }
    }
}

@UnstableApi
@Composable
fun LoginScreen(app: AppViewModel, onDone: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val json = remember { Json { ignoreUnknownKeys = true } }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Sonora", style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.primary)
        Text("Войдите тем же аккаунтом, что и на сайте", color = Sonora.colors.textSecondary, modifier = Modifier.padding(bottom = 24.dp))
        OutlinedTextField(email, { email = it }, label = { Text("Почта") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        OutlinedTextField(
            password, { password = it }, label = { Text("Пароль") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        Button(
            onClick = {
                busy = true
                error = null
                scope.launch {
                    runCatching { app.auth.login(email, password) }
                        .onSuccess { onDone() }
                        .onFailure { error = it.userMessage(json) }
                    busy = false
                }
            },
            enabled = !busy && email.contains('@') && password.isNotEmpty(),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        ) { Text(if (busy) "Входим…" else "Войти") }
    }
}
