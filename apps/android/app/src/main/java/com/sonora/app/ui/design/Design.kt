package com.sonora.app.ui.design

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.sonora.app.R
import com.sonora.app.data.net.Palette
import com.sonora.app.ui.theme.Onest
import com.sonora.app.ui.theme.Unbounded
import com.sonora.core.designsystem.tokens.SonoraTokens
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.sin

// The web app's visual language (apps/web/src/app/globals.css) translated to Compose, value for value.

val JetBrainsMono = FontFamily(Font(R.font.jetbrains_mono_500, FontWeight.Medium))

/** Colours of the current theme, from the shared design tokens. */
data class Palette2(
    val bg: Color,
    val elevated: Color,
    val raised: Color,
    val text: Color,
    val text2: Color,
    val text3: Color,
    val border: Color,
    val borderStrong: Color,
    val glassThin: Color,
    val glassRegular: Color,
    val accent: Color,
    val accentHover: Color,
    val accentPressed: Color,
    val accentMuted: Color,
    val onAccent: Color,
    val fg: Color,
    val dark: Boolean,
)

val DarkColors = with(SonoraTokens.Colors) {
    Palette2(BgBase, BgElevated, BgRaised, TextPrimary, TextSecondary, TextTertiary, BorderDefault, BorderStrong, GlassThin, GlassRegular, AccentDefault, AccentHover, AccentPressed, AccentMuted, AccentOn, Color.White, true)
}
val LightColors = with(SonoraTokens.LightColors) {
    Palette2(BgBase, BgElevated, BgRaised, TextPrimary, TextSecondary, TextTertiary, BorderDefault, BorderStrong, GlassThin, GlassRegular, AccentDefault, AccentHover, AccentPressed, AccentMuted, AccentOn, Color(0xFF15131C), false)
}

val LocalColors = staticCompositionLocalOf { DarkColors }
val C: Palette2 @Composable get() = LocalColors.current

val WaveA = SonoraTokens.Colors.WaveA
val WaveB = SonoraTokens.Colors.WaveB
val WaveC = SonoraTokens.Colors.WaveC
val Gold = Color(0xFFF4C46B)

// ---- Type scale (tokens.json typography) ---------------------------------------------------

object T {
    val DisplayXl = TextStyle(fontFamily = Unbounded, fontWeight = FontWeight.Bold, fontSize = 54.sp, lineHeight = 56.sp, letterSpacing = (-0.045).em)
    val DisplayL = TextStyle(fontFamily = Unbounded, fontWeight = FontWeight.Bold, fontSize = 40.sp, lineHeight = 42.sp, letterSpacing = (-0.04).em)
    val Title1 = TextStyle(fontFamily = Unbounded, fontWeight = FontWeight.Bold, fontSize = 28.sp, lineHeight = 34.sp, letterSpacing = (-0.035).em)
    val Title2 = TextStyle(fontFamily = Unbounded, fontWeight = FontWeight.SemiBold, fontSize = 21.sp, lineHeight = 27.sp, letterSpacing = (-0.03).em)
    val Title3 = TextStyle(fontFamily = Unbounded, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, lineHeight = 24.sp, letterSpacing = (-0.01).em)
    val BodyL = TextStyle(fontFamily = Onest, fontSize = 17.sp, lineHeight = 24.sp)
    val Body = TextStyle(fontFamily = Onest, fontSize = 15.sp, lineHeight = 21.sp)
    val BodyBold = Body.copy(fontWeight = FontWeight.Bold)
    val Caption = TextStyle(fontFamily = Onest, fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 18.sp)
    val CaptionBold = Caption.copy(fontWeight = FontWeight.Bold)
    val Micro = TextStyle(fontFamily = Onest, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.04.em)
    val Mono = TextStyle(fontFamily = JetBrainsMono, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.16.em)
}

