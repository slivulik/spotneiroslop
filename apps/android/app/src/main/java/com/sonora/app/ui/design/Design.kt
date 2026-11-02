package com.sonora.app.ui.design

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.sonora.app.R
import com.sonora.app.ui.theme.Onest
import com.sonora.app.ui.theme.Unbounded
import com.sonora.core.designsystem.tokens.SonoraTokens

/*
 * Sonora on a phone: calm and precise. One text family (Onest), Unbounded only for page titles,
 * a 4-dp spacing grid, flat surfaces, accent violet reserved for play buttons and active states.
 */

val JetBrainsMono = FontFamily(Font(R.font.jetbrains_mono_500, FontWeight.Medium))

data class SonoraPalette(
    val bg: Color,
    val surface: Color,
    val surfaceHigh: Color,
    val text: Color,
    val text2: Color,
    val text3: Color,
    val divider: Color,
    val accent: Color,
    val accentPressed: Color,
    val accentMuted: Color,
    val onAccent: Color,
    val fg: Color,
    val dark: Boolean,
)

val DarkColors = with(SonoraTokens.Colors) {
    SonoraPalette(BgBase, BgElevated, BgRaised, TextPrimary, TextSecondary, TextTertiary, Color.White.copy(alpha = 0.07f), AccentDefault, AccentPressed, AccentMuted, AccentOn, Color.White, true)
}
val LightColors = with(SonoraTokens.LightColors) {
    SonoraPalette(BgBase, BgElevated, BgRaised, TextPrimary, TextSecondary, TextTertiary, Color(0xFF15131C).copy(alpha = 0.08f), AccentDefault, AccentPressed, AccentMuted, AccentOn, Color(0xFF15131C), false)
}

val LocalColors = staticCompositionLocalOf { DarkColors }
val C: SonoraPalette @Composable get() = LocalColors.current

object T {
    /** Page titles («Поиск», «Медиатека», greeting). */
    val PageTitle = TextStyle(fontFamily = Unbounded, fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 30.sp, letterSpacing = (-0.02).em)
    /** Album / artist / player titles. */
    val Headline = TextStyle(fontFamily = Onest, fontWeight = FontWeight.Bold, fontSize = 24.sp, lineHeight = 30.sp, letterSpacing = (-0.01).em)
    val Section = TextStyle(fontFamily = Onest, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 26.sp)
    val Title = TextStyle(fontFamily = Onest, fontWeight = FontWeight.Bold, fontSize = 16.sp, lineHeight = 22.sp)
    val Body = TextStyle(fontFamily = Onest, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 20.sp)
    val BodyMedium = Body.copy(fontWeight = FontWeight.Medium)
    val Label = TextStyle(fontFamily = Onest, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 18.sp)
    val LabelBold = Label.copy(fontWeight = FontWeight.Bold)
    val Caption = TextStyle(fontFamily = Onest, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 17.sp)
    val Small = TextStyle(fontFamily = Onest, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.02.em)
    val Overline = TextStyle(fontFamily = Onest, fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.12.em)
    val Time = TextStyle(fontFamily = Onest, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp)
}

/** Grid steps; nothing else is used for spacing. */
object S {
    val xs = 4.dp
    val s = 8.dp
    val m = 12.dp
    val l = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
    /** Side margin of every screen. */
    val page = 16.dp
}

fun hexColor(hex: String?): Color? = hex?.removePrefix("#")?.takeIf { it.length == 6 }?.toLongOrNull(16)?.let { Color(0xFF000000 or it) }

/** A cover colour toned down so white text on top always reads (used for headers and the mini player). */
fun muted(hex: String?, fallback: Color, darkness: Float = 0.45f): Color {
    val c = hexColor(hex) ?: return fallback
    return Color(c.red * darkness, c.green * darkness, c.blue * darkness, 1f)
}

/** Pressed rows dim slightly (no jumping); buttons can opt into a small scale. */
fun Modifier.press(onClick: () -> Unit, enabled: Boolean = true, scale: Boolean = false, role: Role = Role.Button, label: String? = null): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val a by animateFloatAsState(if (pressed) 0.6f else 1f, tween(90), label = "pressAlpha")
    val s by animateFloatAsState(if (pressed && scale) 0.94f else 1f, spring(dampingRatio = 0.6f, stiffness = 700f), label = "pressScale")
    this
        .graphicsLayer { alpha = if (enabled) a else 0.4f; scaleX = s; scaleY = s }
        .clickable(interactionSource = source, indication = null, enabled = enabled, role = role, onClickLabel = label, onClick = onClick)
}

/** The one round accent play button; icon cross-fades between play and pause. */
@Composable
fun PlayButton(playing: Boolean, onClick: () -> Unit, size: Dp = 56.dp, enabled: Boolean = true, container: Color = C.accent, content: Color = C.onAccent) {
    Box(
        Modifier.size(size).clip(CircleShape).background(container).press(onClick, enabled, scale = true, label = if (playing) "Пауза" else "Слушать"),
        contentAlignment = Alignment.Center,
    ) {
        AnimatedContent(playing, transitionSpec = { fadeIn(tween(120)) togetherWith fadeOut(tween(90)) }, label = "pp") { p ->
            Icon(if (p) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (p) "Пауза" else "Слушать", tint = content, modifier = Modifier.size(size * 0.5f))
        }
    }
}

