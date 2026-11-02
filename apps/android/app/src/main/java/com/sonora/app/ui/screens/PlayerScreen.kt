package com.sonora.app.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.automirrored.filled.Subject
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.net.Lyrics
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.playback.PlayerUi
import com.sonora.app.ui.CoverMorph
import com.sonora.app.ui.components.Cover
import com.sonora.app.ui.components.formatDuration
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.HeartBtn
import com.sonora.app.ui.design.IconBtn
import com.sonora.app.ui.design.PlayButton
import com.sonora.app.ui.design.QualityMark
import com.sonora.app.ui.design.S
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.muted
import com.sonora.app.ui.design.press
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.math.roundToInt

@HiltViewModel
class LyricsViewModel @Inject constructor(private val api: SonoraApi) : ViewModel() {
    private val _lyrics = MutableStateFlow<Pair<String, Lyrics?>?>(null)
    val lyrics: StateFlow<Pair<String, Lyrics?>?> = _lyrics

    fun load(trackId: String) {
        if (_lyrics.value?.first == trackId) return
        _lyrics.value = null
        viewModelScope.launch {
            val r = runCatching { api.lyrics(trackId) }.getOrNull()
            _lyrics.value = trackId to (if (r?.code() == 200) r.body() else null)
        }
    }
}

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
}

