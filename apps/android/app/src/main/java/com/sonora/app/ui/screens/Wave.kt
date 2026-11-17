package com.sonora.app.ui.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.sonora.app.data.net.Track
import com.sonora.app.data.net.WaveSettings
import com.sonora.app.ui.LocalActions
import com.sonora.app.ui.LocalEnv
import com.sonora.app.ui.components.coverColors
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.Chip
import com.sonora.app.ui.design.EqBars
import com.sonora.app.ui.design.GlassPill
import com.sonora.app.ui.design.PlayButton
import com.sonora.app.ui.design.S
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.press
import com.sonora.app.ui.design.rememberAnimationsEnabled
import com.sonora.core.designsystem.tokens.SonoraTokens
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/** Wave settings options in display order; null is «Любое» (no filter). */
val WAVE_CHARACTER: List<Pair<String?, String>> = listOf(null to "Любое", "favorite" to "Любимое", "discover" to "Незнакомое", "popular" to "Популярное")
val WAVE_MOOD: List<Pair<String?, String>> = listOf(null to "Любое", "energetic" to "Бодрое", "happy" to "Весёлое", "calm" to "Спокойное", "sad" to "Грустное")
val WAVE_LANGUAGE: List<Pair<String?, String>> = listOf(null to "Любое", "russian" to "Русский", "foreign" to "Иностранный", "instrumental" to "Без слов")

private fun label(options: List<Pair<String?, String>>, value: String?): String? =
    value?.let { v -> options.firstOrNull { it.first == v }?.second }

/** «Незнакомое · Спокойное» — or «Под ваш вкус» when nothing is filtered. */
fun WaveSettings.summary(): String =
    listOfNotNull(label(WAVE_CHARACTER, character), label(WAVE_MOOD, mood), label(WAVE_LANGUAGE, language))
        .joinToString(" · ").ifEmpty { "Под ваш вкус" }

/** What the home hero shows: the wave's current track (when the wave is playing) and its settings. */
@Immutable
data class WaveHeroUi(
    val track: Track? = null,
    val active: Boolean = false,
    val playing: Boolean = false,
    val settings: WaveSettings = WaveSettings(),
)

private const val TAU = 6.2831855f

/** Brand wave colours (violet, pink, cyan, amber) of the current theme. */
fun brandWaveColors(dark: Boolean): List<Color> =
    if (dark) with(SonoraTokens.Colors) { listOf(WaveA, WaveB, WaveC, WaveD) }
    else with(SonoraTokens.LightColors) { listOf(WaveA, WaveB, WaveC, WaveD) }

/**
 * «Моя волна» visual: soft colour clouds drifting behind four translucent wave bands that flow at
 * different speeds. It idles slowly and moves with more energy while the wave plays. The frame loop
 * runs only while [animate] is true and the screen is at least STARTED (it also stops when the
 * composable leaves the screen); otherwise a single still frame is drawn.
 */
@Composable
fun WaveCanvas(colors: List<Color>, playing: Boolean, animate: Boolean, modifier: Modifier = Modifier) {
    val phase = remember { mutableFloatStateOf(1.6f) }
    val energy = remember { mutableFloatStateOf(if (playing) 1f else 0f) }
    val target = if (playing) 1f else 0f
    val latestTarget by rememberUpdatedState(target)
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val running = animate && lifecycleState.isAtLeast(Lifecycle.State.STARTED)
    LaunchedEffect(running) {
        if (!running) return@LaunchedEffect
        var last = -1L
        while (true) {
            withFrameNanos { now ->
                if (last >= 0) {
                    val dt = ((now - last) / 1_000_000_000f).coerceIn(0f, 0.05f)
                    val e = energy.floatValue + (latestTarget - energy.floatValue) * min(1f, dt * 1.6f)
                    energy.floatValue = e
                    phase.floatValue += dt * (0.22f + 0.78f * e)
                }
                last = now
            }
        }
    }
    val paths = remember { List(4) { Path() } }
    val dark = C.dark
    val bg = C.bg
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        if (w <= 0f || h <= 0f) return@Canvas
        val t = phase.floatValue
        val e = if (running) energy.floatValue else target
        // Colour clouds on slow Lissajous orbits.
        val glow = if (dark) 0.5f else 0.34f
        for (i in 0 until 3) {
            val c = colors[i % colors.size]
            val center = Offset(w * (0.5f + 0.34f * sin(t * 0.23f + i * 2.1f)), h * (0.36f + 0.16f * cos(t * 0.19f + i * 1.7f)))
            val r = w * (0.62f + 0.1f * sin(t * 0.31f + i * 1.3f))
            drawCircle(Brush.radialGradient(listOf(c.copy(alpha = glow), c.copy(alpha = 0f)), center, r), r, center)
        }
        // Wave bands, back to front: two summed sines each, amplitude follows the energy.
        val step = 6.dp.toPx()
        for (layer in 0 until 4) {
            val c = colors[(layer + 1) % colors.size]
            val base = h * (0.56f + 0.075f * layer)
            val amp = h * (0.03f + 0.012f * layer) * (0.6f + 0.8f * e)
            val k1 = 1.0f + 0.35f * layer
            val k2 = 2.2f + 0.45f * layer
            val s1 = 0.8f + 0.22f * layer
            val s2 = 1.25f - 0.14f * layer
            val path = paths[layer]
            path.reset()
            path.moveTo(0f, h)
            var x = 0f
            while (true) {
                val u = x / w
                val y = base + amp * (0.65f * sin(TAU * k1 * u + t * s1 + layer * 1.1f) + 0.35f * sin(TAU * k2 * u - t * s2 + layer * 2.3f))
                path.lineTo(x, y)
                if (x >= w) break
                x = min(x + step, w)
            }
            path.lineTo(w, h)
            path.close()
            val a = (if (dark) 0.52f else 0.42f) - 0.06f * layer
            drawPath(path, Brush.verticalGradient(listOf(c.copy(alpha = a), c.copy(alpha = a * 0.3f)), startY = base - amp * 1.2f, endY = h))
        }
        // The bottom edge melts into the page.
        drawRect(Brush.verticalGradient(listOf(bg.copy(alpha = 0f), bg), startY = h * 0.84f, endY = h))
    }
}

