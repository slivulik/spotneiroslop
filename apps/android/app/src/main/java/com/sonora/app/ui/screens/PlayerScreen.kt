package com.sonora.app.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.automirrored.filled.Subject
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.net.TrackLicense
import com.sonora.app.data.net.WaveSettings
import com.sonora.app.playback.PlayerUi
import com.sonora.app.ui.CoverMorph
import com.sonora.app.ui.LocalActions
import com.sonora.app.ui.LocalEnv
import com.sonora.app.ui.components.Cover
import com.sonora.app.ui.components.coverColors
import com.sonora.app.ui.components.formatDuration
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.GlassPill
import com.sonora.app.ui.design.HeartBtn
import com.sonora.app.ui.design.IconBtn
import com.sonora.app.ui.design.PlayButton
import com.sonora.app.ui.design.QualityMark
import com.sonora.app.ui.design.S
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.press
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

enum class Panel { Cover, Lyrics, Queue }

/** Commands the full player sends; the real one is the PlayerConnection, tests pass no-ops. */
interface PlayerCommands {
    fun toggle()
    fun next()
    fun previous()
    fun seekTo(ms: Long)
    fun skipTo(index: Int)
    fun removeAt(index: Int)
    fun setShuffle(on: Boolean)
    fun cycleRepeat()
    /** «Не нравится» in the wave: tells the session, then plays the next track. */
    fun dislike()
    /** Playback position read on demand (the karaoke lyrics poll it more often than [PlayerUi] updates). */
    fun position(): Long
}

@UnstableApi
@Composable
fun FullPlayer(app: AppViewModel, onClose: () -> Unit, morph: CoverMorph?, lyricsVm: LyricsViewModel = hiltViewModel()) {
    val ui by app.player.state.collectAsStateWithLifecycle()
    val track = ui.track ?: return
    val lyrics by lyricsVm.lyrics.collectAsStateWithLifecycle()
    val waveSettings by app.waves.settings.collectAsStateWithLifecycle()
    val p = app.player
    val commands = remember(p, app) {
        object : PlayerCommands {
            override fun toggle() = p.toggle()
            override fun next() = p.next()
            override fun previous() = p.previous()
            override fun seekTo(ms: Long) = p.seekTo(ms)
            override fun skipTo(index: Int) = p.skipTo(index)
            override fun removeAt(index: Int) = p.removeAt(index)
            override fun setShuffle(on: Boolean) = p.setShuffle(on)
            override fun cycleRepeat() = p.cycleRepeat()
            override fun dislike() = app.dislike()
            override fun position(): Long = p.positionMs()
        }
    }
    FullPlayerContent(
        ui, lyrics?.takeIf { it.first == track.id }?.second, commands, onClose, morph,
        waveSettings = waveSettings, onLyricsWanted = { lyricsVm.load(track.id) },
    )
}

