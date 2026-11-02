package com.sonora.app.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.repo.AppSettings
import com.sonora.app.data.repo.ThemeMode
import com.sonora.app.data.repo.userMessage
import com.sonora.app.di.AppModule
import com.sonora.app.ui.LocalBottomInset
import com.sonora.app.ui.LocalEnv
import com.sonora.app.ui.components.BackBar
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.Chip
import com.sonora.app.ui.design.OutlinePill
import com.sonora.app.ui.design.PrimaryButton
import com.sonora.app.ui.design.S
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.press
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

private val QUALITIES = listOf("auto" to "Авто", "hires" to "Hi-Res", "lossless" to "Lossless", "high" to "Высокое", "normal" to "Обычное", "low" to "Экономия")
private val EQ_LABELS = listOf("31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k")

/** Same presets as apps/web/src/lib/eqPresets.ts. */
private val EQ_PRESETS = listOf(
    "Ровно" to List(10) { 0f },
    "Бас" to listOf(6f, 5f, 4f, 2f, 0f, 0f, 0f, 0f, 0f, 0f),
    "Вокал" to listOf(-2f, -1f, 0f, 2f, 4f, 4f, 3f, 1f, 0f, -1f),
    "Рок" to listOf(4f, 3f, 1f, 0f, -1f, 0f, 1f, 3f, 4f, 4f),
    "Электроника" to listOf(5f, 4f, 1f, 0f, -2f, 1f, 0f, 2f, 4f, 5f),
)

/** Everything the settings page can change; implemented by the app, faked in tests. */
interface SettingsCommands {
    fun theme(mode: ThemeMode)
    fun quality(wifi: String? = null, cellular: String? = null)
    fun normalization(mode: String)
    fun equalizer(enabled: Boolean, preamp: Float, bands: List<Float>)
    fun cache(mb: Int)
    fun server(url: String)
    fun logout()
    fun login()
}

@UnstableApi
@Composable
fun SettingsScreen(app: AppViewModel, navigate: (String) -> Unit) {
    val s by app.settings.settings.collectAsStateWithLifecycle()
    val commands = remember(app) {
        object : SettingsCommands {
            override fun theme(mode: ThemeMode) { app.settings.setTheme(mode) }
            override fun quality(wifi: String?, cellular: String?) { app.settings.setQuality(wifi, cellular) }
            override fun normalization(mode: String) { app.settings.setNormalization(mode) }
            override fun equalizer(enabled: Boolean, preamp: Float, bands: List<Float>) { app.settings.setEqualizer(enabled, preamp, bands) }
            override fun cache(mb: Int) { app.settings.setCacheMb(mb) }
            override fun server(url: String) { app.settings.setBaseUrl(url); app.say("Адрес сохранён") }
            override fun logout() { app.logout() }
            override fun login() { navigate("login") }
        }
    }
    SettingsContent(s, commands)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsContent(s: AppSettings, commands: SettingsCommands) {
    val env = LocalEnv.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = LocalBottomInset.current + S.l)) {
        BackBar("Настройки")
        if (env.signedIn) {
            Row(Modifier.fillMaxWidth().padding(horizontal = S.page, vertical = S.m), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(56.dp).clip(CircleShape).background(C.accent), contentAlignment = Alignment.Center) {
                    Text((env.userName ?: env.email ?: "S").take(1).uppercase(), style = T.Headline, color = C.onAccent)
                }
                Column(Modifier.weight(1f).padding(horizontal = S.m)) {
                    Text(env.userName ?: "", style = T.Title, color = C.text)
                    Text(env.email ?: "", style = T.Caption, color = C.text2)
                }
                OutlinePill("Выйти", commands::logout)
            }
        } else {
            Column(Modifier.padding(S.page)) { PrimaryButton("Войти", commands::login) }
        }

        Group("Оформление") {
            Options(listOf(ThemeMode.Dark to "Тёмная", ThemeMode.Light to "Светлая", ThemeMode.System to "Как в системе"), s.theme, commands::theme)
        }
        Group("Качество по Wi-Fi") { Options(QUALITIES, s.qualityWifi) { commands.quality(wifi = it) } }
        Group("Качество в мобильной сети", "Сервер не отдаст больше, чем есть у трека.") { Options(QUALITIES, s.qualityCellular) { commands.quality(cellular = it) } }
        Group("Выравнивание громкости") {
            Options(listOf("auto" to "Авто", "track" to "По треку", "album" to "По альбому", "off" to "Выкл."), s.normalization, commands::normalization)
        }
        Group("Эквалайзер") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Включить", style = T.Body, color = C.text, modifier = Modifier.weight(1f))
                Switch(
                    checked = s.eqEnabled, onCheckedChange = { commands.equalizer(it, s.eqPreamp, s.eqBands) },
                    colors = SwitchDefaults.colors(checkedTrackColor = C.accent, checkedThumbColor = Color.White, uncheckedTrackColor = C.surfaceHigh, uncheckedBorderColor = C.surfaceHigh, uncheckedThumbColor = C.text2),
                )
            }
            AnimatedVisibility(s.eqEnabled) {
                Column(Modifier.animateContentSize(), verticalArrangement = Arrangement.spacedBy(S.s)) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(S.s), verticalArrangement = Arrangement.spacedBy(S.s)) {
                        EQ_PRESETS.forEach { (name, bands) -> Chip(name, s.eqBands == bands, { commands.equalizer(true, 0f, bands) }) }
                    }
                    s.eqBands.forEachIndexed { i, db ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(EQ_LABELS[i], style = T.Time, color = C.text2, modifier = Modifier.width(36.dp))
                            Slider(
                                value = db, valueRange = -12f..12f,
                                onValueChange = { v -> commands.equalizer(true, s.eqPreamp, s.eqBands.toMutableList().also { it[i] = v }) },
                                colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = C.accent, inactiveTrackColor = C.surfaceHigh),
                                modifier = Modifier.weight(1f),
                            )
                            Text("%+.0f".format(db), style = T.Time, color = C.text2, modifier = Modifier.width(32.dp), textAlign = TextAlign.End)
                        }
                    }
                }
            }
        }
        Group("Кэш аудио", "Прослушанное не скачивается повторно. Новый размер — после перезапуска.") {
            Text("${s.cacheMb} МБ", style = T.Title, color = C.text)
            Slider(
                value = s.cacheMb.toFloat(), valueRange = 128f..4096f, onValueChange = { commands.cache(it.toInt() / 64 * 64) },
                colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = C.accent, inactiveTrackColor = C.surfaceHigh),
            )
        }
        Group("Сервер") {
            var url by remember { mutableStateOf(s.baseUrl.ifBlank { AppModule.DEFAULT_BASE_URL }) }
            Field(url, { url = it }, "Адрес Sonora", KeyboardType.Uri)
            OutlinePill("Сохранить", { commands.server(url) })
        }
    }
}