/** `.mono-label`: JetBrains Mono, 11 sp, tracking 0.16 em, upper case. */
@Composable
fun MonoLabel(text: String, modifier: Modifier = Modifier, color: Color = C.text3, dot: Boolean = false) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (dot) {
            OnAirDot()
            Spacer(Modifier.width(10.dp))
        }
        Text(text.uppercase(), style = T.Mono, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** `.on-air-dot`: an accent dot with a slow breathing halo. */
@Composable
fun OnAirDot() {
    val t = rememberInfiniteTransition(label = "air")
    val halo by t.animateFloat(0.25f, 0.6f, infiniteRepeatable(tween(1600), RepeatMode.Reverse), label = "halo")
    val accent = C.accent
    Canvas(Modifier.size(12.dp)) {
        drawCircle(accent.copy(alpha = halo), radius = size.minDimension / 2)
        drawCircle(accent, radius = size.minDimension / 3.2f)
    }
}

/** `.text-gradient`: text primary → pink-white → violet-white at 100°. */
@Composable
fun gradientBrush(): Brush = Brush.linearGradient(
    listOf(C.text, lerpWhite(WaveB, 0.45f), lerpWhite(WaveA, 0.3f)),
    start = Offset(0f, 0f), end = Offset(900f, 160f),
)

private fun lerpWhite(c: Color, white: Float) = Color(
    c.red + (1 - c.red) * white, c.green + (1 - c.green) * white, c.blue + (1 - c.blue) * white, 1f,
)

@Composable
fun GradientHeadline(gradient: String, plain: String?, style: TextStyle = T.DisplayL, modifier: Modifier = Modifier) {
    val brush = gradientBrush()
    val text2 = C.text.copy(alpha = 0.9f)
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(brush = brush)) { append(gradient) }
            if (plain != null) withStyle(SpanStyle(color = text2)) { append(plain) }
        },
        style = style,
        modifier = modifier,
    )
}

// ---- Live background -------------------------------------------------------------------------

private val Brand = Triple(Color(0xFF8A2A12), Color(0xFF2A2F8F), Color(0xFF0B5F56))

/** Pull a colour towards a usable brightness for a glowing background (LiveBackground.tsx `vivid`). */
fun vivid(hex: String?, fallback: Color): Color {
    val n = hex?.removePrefix("#")?.takeIf { it.length == 6 }?.toLongOrNull(16) ?: return fallback
    var r = ((n shr 16) and 255).toFloat()
    var g = ((n shr 8) and 255).toFloat()
    var b = (n and 255).toFloat()
    val m = maxOf(r, g, b)
    if (m < 90) {
        val k = 90f / max(m, 1f)
        r *= k; g *= k; b *= k
    }
    return Color(r / 255f, g / 255f, b / 255f)
}

fun hexColor(hex: String?): Color? = hex?.removePrefix("#")?.takeIf { it.length == 6 }?.toLongOrNull(16)?.let { Color(0xFF000000 or it) }

/**
 * Three drifting colour fields in the colours of the current artwork, cross-fading over 1.6 s,
 * under a veil that darkens towards the bottom — the web app's `.live-bg`.
 */