/**
 * Now playing: cover-coloured light behind a large cover (or the karaoke lyrics / the queue in its
 * place), title, seek bar, transport, a wave row (like / dislike / settings) while «Моя волна»
 * plays, and tabs for lyrics and queue. Swipe down to close; swipe the cover for next/previous.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun FullPlayerContent(
    ui: PlayerUi,
    lyrics: LyricsState?,
    commands: PlayerCommands,
    onClose: () -> Unit,
    morph: CoverMorph? = null,
    initialPanel: Panel = Panel.Cover,
    waveSettings: WaveSettings = WaveSettings(),
    onLyricsWanted: () -> Unit = {},
) {
    val track = ui.track ?: return
    val env = LocalEnv.current
    val actions = LocalActions.current
    var panel by rememberSaveable { mutableStateOf(initialPanel) }
    val wantLyrics by rememberUpdatedState(onLyricsWanted)
    // Lyrics are always offered: without stored lyrics the server looks them up when the tab opens.
    LaunchedEffect(track.id, panel) { if (panel == Panel.Lyrics || track.hasLyrics) wantLyrics() }
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val drag = remember { Animatable(0f) }
    val dragState = rememberDraggableState { d -> scope.launch { drag.snapTo((drag.value + d).coerceAtLeast(0f)) } }
    val wave = ui.context?.type == "wave"
    val liked = track.id in env.likedTracks

    // Ambient light from the cover: a tinted top fading into the page, two soft colour glows.
    val dark = C.dark
    val bg = C.bg
    val art = remember(track.release.id, track.release.artwork) { coverColors(track.release.artwork, track.release.id) }
    val tint by animateColorAsState(lerp(art[0], if (dark) Color.Black else Color.White, if (dark) 0.45f else 0.7f), tween(600), label = "tint")
    val glowA by animateColorAsState(art[1], tween(600), label = "glowA")
    val glowB by animateColorAsState(art[2], tween(600), label = "glowB")
    val glowAlpha = if (dark) 0.42f else 0.3f

    Column(
        Modifier.fillMaxSize()
            .offset { IntOffset(0, drag.value.roundToInt()) }
            .draggable(dragState, Orientation.Vertical, onDragStopped = { v ->
                if (drag.value > with(density) { 160.dp.toPx() } || v > 2600f) onClose() else drag.animateTo(0f, spring(dampingRatio = 0.85f))
            })
            .drawBehind {
                drawRect(bg)
                if (size.width <= 0f || size.height <= 0f) return@drawBehind
                drawRect(Brush.verticalGradient(0f to tint, 0.7f to bg))
                val c1 = Offset(size.width * 0.1f, size.height * 0.14f)
                val r1 = size.width * 0.95f
                drawCircle(Brush.radialGradient(listOf(glowA.copy(alpha = glowAlpha), glowA.copy(alpha = 0f)), c1, r1), r1, c1)
                val c2 = Offset(size.width * 0.95f, size.height * 0.48f)
                val r2 = size.width * 0.85f
                drawCircle(Brush.radialGradient(listOf(glowB.copy(alpha = glowAlpha * 0.8f), glowB.copy(alpha = 0f)), c2, r2), r2, c2)
            }
            .statusBarsPadding().navigationBarsPadding(),
    ) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = S.xs), verticalAlignment = Alignment.CenterVertically) {
            IconBtn(Icons.Filled.KeyboardArrowDown, "Свернуть", onClose, tint = C.text, size = 28.dp)
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(playingFrom(ui), style = T.Overline, color = C.text2, maxLines = 1)
                Text(
                    if (wave) waveSettings.summary() else ui.context?.title ?: track.release.title,
                    style = T.LabelBold, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            IconBtn(Icons.Filled.IosShare, "Поделиться", { actions.share("/track/${track.id}", "${track.fullTitle} — ${track.artistLine}") }, tint = C.text)
        }

        Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = S.xl, vertical = S.s), contentAlignment = Alignment.Center) {
            AnimatedContent(panel, transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(140)) }, label = "panel") { shown ->
                when (shown) {
                    Panel.Cover -> BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        val side = minOf(maxWidth, maxHeight)
                        val scale by animateFloatAsState(if (ui.isPlaying) 1f else 0.9f, spring(dampingRatio = 0.8f, stiffness = 220f), label = "art")
                        val shape = RoundedCornerShape(14.dp)
                        val shared = if (morph != null) with(morph.shared) { Modifier.sharedElement(rememberSharedContentState("now-playing-art"), morph.visibility) } else Modifier
                        Cover(
                            track.release.artwork, side, shape = shape, seed = track.release.id, description = track.release.title,
                            modifier = shared
                                .graphicsLayer { scaleX = scale; scaleY = scale }
                                .shadow(36.dp, shape, ambientColor = art[0], spotColor = art[0])
                                .pointerInput(track.id) {
                                    var dx = 0f
                                    detectHorizontalDragGestures(onDragEnd = {
                                        if (dx < -120) commands.next() else if (dx > 120) commands.previous()
                                        dx = 0f
                                    }) { _, amount -> dx += amount }
                                }
                                .pointerInput(track.id) { detectTapGestures(onDoubleTap = { actions.toggleSaved("tracks", track.id) }) },
                        )
                    }
                    Panel.Lyrics -> LyricsPanel(lyrics, commands::position, commands::seekTo, onLyricsWanted)
                    Panel.Queue -> QueuePanel(ui, wave, commands::skipTo, commands::removeAt)
                }
            }
        }

        Column(Modifier.padding(horizontal = S.xl)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // With lyrics or the queue on screen the cover shrinks into the title row.
                AnimatedVisibility(panel != Panel.Cover, enter = fadeIn() + expandHorizontally(), exit = fadeOut() + shrinkHorizontally()) {
                    Cover(track.release.artwork, 48.dp, shape = RoundedCornerShape(6.dp), seed = track.release.id, modifier = Modifier.padding(end = S.m))
                }
                Column(Modifier.weight(1f)) {
                    Text(track.fullTitle, style = T.Headline.copy(fontSize = 22.sp), color = C.text, maxLines = 1, modifier = Modifier.basicMarquee())
                    Text(
                        track.artistLine, style = T.Body, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.press({ track.artists.firstOrNull()?.let { onClose(); actions.navigate("artist/${it.id}") } }),
                    )
                }
                if (!wave) HeartBtn(liked, { actions.toggleSaved("tracks", track.id) }, size = 28.dp, idle = C.text)
            }
            Spacer(Modifier.height(S.m))
            SeekBar(ui, commands::seekTo)
            Row(Modifier.fillMaxWidth().padding(vertical = S.xs), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                IconBtn(Icons.Filled.Shuffle, if (ui.shuffle) "Перемешивание включено" else "Перемешать", { commands.setShuffle(!ui.shuffle) }, tint = if (ui.shuffle) C.accent else C.text2)
                IconBtn(Icons.Filled.SkipPrevious, "Предыдущий", commands::previous, tint = C.text, size = 38.dp)
                PlayButton(ui.isPlaying, commands::toggle, size = 72.dp, container = C.fg, content = C.bg)
                IconBtn(Icons.Filled.SkipNext, "Следующий", commands::next, tint = C.text, size = 38.dp)
                IconBtn(
                    if (ui.repeat == Player.REPEAT_MODE_ONE) Icons.Filled.RepeatOne else Icons.Filled.Repeat,
                    when (ui.repeat) { Player.REPEAT_MODE_ONE -> "Повтор трека"; Player.REPEAT_MODE_ALL -> "Повтор очереди"; else -> "Повтор выключен" },
                    commands::cycleRepeat, tint = if (ui.repeat != Player.REPEAT_MODE_OFF) C.accent else C.text2,
                )
            }
            if (wave) {
                Row(Modifier.fillMaxWidth().padding(top = S.xs), horizontalArrangement = Arrangement.spacedBy(S.s), verticalAlignment = Alignment.CenterVertically) {
                    GlassPill(
                        if (liked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, "Нравится", { actions.toggleSaved("tracks", track.id) },
                        tint = if (liked) C.accent else C.text, active = liked,
                    )
                    GlassPill(Icons.Outlined.ThumbDown, "Не нравится", commands::dislike)
                    Spacer(Modifier.weight(1f))
                    IconBtn(Icons.Filled.Tune, "Настроить волну", actions::openWaveSettings, tint = C.text)
                }
            }
            Row(Modifier.fillMaxWidth().padding(top = S.s, bottom = S.s), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    QualityMark(track.audio.hires, track.audio.lossless)
                    track.license?.let { LicenseMark(it, Modifier.weight(1f, fill = false)) }
                }
                PanelTab(Icons.AutoMirrored.Filled.Subject, "Текст", panel == Panel.Lyrics) { panel = if (panel == Panel.Lyrics) Panel.Cover else Panel.Lyrics }
                Spacer(Modifier.width(S.xs))
                PanelTab(Icons.AutoMirrored.Filled.QueueMusic, "Очередь", panel == Panel.Queue) { panel = if (panel == Panel.Queue) Panel.Cover else Panel.Queue }
            }
            ui.error?.let { Text(it, style = T.Caption, color = C.text2, modifier = Modifier.padding(bottom = S.s)) }
        }
    }
}

private fun playingFrom(ui: PlayerUi): String = when (ui.context?.type) {
    "release" -> "ИГРАЕТ ИЗ АЛЬБОМА"
    "playlist" -> "ИГРАЕТ ИЗ ПЛЕЙЛИСТА"
    "artist" -> "ИГРАЕТ АРТИСТ"
    "wave" -> "МОЯ ВОЛНА"
    "mix" -> "МИКС ДНЯ"
    "genre" -> "ЖАНР"
    else -> "СЕЙЧАС ИГРАЕТ"
}

/** Pill tab under the controls: icon + label, filled while its panel is open. */
@Composable
private fun PanelTab(icon: ImageVector, text: String, selected: Boolean, onClick: () -> Unit) {
    val fill by animateColorAsState(if (selected) C.fg.copy(alpha = 0.16f) else Color.Transparent, tween(150), label = "tab")
    val tint = if (selected) C.text else C.text2
    Row(
        Modifier.height(40.dp).clip(CircleShape).background(fill)
            .press(onClick, role = Role.Tab, label = text)
            .semantics { this.selected = selected }
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, style = T.LabelBold, color = tint, maxLines = 1)
    }
}