/** 48-dp touch target around a 24-dp icon. */
@Composable
fun IconBtn(icon: ImageVector, description: String, onClick: () -> Unit, tint: Color = C.text2, size: Dp = 24.dp, enabled: Boolean = true) {
    Box(Modifier.size(48.dp).press(onClick, enabled, scale = true, label = description), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = description, tint = tint, modifier = Modifier.size(size))
    }
}

/** Heart that pops when saved. */
@Composable
fun HeartBtn(saved: Boolean, onToggle: () -> Unit, size: Dp = 24.dp, idle: Color = C.text2) {
    val pop = remember { Animatable(1f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(saved) {
        if (first) { first = false; return@LaunchedEffect }
        if (saved) pop.animateTo(1f, keyframes { durationMillis = 360; 1f at 0; 1.25f at 120; 0.95f at 240; 1f at 360 })
    }
    val tint by animateColorAsState(if (saved) C.accent else idle, label = "heart")
    Box(Modifier.size(48.dp).press(onToggle, label = if (saved) "Убрать из любимых" else "В любимые"), contentAlignment = Alignment.Center) {
        Icon(if (saved) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, contentDescription = if (saved) "Убрать из любимых" else "В любимые", tint = tint, modifier = Modifier.size(size).scale(pop.value))
    }
}

/** Filter chip: 32 dp pill. */
@Composable
fun Chip(text: String, selected: Boolean, onClick: () -> Unit) {
    val bg by animateColorAsState(if (selected) C.accent else C.surfaceHigh, tween(150), label = "chip")
    val fg by animateColorAsState(if (selected) C.onAccent else C.text, tween(150), label = "chipText")
    Box(Modifier.height(32.dp).clip(CircleShape).background(bg).press(onClick, role = Role.Tab).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
        Text(text, style = T.Label, color = fg, maxLines = 1)
    }
}

/** Outlined pill (Подписаться, Выйти…). */
@Composable
fun OutlinePill(text: String, onClick: () -> Unit, active: Boolean = false) {
    Box(
        Modifier.height(32.dp).clip(CircleShape)
            .drawBehind { drawRoundRect(if (active) Color.Transparent else Color.White.copy(alpha = 0.4f), cornerRadius = CornerRadius(size.height / 2), style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx())) }
            .background(if (active) C.surfaceHigh else Color.Transparent)
            .press(onClick).padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = T.LabelBold, color = C.text) }
}

/** Full-width primary button. */
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Box(
        modifier.fillMaxWidth().height(52.dp).clip(CircleShape).background(C.accent).press(onClick, enabled, scale = true),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = T.Title, color = C.onAccent) }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(start = S.page, end = S.page, top = S.xl, bottom = S.m), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = T.Section, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (action != null && onAction != null) Text(action, style = T.LabelBold, color = C.text2, modifier = Modifier.press(onAction))
    }
}

/** Small «HI-RES» / «LOSSLESS» mark next to the meta line. */
@Composable
fun QualityMark(hires: Boolean, lossless: Boolean) {
    if (!hires && !lossless) return
    Box(Modifier.clip(RoundedCornerShape(4.dp)).background(C.surfaceHigh).padding(horizontal = 6.dp, vertical = 2.dp)) {
        Text(if (hires) "HI-RES" else "LOSSLESS", style = T.Overline.copy(fontSize = 10.sp, letterSpacing = 0.06.em), color = C.text2)
    }
}

/** Three bouncing bars for the playing item. */
@Composable
fun EqBars(playing: Boolean, color: Color = C.accent, modifier: Modifier = Modifier) {
    val t = rememberInfiniteTransition(label = "eq")
    val bars = listOf(0, 160, 320).map { d ->
        t.animateFloat(0.3f, 1f, infiniteRepeatable(tween(480, easing = LinearEasing), RepeatMode.Reverse, StartOffset(d)), label = "eq$d")
    }
    Canvas(modifier.size(14.dp)) {
        val w = size.width / 5
        bars.forEachIndexed { i, v ->
            val h = size.height * (if (playing) v.value else 0.35f)
            drawRoundRect(color, Offset(i * 2 * w, size.height - h), Size(w, h), CornerRadius(w / 2))
        }
    }
}

/** Shimmer placeholder. */
@Composable
fun Skeleton(modifier: Modifier, shape: Shape = RoundedCornerShape(8.dp)) {
    val t = rememberInfiniteTransition(label = "sk")
    val x by t.animateFloat(-1f, 2f, infiniteRepeatable(tween(1300, easing = LinearEasing)), label = "x")
    val base = C.fg.copy(alpha = 0.06f)
    val shine = C.fg.copy(alpha = 0.10f)
    Box(modifier.clip(shape).drawBehind {
        drawRect(base)
        drawRect(Brush.linearGradient(listOf(Color.Transparent, shine, Color.Transparent), Offset(size.width * x - size.width / 2, 0f), Offset(size.width * x, size.height)))
    })
}

/** Soft colour wash behind a page header (Spotify-style), fading into the background. */
fun Modifier.headerWash(color: Color, height: Dp = 360.dp): Modifier = composed {
    val bg = C.bg
    drawBehind {
        val h = height.toPx()
        drawRect(Brush.verticalGradient(0f to color, 1f to bg, startY = 0f, endY = h), size = Size(size.width, h))
    }
}