@Composable
fun LiveBackground(palette: Palette?, modifier: Modifier = Modifier, intensity: Float = 1f) {
    val spec = tween<Color>(1600)
    val c1 by animateColorAsState(vivid(palette?.dominant, Brand.first), spec, label = "c1")
    val c2 by animateColorAsState(vivid(palette?.vibrant ?: palette?.accent, Brand.second), spec, label = "c2")
    val c3 by animateColorAsState(vivid(palette?.accent ?: palette?.mutedDark, Brand.third), spec, label = "c3")
    val colors = C
    val t = rememberInfiniteTransition(label = "drift")
    val a by t.animateFloat(0f, 1f, infiniteRepeatable(tween(26_000, easing = LinearEasing), RepeatMode.Reverse), label = "a")
    val b by t.animateFloat(0f, 1f, infiniteRepeatable(tween(31_000, easing = LinearEasing), RepeatMode.Reverse), label = "b")
    val c by t.animateFloat(0f, 1f, infiniteRepeatable(tween(37_000, easing = LinearEasing), RepeatMode.Reverse), label = "c")
    val opacity = (if (colors.dark) 0.42f else 0.22f) * intensity
    Canvas(modifier.fillMaxSize()) {
        drawRect(colors.bg)
        val v = max(size.width, size.height)
        fun blob(color: Color, cx: Float, cy: Float, r: Float) = drawCircle(
            Brush.radialGradient(listOf(color.copy(alpha = opacity), color.copy(alpha = opacity * 0.45f), Color.Transparent), Offset(cx, cy), r),
            radius = r, center = Offset(cx, cy),
        )
        // drift-a/b/c keyframes: 0 → 50% → 100%, approximated by a smooth path through the same points.
        blob(c1, 0.17f * v + wave(a, 0f, 0.09f, -0.04f) * v, 0.09f * v + wave(a, 0f, 0.06f, 0.12f) * v, 0.36f * v)
        blob(c2, size.width - 0.11f * v + wave(b, 0f, -0.10f, 0.05f) * v, 0.21f * v + wave(b, 0f, 0.08f, -0.04f) * v, 0.32f * v)
        blob(c3, 0.46f * v + wave(c, 0f, 0.12f, -0.08f) * v, size.height + 0.06f * v + wave(c, 0f, -0.10f, -0.02f) * v, 0.29f * v)
        // .veil: radial-gradient(120% 90% at 50% 0%, transparent, ink 55% at 55%, ink)
        val rx = size.width * 1.2f
        scale(1f, (size.height * 0.9f) / rx, pivot = Offset(size.width / 2, 0f)) {
            drawRect(
                Brush.radialGradient(
                    0f to Color.Transparent, 0.55f to colors.bg.copy(alpha = 0.55f), 1f to colors.bg,
                    center = Offset(size.width / 2, 0f), radius = rx,
                ),
                topLeft = Offset(-size.width, 0f),
                size = androidx.compose.ui.geometry.Size(size.width * 3, size.height * 4),
            )
        }
    }
}

private fun wave(t: Float, p0: Float, p1: Float, p2: Float): Float =
    if (t < 0.5f) p0 + (p1 - p0) * ease(t * 2) else p1 + (p2 - p1) * ease((t - 0.5f) * 2)

private fun ease(x: Float) = (1 - kotlin.math.cos(x * PI.toFloat())) / 2

// ---- Liquid glass ----------------------------------------------------------------------------

/**
 * `.liquid`: white sheen gradient over the glass fill, inset highlight on top, 1 px stroke,
 * soft drop shadow and a specular radial sheen at the top-left.
 */
fun Modifier.glass(shape: Shape = RoundedCornerShape(18.dp), strong: Boolean = false, shadow: Boolean = true): Modifier = composed {
    val colors = C
    val fill = if (strong) colors.glassRegular else colors.glassThin
    val highlight = if (colors.dark) Color.White.copy(alpha = 0.14f) else Color.White.copy(alpha = 0.9f)
    this
        .then(if (shadow) Modifier.shadow(18.dp, shape, ambientColor = Color.Black.copy(alpha = 0.5f), spotColor = Color.Black.copy(alpha = 0.65f)) else Modifier)
        .clip(shape)
        .drawBehind {
            drawRect(fill)
            drawRect(Brush.verticalGradient(0f to Color.White.copy(alpha = 0.10f), 0.38f to Color.White.copy(alpha = 0.02f), 1f to Color.White.copy(alpha = 0.04f)))
            drawRect(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.16f), Color.Transparent), Offset(size.width * 0.2f, -size.height * 0.1f), size.width * 0.66f))
            drawLine(highlight, Offset(0f, 0.5f), Offset(size.width, 0.5f), strokeWidth = 1.dp.toPx())
        }
        .border(1.dp, colors.border, shape)
}