/**
 * Home hero «Моя волна»: full-bleed animated waves in the colours of the wave's current cover
 * (brand colours when the wave is not playing), big play/pause, «Настроить», the current track.
 * [header] (greeting + avatar) sits on top of the visual.
 */
@Composable
fun WaveHero(hero: WaveHeroUi, header: @Composable () -> Unit) {
    val env = LocalEnv.current
    val actions = LocalActions.current
    val track = hero.track?.takeIf { hero.active }
    val raw = track?.let { coverColors(it.release.artwork, it.release.id) } ?: brandWaveColors(C.dark)
    val colors = List(4) { i -> animateColorAsState(raw[i % raw.size], tween(900), label = "wave$i").value }
    val animate = rememberAnimationsEnabled() && !env.playerOpen
    val onPlay = { if (hero.active) actions.togglePlay() else actions.playWave() }
    Box(Modifier.fillMaxWidth()) {
        WaveCanvas(colors, hero.playing, animate, Modifier.matchParentSize())
        Column(Modifier.fillMaxWidth().statusBarsPadding().height(452.dp)) {
            header()
            Spacer(Modifier.weight(1f))
            Column(Modifier.fillMaxWidth().padding(horizontal = S.page), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Моя волна", style = T.PageTitle.copy(fontSize = 34.sp, lineHeight = 40.sp), color = C.text)
                Spacer(Modifier.height(S.xs))
                Text(hero.settings.summary(), style = T.Body, color = C.text2, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(S.xl))
                PlayButton(hero.playing, onPlay, size = 80.dp, container = C.fg, content = C.bg)
                Spacer(Modifier.height(S.l))
                GlassPill(Icons.Filled.Tune, "Настроить", actions::openWaveSettings)
                Spacer(Modifier.height(S.l))
                Row(Modifier.height(20.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (track != null) {
                        EqBars(hero.playing, color = C.text)
                        Spacer(Modifier.width(S.s))
                        Text("${track.fullTitle} — ${track.artistLine}", style = T.Label, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            Spacer(Modifier.weight(1.3f))
        }
    }
}

/** Mood «orbs»: each mood has its own colour pair. */
private fun moodColors(mood: String?): List<Color> = with(SonoraTokens.Colors) {
    when (mood) {
        "energetic" -> listOf(Color(0xFFFF7A3D), WaveD)
        "happy" -> listOf(WaveB, Color(0xFFFFD166))
        "calm" -> listOf(WaveC, Color(0xFF3E6BE6))
        "sad" -> listOf(WaveA, Color(0xFF2A2F6E))
        else -> listOf(WaveA, WaveB, WaveD, WaveC)
    }
}

/** Content of the «Настроить волну» bottom sheet; every tap applies at once. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WaveSettingsContent(settings: WaveSettings, onChange: (WaveSettings) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = S.page).padding(bottom = S.xxl), verticalArrangement = Arrangement.spacedBy(S.xl)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Настроить волну", style = T.Section, color = C.text)
                Text("Новые треки начнутся со следующего", style = T.Caption, color = C.text2)
            }
            if (settings != WaveSettings()) {
                Text("Сбросить", style = T.LabelBold, color = C.text2, modifier = Modifier.press({ onChange(WaveSettings()) }).padding(S.s))
            }
        }
        SettingsGroup("Характер") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.s), verticalArrangement = Arrangement.spacedBy(S.s)) {
                WAVE_CHARACTER.forEach { (value, text) -> Chip(text, settings.character == value) { onChange(settings.copy(character = value)) } }
            }
        }
        SettingsGroup("Настроение") {
            Row(Modifier.fillMaxWidth()) {
                WAVE_MOOD.forEach { (value, text) ->
                    MoodOrb(text, moodColors(value), settings.mood == value, Modifier.weight(1f)) { onChange(settings.copy(mood = value)) }
                }
            }
        }
        SettingsGroup("Язык") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.s), verticalArrangement = Arrangement.spacedBy(S.s)) {
                WAVE_LANGUAGE.forEach { (value, text) -> Chip(text, settings.language == value) { onChange(settings.copy(language = value)) } }
            }
        }
    }
}

@Composable
private fun SettingsGroup(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(S.m)) {
        Text(title, style = T.Title, color = C.text)
        content()
    }
}

/** A glossy colour sphere with its label; the chosen one gets a ring. */
@Composable
private fun MoodOrb(text: String, colors: List<Color>, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val ring by animateColorAsState(if (selected) C.text else Color.Transparent, tween(150), label = "orbRing")
    Column(modifier.press(onClick, role = Role.RadioButton, label = text), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(60.dp).border(2.dp, ring, CircleShape).padding(5.dp).clip(CircleShape)
                .background(Brush.linearGradient(colors))
                .drawBehind {
                    drawRect(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.38f), Color.Transparent), Offset(size.width * 0.32f, size.height * 0.28f), size.width * 0.6f))
                },
        )
        Spacer(Modifier.height(6.dp))
        Text(text, style = T.Small.copy(fontSize = 12.sp), color = if (selected) C.text else C.text2, maxLines = 1)
    }
}