@UnstableApi
@Composable
fun FullPlayer(app: AppViewModel, onClose: () -> Unit, morph: CoverMorph?, lyricsVm: LyricsViewModel = hiltViewModel()) {
    val ui by app.player.state.collectAsStateWithLifecycle()
    val track = ui.track ?: return
    LaunchedEffect(track.id) { lyricsVm.load(track.id) }
    val lyrics by lyricsVm.lyrics.collectAsStateWithLifecycle()
    val p = app.player
    val commands = remember(p) {
        object : PlayerCommands {
            override fun toggle() = p.toggle()
            override fun next() = p.next()
            override fun previous() = p.previous()
            override fun seekTo(ms: Long) = p.seekTo(ms)
            override fun skipTo(index: Int) = p.skipTo(index)
            override fun removeAt(index: Int) = p.removeAt(index)
            override fun setShuffle(on: Boolean) = p.setShuffle(on)
            override fun cycleRepeat() = p.cycleRepeat()
        }
    }
    FullPlayerContent(ui, lyrics?.takeIf { it.first == track.id }?.second, lyrics?.first == track.id, commands, onClose, morph)
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun FullPlayerContent(
    ui: PlayerUi,
    lyrics: Lyrics?,
    lyricsLoaded: Boolean,
    commands: PlayerCommands,
    onClose: () -> Unit,
    morph: CoverMorph? = null,
    initialPanel: Panel = Panel.Cover,
) {
    val track = ui.track ?: return
    val env = com.sonora.app.ui.LocalEnv.current
    val actions = com.sonora.app.ui.LocalActions.current
    var panel by rememberSaveable { mutableStateOf(initialPanel) }
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val drag = remember { Animatable(0f) }
    val dragState = rememberDraggableState { d -> scope.launch { drag.snapTo((drag.value + d).coerceAtLeast(0f)) } }
    val top = muted(track.release.artwork?.palette?.dominant ?: track.release.artwork?.palette?.vibrant, C.surfaceHigh, darkness = 0.55f)
    val bg = C.bg

    Column(
        Modifier.fillMaxSize()
            .offset { IntOffset(0, drag.value.roundToInt()) }
            .draggable(dragState, Orientation.Vertical, onDragStopped = { v ->
                if (drag.value > with(density) { 160.dp.toPx() } || v > 2600f) onClose() else drag.animateTo(0f, spring(dampingRatio = 0.85f))
            })
            .drawBehind { drawRect(Brush.verticalGradient(0f to top, 0.75f to bg, 1f to bg)) }
            .statusBarsPadding().navigationBarsPadding(),
    ) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = S.xs), verticalAlignment = Alignment.CenterVertically) {
            IconBtn(Icons.Filled.KeyboardArrowDown, "Свернуть", onClose, tint = C.text, size = 28.dp)
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(playingFrom(ui), style = T.Overline, color = C.text2, maxLines = 1)
                Text(ui.context?.title ?: track.release.title, style = T.LabelBold, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconBtn(Icons.Filled.IosShare, "Поделиться", { actions.share("/track/${track.id}", "${track.fullTitle} — ${track.artistLine}") }, tint = C.text)
        }

        Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = S.xl, vertical = S.s), contentAlignment = Alignment.Center) {
            AnimatedContent(panel, transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) }, label = "panel") { p ->
                when (p) {
                    Panel.Cover -> BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        val side = minOf(maxWidth, maxHeight)
                        val scale by animateFloatAsState(if (ui.isPlaying) 1f else 0.92f, spring(dampingRatio = 0.8f, stiffness = 220f), label = "art")
                        val shared = if (morph != null) with(morph.shared) { Modifier.sharedElement(rememberSharedContentState("now-playing-art"), morph.visibility) } else Modifier
                        Cover(
                            track.release.artwork, side, shape = RoundedCornerShape(8.dp), seed = track.release.id, description = track.release.title,
                            modifier = shared
                                .graphicsLayer { scaleX = scale; scaleY = scale }
                                .shadow(28.dp, RoundedCornerShape(8.dp))
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
                    Panel.Lyrics -> LyricsPanel(lyrics, lyricsLoaded, ui, commands::seekTo)
                    Panel.Queue -> QueuePanel(ui, commands::skipTo, commands::removeAt)
                }
            }
        }

        Column(Modifier.padding(horizontal = S.xl)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(track.fullTitle, style = T.Headline.copy(fontSize = 22.sp), color = C.text, maxLines = 1, modifier = Modifier.basicMarquee())
                    Text(
                        track.artistLine, style = T.Body, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.press({ track.artists.firstOrNull()?.let { onClose(); actions.navigate("artist/${it.id}") } }),
                    )
                }
                HeartBtn(track.id in env.likedTracks, { actions.toggleSaved("tracks", track.id) }, size = 28.dp, idle = C.text)
            }
            Spacer(Modifier.height(S.m))
            SeekBar(ui, commands::seekTo)
            Spacer(Modifier.height(S.s))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                IconBtn(Icons.Filled.Shuffle, if (ui.shuffle) "Перемешивание включено" else "Перемешать", { commands.setShuffle(!ui.shuffle) }, tint = if (ui.shuffle) C.accent else C.text2)
                IconBtn(Icons.Filled.SkipPrevious, "Предыдущий", commands::previous, tint = C.text, size = 36.dp)
                PlayButton(ui.isPlaying, commands::toggle, size = 68.dp)
                IconBtn(Icons.Filled.SkipNext, "Следующий", commands::next, tint = C.text, size = 36.dp)
                IconBtn(
                    if (ui.repeat == Player.REPEAT_MODE_ONE) Icons.Filled.RepeatOne else Icons.Filled.Repeat,
                    when (ui.repeat) { Player.REPEAT_MODE_ONE -> "Повтор трека"; Player.REPEAT_MODE_ALL -> "Повтор очереди"; else -> "Повтор выключен" },
                    commands::cycleRepeat, tint = if (ui.repeat != Player.REPEAT_MODE_OFF) C.accent else C.text2,
                )
            }
            Row(Modifier.fillMaxWidth().padding(vertical = S.s), verticalAlignment = Alignment.CenterVertically) {
                QualityMark(track.audio.hires, track.audio.lossless)
                Spacer(Modifier.weight(1f))
                IconBtn(Icons.AutoMirrored.Filled.Subject, "Текст", { panel = if (panel == Panel.Lyrics) Panel.Cover else Panel.Lyrics }, tint = if (panel == Panel.Lyrics) C.accent else C.text2)
                IconBtn(Icons.AutoMirrored.Filled.QueueMusic, "Очередь", { panel = if (panel == Panel.Queue) Panel.Cover else Panel.Queue }, tint = if (panel == Panel.Queue) C.accent else C.text2)
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
private fun LyricsPanel(lyrics: Lyrics?, loaded: Boolean, ui: PlayerUi, onSeek: (Long) -> Unit) {
    Box(Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.25f))) {
        when {
            !loaded -> Unit
            lyrics == null -> Text("У этого трека нет текста", style = T.Body, color = C.text2, modifier = Modifier.align(Alignment.Center))
            lyrics.type == "static" || lyrics.lines.isEmpty() -> LazyColumn(contentPadding = PaddingValues(S.l)) {
                item { Text(lyrics.text ?: lyrics.lines.joinToString("\n") { it.text }, style = T.Body.copy(lineHeight = 26.sp), color = C.text) }
            }
            else -> {
                val active = lyrics.lines.indexOfLast { it.startMs <= ui.positionMs + 150 }
                val list = rememberLazyListState()
                LaunchedEffect(active) { if (active > 1) list.animateScrollToItem(active - 1) }
                LazyColumn(state = list, contentPadding = PaddingValues(horizontal = S.l, vertical = S.xl), verticalArrangement = Arrangement.spacedBy(S.m)) {
                    itemsIndexed(lyrics.lines) { i, line ->
                        val a by animateFloatAsState(if (i == active) 1f else 0.45f, tween(250), label = "line")
                        Text(
                            line.text.ifBlank { "♪" }, style = T.Section, color = C.text,
                            modifier = Modifier.graphicsLayer { alpha = a }.press({ onSeek(line.startMs) }),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun QueuePanel(ui: PlayerUi, onSkip: (Int) -> Unit, onRemove: (Int) -> Unit) {
    val list = rememberLazyListState(initialFirstVisibleItemIndex = ui.index.coerceAtLeast(0))
    Column(Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.25f))) {
        Text("Очередь", style = T.Title, color = C.text, modifier = Modifier.padding(S.l))
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