/** Glass over a real backdrop blur (floating nav, mini player) — `backdrop-filter: blur(28px)`. */
fun Modifier.frosted(state: HazeState, shape: Shape, strong: Boolean = true): Modifier = composed {
    val colors = C
    val fill = if (strong) colors.glassRegular else colors.glassThin
    this
        .shadow(18.dp, shape, ambientColor = Color.Black.copy(alpha = 0.5f), spotColor = Color.Black.copy(alpha = 0.65f))
        .clip(shape)
        .hazeEffect(state, HazeStyle(backgroundColor = colors.bg, tint = HazeTint(fill.copy(alpha = fill.alpha * 0.85f)), blurRadius = 28.dp, noiseFactor = 0.04f))
        .drawBehind {
            drawRect(Brush.verticalGradient(0f to Color.White.copy(alpha = 0.10f), 0.38f to Color.White.copy(alpha = 0.02f), 1f to Color.White.copy(alpha = 0.04f)))
            drawLine(Color.White.copy(alpha = if (colors.dark) 0.14f else 0.9f), Offset(0f, 0.5f), Offset(size.width, 0.5f), strokeWidth = 1.dp.toPx())
        }
        .border(1.dp, colors.border, shape)
}

/** Press feedback used across the web app (`active:scale-95` with a spring back). */
fun Modifier.pressable(onClick: () -> Unit, scaleTo: Float = 0.96f, enabled: Boolean = true, role: Role = Role.Button, label: String? = null): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) scaleTo else 1f, spring(dampingRatio = 0.55f, stiffness = 600f), label = "press")
    this
        .graphicsLayer { scaleX = s; scaleY = s }
        .clickable(interactionSource = source, indication = null, enabled = enabled, role = role, onClickLabel = label, onClick = onClick)
}

/** Fade + rise on first appearance, staggered by index (motion `initial={{opacity:0,y:16}}`). */
fun Modifier.appear(index: Int = 0): Modifier = composed {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay((index.coerceAtMost(12) * 45).toLong())
        progress.animateTo(1f, spring(dampingRatio = 0.8f, stiffness = 220f))
    }
    graphicsLayer {
        alpha = progress.value
        translationY = (1 - progress.value) * 16.dp.toPx()
    }
}

// ---- Wave line (Oscilloscope / WaveRule) ----------------------------------------------------