@Composable
private fun Group(title: String, hint: String? = null, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = S.page, vertical = S.m), verticalArrangement = Arrangement.spacedBy(S.m)) {
        Column {
            Text(title, style = T.Title, color = C.text)
            if (hint != null) Text(hint, style = T.Caption, color = C.text2)
        }
        content()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun <V> Options(options: List<Pair<V, String>>, selected: V, onSelect: (V) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(S.s), verticalArrangement = Arrangement.spacedBy(S.s)) {
        options.forEach { (value, label) -> Chip(label, value == selected, { onSelect(value) }) }
    }
}

/** 52-dp field: flat fill, accent outline while focused. */
@Composable
private fun Field(value: String, onChange: (String) -> Unit, placeholder: String, type: KeyboardType, password: Boolean = false, ime: ImeAction = ImeAction.Next) {
    var focused by remember { mutableStateOf(false) }
    Box(
        Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(8.dp)).background(C.surfaceHigh)
            .border(1.dp, if (focused) C.accent else Color.Transparent, RoundedCornerShape(8.dp)).padding(horizontal = S.l),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (value.isEmpty()) Text(placeholder, style = T.Body, color = C.text3)
        BasicTextField(
            value, onChange, singleLine = true, textStyle = T.Body.copy(color = C.text), cursorBrush = SolidColor(C.accent),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = type, imeAction = ime),
            modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused },
        )
    }
}

@UnstableApi
@Composable
fun LoginScreen(app: AppViewModel, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    val json = remember { Json { ignoreUnknownKeys = true } }
    LoginContent { register, name, email, password, done ->
        scope.launch {
            runCatching { if (register) app.auth.register(name, email, password) else app.auth.login(email, password) }
                .onSuccess { done(null); onDone() }
                .onFailure { done(it.userMessage(json)) }
        }
    }
}

/** Logo, two fields, one button; «Регистрация» adds the name field. */
@Composable
fun LoginContent(submit: (register: Boolean, name: String, email: String, password: String, done: (String?) -> Unit) -> Unit) {
    var register by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val valid = email.contains('@') && password.length >= (if (register) 8 else 1) && (!register || name.isNotBlank())
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding()) {
        BackBar()
        Column(Modifier.padding(horizontal = S.xl).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(S.xl))
            Box(Modifier.size(64.dp).clip(RoundedCornerShape(16.dp)).background(C.accent), contentAlignment = Alignment.Center) {
                Text("S", style = T.PageTitle.copy(fontSize = 30.sp), color = C.onAccent)
            }
            Spacer(Modifier.height(S.l))
            Text(if (register) "Создайте аккаунт" else "Войдите в Sonora", style = T.Headline, color = C.text, textAlign = TextAlign.Center)
            Spacer(Modifier.height(S.xs))
            Text("Тот же аккаунт, что и на сайте", style = T.Caption, color = C.text2)
            Spacer(Modifier.height(S.xxl))
            Column(Modifier.animateContentSize(), verticalArrangement = Arrangement.spacedBy(S.m)) {
                if (register) Field(name, { name = it }, "Имя", KeyboardType.Text)
                Field(email, { email = it }, "Электронная почта", KeyboardType.Email)
                Field(password, { password = it }, if (register) "Пароль, от 8 символов" else "Пароль", KeyboardType.Password, password = true, ime = ImeAction.Done)
            }
            if (error != null) Text(error!!, style = T.Caption, color = Color(0xFFFF7A8A), textAlign = TextAlign.Center, modifier = Modifier.padding(top = S.m))
            Spacer(Modifier.height(S.xl))
            PrimaryButton(if (busy) "Подождите…" else if (register) "Создать аккаунт" else "Войти", {
                busy = true
                error = null
                submit(register, name, email, password) { e -> error = e; busy = false }
            }, enabled = !busy && valid)
            Spacer(Modifier.height(S.l))
            Row {
                Text(if (register) "Уже есть аккаунт? " else "Нет аккаунта? ", style = T.Label, color = C.text2)
                Text(if (register) "Войти" else "Зарегистрироваться", style = T.LabelBold, color = C.text, modifier = Modifier.press({ register = !register; error = null }))
            }
        }
    }
}