/** «CC BY-SA 4.0»-style mark of an openly licensed track; opens the licence when it has a link. */
@Composable
private fun LicenseMark(license: TrackLicense, modifier: Modifier = Modifier) {
    val uri = LocalUriHandler.current
    val link = license.url ?: license.sourceUrl
    Box(
        modifier.clip(RoundedCornerShape(4.dp)).background(C.surfaceHigh)
            .press({ link?.let { runCatching { uri.openUri(it) } } }, enabled = link != null, label = "Лицензия ${license.code}")
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(license.code.uppercase(), style = T.Overline.copy(fontSize = 10.sp, letterSpacing = 0.06.em), color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Thin line, small knob, times under the ends. */
@Composable
private fun SeekBar(ui: PlayerUi, onSeek: (Long) -> Unit) {
    var dragging by remember { mutableStateOf(false) }
    var value by remember { mutableFloatStateOf(0f) }
    val duration = ui.durationMs.coerceAtLeast(1)
    val shown = if (dragging) value else (ui.positionMs.toFloat() / duration).coerceIn(0f, 1f)
    val track = C.fg.copy(alpha = 0.2f)
    val fill = C.text
    Column {
        Box(
            Modifier.fillMaxWidth().height(24.dp)
                .semantics { contentDescription = "Перемотка: ${formatDuration((shown * duration).toLong())} из ${formatDuration(duration)}" }
                .pointerInput(duration) {
                    detectHorizontalDragGestures(
                        onDragStart = { o -> dragging = true; value = (o.x / size.width).coerceIn(0f, 1f) },
                        onDragEnd = { onSeek((value * duration).toLong()); dragging = false },
                        onDragCancel = { dragging = false },
                    ) { change, _ -> value = (change.position.x / size.width).coerceIn(0f, 1f) }
                }
                .pointerInput(duration) { detectTapGestures { o -> onSeek(((o.x / size.width).coerceIn(0f, 1f) * duration).toLong()) } }
                .drawBehind {
                    val h = 4.dp.toPx()
                    val y = size.height / 2 - h / 2
                    drawRoundRect(track, Offset(0f, y), Size(size.width, h), CornerRadius(h / 2))
                    drawRoundRect(fill, Offset(0f, y), Size(size.width * shown, h), CornerRadius(h / 2))
                    drawCircle(fill, (if (dragging) 8.dp else 6.dp).toPx(), Offset(size.width * shown, size.height / 2))
                },
        )
        Row(Modifier.fillMaxWidth()) {
            Text(formatDuration((shown * duration).toLong()), style = T.Time, color = C.text2)
            Spacer(Modifier.weight(1f))
            Text(formatDuration(ui.durationMs), style = T.Time, color = C.text2)
        }
    }
}

@Composable
private fun QueuePanel(ui: PlayerUi, wave: Boolean, onSkip: (Int) -> Unit, onRemove: (Int) -> Unit) {
    val list = rememberLazyListState(initialFirstVisibleItemIndex = ui.index.coerceAtLeast(0))
    Column(Modifier.fillMaxSize().clip(RoundedCornerShape(14.dp)).background(C.fg.copy(alpha = 0.06f))) {
        Text(if (wave) "Дальше в волне" else "Очередь", style = T.Title, color = C.text, modifier = Modifier.padding(S.l))
        LazyColumn(state = list) {
            itemsIndexed(ui.queue) { i, t ->
                Row(
                    Modifier.fillMaxWidth().height(56.dp).press({ onSkip(i) }).padding(start = S.l, end = S.xs)
                        .semantics { contentDescription = "${i + 1}. ${t.fullTitle}, ${t.artistLine}" },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Cover(t.release.artwork, 40.dp, seed = t.release.id)
                    Column(Modifier.weight(1f).padding(horizontal = S.m)) {
                        Text(t.fullTitle, style = T.BodyMedium, color = if (i == ui.index) C.accent else C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(t.artistLine, style = T.Caption, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (i != ui.index) IconBtn(Icons.Filled.Close, "Убрать из очереди", { onRemove(i) }, size = 20.dp)
                }
            }
        }
    }
}