/** A glowing gradient wave drifting slowly (the web app's Oscilloscope at rest). */
@Composable
fun WaveLine(modifier: Modifier = Modifier, amplitude: Dp = 5.dp, energy: Float = 0f) {
    val t = rememberInfiniteTransition(label = "wave")
    val phase by t.animateFloat(0f, (2 * PI).toFloat(), infiniteRepeatable(tween(6_000, easing = LinearEasing)), label = "phase")
    Canvas(modifier.fillMaxWidth().height(amplitude * 6)) {
        val amp = amplitude.toPx() * (1 + energy)
        val mid = size.height / 2
        val path = Path()
        val steps = 120
        for (i in 0..steps) {
            val x = size.width * i / steps
            val k = i / steps.toFloat()
            val envelope = sin(k * PI).toFloat() // fades to the edges
            val y = mid + envelope * amp * (sin(k * 9f + phase) * 0.7f + sin(k * 17f - phase * 1.4f) * 0.3f)
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        val brush = Brush.horizontalGradient(listOf(Color.Transparent, WaveA, WaveB, WaveC, Color.Transparent))
        drawPath(path, brush, style = Stroke(width = 6.dp.toPx(), cap = StrokeCap.Round), alpha = 0.18f) // glow
        drawPath(path, brush, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
    }
}

/** Section header: `01` in accent mono + display title + optional subtitle (Section.tsx). */
@Composable
fun SectionHeader(index: Int, title: String, subtitle: String? = null, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, top = 8.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("%02d".format(index + 1), style = T.Mono, color = C.accent, modifier = Modifier.align(Alignment.Top).padding(top = 7.dp))
        Spacer(Modifier.width(14.dp))
        androidx.compose.foundation.layout.Column(Modifier.weight(1f)) {
            Text(title, style = T.Title2, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrBlank()) Text(subtitle, style = T.Caption, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        action?.invoke()
    }
}

// ---- Buttons ---------------------------------------------------------------------------------

/** `.btn-accent` round play button with the accent glow; the icon morphs play ⇄ pause. */
@Composable
fun AccentPlayButton(playing: Boolean, onClick: () -> Unit, size: Dp = 64.dp, enabled: Boolean = true, modifier: Modifier = Modifier) {
    val accent = C.accent
    Box(
        modifier
            .size(size)
            .drawBehind {
                drawCircle(Brush.radialGradient(listOf(accent.copy(alpha = 0.55f), Color.Transparent)), radius = this.size.minDimension * 0.85f, center = center.copy(y = center.y + 6.dp.toPx()))
            }
            .graphicsLayer { alpha = if (enabled) 1f else 0.4f }
            .clip(CircleShape)
            .background(Brush.linearGradient(listOf(C.accentHover, accent)))
            .pressable(onClick, scaleTo = 0.92f, enabled = enabled, label = if (playing) "Пауза" else "Слушать"),
        contentAlignment = Alignment.Center,
    ) {
        AnimatedContent(playing, transitionSpec = { (scaleIn(spring(0.6f, 500f)) + fadeIn()) togetherWith (scaleOut() + fadeOut()) }, label = "pp") { p ->
            Icon(
                if (p) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = if (p) "Пауза" else "Слушать",
                tint = C.onAccent,
                modifier = Modifier.size(size * 0.45f).then(if (!p) Modifier.padding(start = 2.dp) else Modifier),
            )
        }
    }
}

/** `.liquid` round icon button (h-11 w-11 on the web). */
@Composable
fun GlassIconButton(icon: ImageVector, description: String, onClick: () -> Unit, size: Dp = 44.dp, tint: Color = C.text, active: Boolean = false, enabled: Boolean = true) {
    Box(
        Modifier
            .size(size)
            .then(if (active) Modifier.clip(CircleShape).background(C.accentMuted).border(1.dp, C.accent.copy(alpha = 0.5f), CircleShape) else Modifier.glass(CircleShape, shadow = false))
            .graphicsLayer { alpha = if (enabled) 1f else 0.4f }
            .pressable(onClick, scaleTo = 0.9f, enabled = enabled, label = description),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = description, tint = if (active) C.accent else tint, modifier = Modifier.size(size * 0.45f)) }
}

/** White pill with dark ink — the wave card's «Слушать». */
@Composable
fun WhitePillButton(text: String, icon: ImageVector?, onClick: () -> Unit) {
    Row(
        Modifier
            .shadow(10.dp, CircleShape)
            .clip(CircleShape)
            .background(Color.White)
            .pressable(onClick, scaleTo = 0.95f)
            .padding(horizontal = 24.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = Color(0xFF1B1238), modifier = Modifier.size(20.dp))
        Text(text, style = T.BodyBold, color = Color(0xFF1B1238))
    }
}

/** Full-width accent button (login, primary actions). */
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Box(
        modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(CircleShape)
            .background(if (enabled) C.accent else C.accent.copy(alpha = 0.4f))
            .pressable(onClick, scaleTo = 0.97f, enabled = enabled),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = T.BodyBold, color = C.onAccent) }
}

/** Filter chip: accent pill when selected, faint `bg-fg/5` otherwise. */
@Composable
fun Chip(text: String, selected: Boolean, onClick: () -> Unit, enabled: Boolean = true) {
    val bg by animateColorAsState(if (selected) C.accent else C.fg.copy(alpha = 0.06f), label = "chip")
    val fg by animateColorAsState(if (selected) C.onAccent else if (enabled) C.text2 else C.text3.copy(alpha = 0.5f), label = "chipFg")
    Box(
        Modifier.clip(CircleShape).background(bg).pressable(onClick, enabled = enabled, role = Role.Tab).padding(horizontal = 16.dp, vertical = 9.dp),
    ) { Text(text, style = T.CaptionBold.copy(fontSize = 14.sp), color = fg) }
}

