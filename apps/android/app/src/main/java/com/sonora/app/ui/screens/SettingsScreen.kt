package com.sonora.app.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.repo.ThemeMode
import com.sonora.app.data.repo.userMessage
import com.sonora.app.di.AppModule
import com.sonora.app.ui.AppTopBar
import com.sonora.app.ui.LocalBottomInset
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.Chip
import com.sonora.app.ui.design.MonoLabel
import com.sonora.app.ui.design.PrimaryButton
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.WaveLine
import com.sonora.app.ui.design.appear
import com.sonora.app.ui.design.glass
import com.sonora.app.ui.design.pressable
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

@OptIn(ExperimentalLayoutApi::class)
@UnstableApi
@Composable
fun SettingsScreen(app: AppViewModel, navigate: (String) -> Unit) {
    val s by app.settings.settings.collectAsStateWithLifecycle()
    val signedIn by app.auth.signedIn.collectAsStateWithLifecycle()
    val me by app.auth.me.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = LocalBottomInset.current + 16.dp)) {
        AppTopBar(app, navigate)
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Настройки", style = T.DisplayL, color = C.text, modifier = Modifier.appear())
            Text("Тема, качество, выравнивание громкости и эквалайзер общие с веб-версией.", style = T.Body, color = C.text2)

            if (signedIn != null && me != null) {
                Group("Аккаунт", 0) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(48.dp).clip(CircleShape).background(C.accent), contentAlignment = Alignment.Center) {
                            Text((me?.displayName ?: me?.email ?: "S").take(1).uppercase(), style = T.Title3, color = C.onAccent)
                        }
                        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                            Text(me?.displayName ?: "", style = T.BodyBold, color = C.text)
                            Text(me?.email ?: "", style = T.Caption, color = C.text2)
                        }
                        Text("Выйти", style = T.CaptionBold, color = C.text, modifier = Modifier.clip(CircleShape).background(C.fg.copy(alpha = 0.08f)).pressable({ app.logout() }).padding(horizontal = 14.dp, vertical = 8.dp))
                    }
                }
            }

            Group("Оформление", 1) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(ThemeMode.Dark to "Тёмная", ThemeMode.Light to "Светлая", ThemeMode.System to "Как в системе").forEach { (mode, label) ->
                        Chip(label, s.theme == mode, { app.settings.setTheme(mode) })
                    }
                }
            }
            Group("Качество по Wi-Fi", 2) { Choices(QUALITIES, s.qualityWifi) { app.settings.setQuality(wifi = it) } }
            Group("Качество в мобильной сети", 3) {
                Choices(QUALITIES, s.qualityCellular) { app.settings.setQuality(cellular = it) }
                Text("Применяется со следующего трека. Сервер не отдаст больше, чем есть у трека.", style = T.Caption, color = C.text3)
            }
            Group("Выравнивание громкости", 4) {
                Choices(listOf("auto" to "Авто", "track" to "По треку", "album" to "По альбому", "off" to "Выкл."), s.normalization) { app.settings.setNormalization(it) }
            }

            Group("Эквалайзер", 5) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Включён", style = T.Body, color = C.text, modifier = Modifier.weight(1f))
                    Switch(
                        checked = s.eqEnabled, onCheckedChange = { app.settings.setEqualizer(it, s.eqPreamp, s.eqBands) },
                        colors = SwitchDefaults.colors(checkedTrackColor = C.accent, checkedThumbColor = C.onAccent, uncheckedTrackColor = C.fg.copy(alpha = 0.1f)),
                    )
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    EQ_PRESETS.forEach { (name, bands) -> Chip(name, s.eqEnabled && s.eqBands == bands, { app.settings.setEqualizer(true, 0f, bands) }) }
                }
                Column(Modifier.animateContentSize()) {
                    s.eqBands.forEachIndexed { i, db ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(EQ_LABELS[i], style = T.Mono.copy(letterSpacing = androidx.compose.ui.unit.TextUnit.Unspecified), color = C.text2, modifier = Modifier.width(40.dp))
                            Slider(
                                value = db, valueRange = -12f..12f, steps = 23, enabled = s.eqEnabled,
                                onValueChange = { v -> app.settings.setEqualizer(true, s.eqPreamp, s.eqBands.toMutableList().also { it[i] = v }) },
                                colors = SliderDefaults.colors(thumbColor = C.text, activeTrackColor = C.accent, inactiveTrackColor = C.fg.copy(alpha = 0.12f)),
                                modifier = Modifier.weight(1f),
                            )
                            Text("%+.0f".format(db), style = T.Caption, color = C.text2, modifier = Modifier.width(36.dp), textAlign = TextAlign.End)
                        }
                    }
                }
                Text("Полосы телефона сопоставляются с 10 полосами веб-версии по ближайшей частоте.", style = T.Caption, color = C.text3)
            }

            Group("Кэш аудио", 6) {
                Text("${s.cacheMb} МБ — прослушанное не скачивается повторно", style = T.Body, color = C.text2)
                Slider(
                    value = s.cacheMb.toFloat(), valueRange = 128f..4096f, onValueChange = { app.settings.setCacheMb(it.toInt() / 64 * 64) },
                    colors = SliderDefaults.colors(thumbColor = C.text, activeTrackColor = C.accent, inactiveTrackColor = C.fg.copy(alpha = 0.12f)),
                )
                Text("Новый размер применяется после перезапуска приложения.", style = T.Caption, color = C.text3)
            }

            Group("Сервер", 7) {
                var url by remember { mutableStateOf(s.baseUrl.ifBlank { AppModule.DEFAULT_BASE_URL }) }
                Field(url, { url = it }, "Адрес Sonora", KeyboardType.Uri)
                Text("Сохранить адрес", style = T.CaptionBold, color = C.text, modifier = Modifier.clip(CircleShape).background(C.fg.copy(alpha = 0.08f)).pressable({ app.settings.setBaseUrl(url); app.say("Адрес сохранён") }).padding(horizontal = 16.dp, vertical = 10.dp))
            }

            if (signedIn == null) PrimaryButton("Войти", { navigate("login") })
        }
    }
}