/** Gold outlined «HI-RES LOSSLESS» badge. */
@Composable
fun QualityBadge(hires: Boolean, lossless: Boolean) {
    if (!hires && !lossless) return
    Box(Modifier.border(1.dp, Gold.copy(alpha = 0.7f), CircleShape).padding(horizontal = 9.dp, vertical = 2.dp)) {
        Text(if (hires) "HI-RES LOSSLESS" else "LOSSLESS", style = T.Micro.copy(fontWeight = FontWeight.Bold, letterSpacing = 0.06.em), color = Gold)
    }
}

/** Heart with the pop the web LikeButton does on save. */
@Composable
fun HeartButton(saved: Boolean, onToggle: () -> Unit, size: Dp = 22.dp, tint: Color = C.text2, modifier: Modifier = Modifier) {
    val pop = remember { Animatable(1f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(saved) {
        if (first) {
            first = false
            return@LaunchedEffect
        }
        if (saved) pop.animateTo(1f, keyframes { durationMillis = 420; 1f at 0; 1.35f at 140; 0.9f at 260; 1f at 420 })
    }
    Box(modifier.size(size + 20.dp).pressable(onToggle, scaleTo = 0.85f, label = if (saved) "Убрать из любимых" else "В любимые"), contentAlignment = Alignment.Center) {
        Icon(
            if (saved) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
            contentDescription = if (saved) "Убрать из любимых" else "В любимые",
            tint = if (saved) C.accent else tint,
            modifier = Modifier.size(size).scale(pop.value),
        )
    }
}

/** Three bouncing bars marking the playing row (`eq-bar` keyframes). */
@Composable
fun EqBars(playing: Boolean, color: Color = C.accent, modifier: Modifier = Modifier) {
    val t = rememberInfiniteTransition(label = "eq")
    val bars = listOf(0, 180, 360).map { delay ->
        t.animateFloat(0.3f, 1f, infiniteRepeatable(tween(520, delayMillis = 0, easing = LinearEasing), RepeatMode.Reverse, initialStartOffset = androidx.compose.animation.core.StartOffset(delay)), label = "b$delay")
    }
    Canvas(modifier.size(16.dp)) {
        val w = size.width / 5
        bars.forEachIndexed { i, v ->
            val h = size.height * (if (playing) v.value else 0.35f)
            drawRoundRect(color, Offset(i * 2 * w, size.height - h), androidx.compose.ui.geometry.Size(w, h), androidx.compose.ui.geometry.CornerRadius(w / 2))
        }
    }
}

/** Shimmering placeholder (`.skeleton`). */
@Composable
fun Skeleton(modifier: Modifier, shape: Shape = RoundedCornerShape(12.dp)) {
    val t = rememberInfiniteTransition(label = "sk")
    val x by t.animateFloat(-1f, 2f, infiniteRepeatable(tween(1400, easing = LinearEasing)), label = "x")
    val base = C.fg.copy(alpha = 0.06f)
    val shine = C.fg.copy(alpha = 0.12f)
    Box(modifier.clip(shape).drawBehind {
        drawRect(base)
        drawRect(Brush.linearGradient(listOf(Color.Transparent, shine, Color.Transparent), Offset(size.width * x - size.width / 2, 0f), Offset(size.width * x, size.height)))
    })
}

/** Dashed rounded outline (the «Новый плейлист» tile). */
fun Modifier.dashedBorder(color: Color, radius: Dp): Modifier = drawBehind {
    drawRoundRect(color, style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 5.dp.toPx()))), cornerRadius = androidx.compose.ui.geometry.CornerRadius(radius.toPx()))
}

@Composable
fun ProvideContent(color: Color, content: @Composable () -> Unit) = CompositionLocalProvider(LocalContentColor provides color, content = content)