@Composable
private fun Group(title: String, index: Int, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().appear(index).glass(RoundedCornerShape(20.dp)).padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        MonoLabel(title, color = C.text2)
        content()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Choices(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) -> Chip(label, value == selected, { onSelect(value) }) }
    }
}

/** Web input: rounded-xl, faint fill, hairline that turns accent on focus. */
@Composable
private fun Field(value: String, onChange: (String) -> Unit, placeholder: String, type: KeyboardType, password: Boolean = false, ime: ImeAction = ImeAction.Next) {
    var focused by remember { mutableStateOf(false) }
    Box(
        Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(14.dp)).background(C.fg.copy(alpha = 0.05f))
            .border(1.dp, if (focused) C.accent else C.fg.copy(alpha = 0.55f), RoundedCornerShape(14.dp)).padding(horizontal = 16.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (value.isEmpty()) Text(placeholder, style = T.BodyL, color = C.text3)
        BasicTextField(
            value, onChange, singleLine = true, textStyle = T.BodyL.copy(color = C.text), cursorBrush = SolidColor(C.accent),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = type, imeAction = ime),
            modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused },
        )
    }
}

/** «Вход в Sonora» card (app/login/page.tsx), with registration in the same card. */
@UnstableApi
@Composable
fun LoginScreen(app: AppViewModel, navigate: (String) -> Unit, onDone: () -> Unit) {
    var register by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val json = remember { Json { ignoreUnknownKeys = true } }
    val valid = email.contains('@') && password.length >= (if (register) 8 else 1) && (!register || name.isNotBlank())
    val submit = {
        busy = true
        error = null
        scope.launch {
            runCatching { if (register) app.auth.register(name, email, password) else app.auth.login(email, password) }
                .onSuccess { onDone() }
                .onFailure { error = it.userMessage(json) }
            busy = false
        }
        Unit
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(bottom = LocalBottomInset.current)) {
        AppTopBar(app, navigate)
        Spacer(Modifier.height(48.dp))
        Column(
            Modifier.padding(horizontal = 16.dp).fillMaxWidth().appear().glass(RoundedCornerShape(24.dp)).padding(horizontal = 28.dp, vertical = 28.dp).animateContentSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(C.accent), contentAlignment = Alignment.Center) { Text("S", style = T.Title2, color = C.onAccent) }
            Spacer(Modifier.height(12.dp))
            MonoLabel("Sonora · эфир", color = C.text2, dot = true)
            Spacer(Modifier.height(10.dp))
            AnimatedContent(register, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "title") { r ->
                Text(if (r) "Регистрация" else "Вход в Sonora", style = T.Title1, color = C.text, textAlign = TextAlign.Center)
            }
            WaveLine(Modifier.padding(vertical = 8.dp), amplitude = 4.dp)
            Spacer(Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                AnimatedVisibility(register) { Field(name, { name = it }, "Имя", KeyboardType.Text) }
                Field(email, { email = it }, "E-mail", KeyboardType.Email)
                Field(password, { password = it }, if (register) "Пароль (от 8 символов)" else "Пароль", KeyboardType.Password, password = true, ime = ImeAction.Done)
            }
            AnimatedVisibility(error != null) { Text(error ?: "", style = T.Body, color = androidx.compose.ui.graphics.Color(0xFFFF7A8A), modifier = Modifier.padding(top = 12.dp), textAlign = TextAlign.Center) }
            Spacer(Modifier.height(20.dp))
            PrimaryButton(if (busy) "Подождите…" else if (register) "Создать аккаунт" else "Войти", submit, enabled = !busy && valid)
            Spacer(Modifier.height(18.dp))
            Row {
                Text(if (register) "Уже есть аккаунт? " else "Нет аккаунта? ", style = T.Body, color = C.text2)
                Text(if (register) "Войти" else "Зарегистрироваться", style = T.BodyBold, color = C.text, modifier = Modifier.pressable({ register = !register; error = null }, scaleTo = 0.97f))
            }
        }
    }
}
