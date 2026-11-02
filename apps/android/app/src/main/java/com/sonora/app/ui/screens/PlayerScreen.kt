package com.sonora.app.ui.screens

import android.content.Context
import android.media.AudioManager
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.automirrored.filled.Subject
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
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
import androidx.compose.ui.draw.blur
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
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
import com.sonora.app.ui.components.releaseKind
import com.sonora.app.ui.design.AccentPlayButton
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.GlassIconButton
import com.sonora.app.ui.design.Gold
import com.sonora.app.ui.design.HeartButton
import com.sonora.app.ui.design.MonoLabel
import com.sonora.app.ui.design.QualityBadge
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.glass
import com.sonora.app.ui.design.hexColor
import com.sonora.app.ui.design.pressable
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

private enum class Panel(val title: String) { None(""), Lyrics("Текст"), Info("О треке"), Queue("Очередь") }

@UnstableApi
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun FullPlayer(app: AppViewModel, navigate: (String) -> Unit, onClose: () -> Unit, morph: CoverMorph, lyricsVm: LyricsViewModel = hiltViewModel()) {
    val ui by app.player.state.collectAsStateWithLifecycle()
    val ids by app.library.ids.collectAsStateWithLifecycle()
    val track = ui.track ?: return
    var panel by rememberSaveable { mutableStateOf(Panel.None) }
    LaunchedEffect(track.id) { lyricsVm.load(track.id) }
    val lyrics by lyricsVm.lyrics.collectAsStateWithLifecycle()
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    // Swipe down to close, like a sheet.
    val drag = remember { Animatable(0f) }
    val dragState = rememberDraggableState { d -> scope.launch { drag.snapTo((drag.value + d).coerceAtLeast(0f)) } }
    val tint = hexColor(track.release.artwork?.palette?.vibrant) ?: C.accent

    Box(
        Modifier.fillMaxSize()
            .offset { IntOffset(0, drag.value.roundToInt()) }
            .graphicsLayer { alpha = 1f - (drag.value / 2400f).coerceIn(0f, 0.4f) }
            .draggable(dragState, Orientation.Vertical, onDragStopped = { v ->
                if (drag.value > with(density) { 140.dp.toPx() } || v > 2500f) onClose() else drag.animateTo(0f, spring(dampingRatio = 0.8f))
            })
            .background(C.bg),
    ) {
        // Backdrop: the artwork blown up and blurred, then darkened (NowPlaying.tsx).
        Cover(
            track.release.artwork, 300.dp, shape = RoundedCornerShape(0.dp), seed = track.release.id,
            modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = 1.25f; scaleY = 1.25f; alpha = 0.6f }.blur(80.dp),
        )
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to C.bg.copy(alpha = 0.1f), 0.5f to C.bg.copy(alpha = 0.4f), 1f to C.bg.copy(alpha = 0.85f))))

        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                GlassIconButton(Icons.Filled.KeyboardArrowDown, "Свернуть", onClose)
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("ИГРАЕТ ИЗ", style = T.Micro.copy(letterSpacing = 2.sp), color = C.text.copy(alpha = 0.6f))
                    Text(ui.context?.title ?: track.release.title, style = T.CaptionBold, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(Panel.Lyrics to Icons.AutoMirrored.Filled.Subject, Panel.Info to Icons.Filled.Info, Panel.Queue to Icons.AutoMirrored.Filled.QueueMusic).forEach { (p, icon) ->
                        GlassIconButton(icon, p.title, { panel = if (panel == p) Panel.None else p }, active = panel == p)
                    }
                }
            }

            Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 24.dp), contentAlignment = Alignment.Center) {
                AnimatedContent(panel, transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.96f)) togetherWith fadeOut() }, label = "panel") { p ->
                    when (p) {
                        Panel.None -> {
                            val scale by animateFloatAsState(if (ui.isPlaying) 1f else 0.88f, spring(dampingRatio = 0.6f, stiffness = 180f), label = "art")
                            BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                val side = minOf(maxWidth, maxHeight)
                                with(morph.shared) {
                                    Cover(
                                        track.release.artwork, side, shape = RoundedCornerShape(22.dp), seed = track.release.id, description = track.release.title,
                                        modifier = Modifier
                                            .sharedElement(rememberSharedContentState("now-playing-art"), morph.visibility)
                                            .graphicsLayer { scaleX = scale; scaleY = scale }
                                            .shadow(32.dp, RoundedCornerShape(22.dp), spotColor = tint, ambientColor = Color.Black)
                                            .pointerInput(track.id) {
                                                // Swipe the cover sideways to change track.
                                                var dx = 0f
                                                detectHorizontalDragGestures(onDragEnd = {
                                                    if (dx < -120) app.player.next() else if (dx > 120) app.player.previous()
                                                    dx = 0f
                                                }) { _, amount -> dx += amount }
                                            }
                                            .pointerInput(Unit) { detectTapGestures(onDoubleTap = { app.toggle("tracks", track.id) }) },
                                    )
                                }
                            }
                        }
                        Panel.Lyrics -> LyricsPane(lyrics?.takeIf { it.first == track.id }?.second, loaded = lyrics?.first == track.id, ui = ui, onSeek = app.player::seekTo)
                        Panel.Info -> InfoPane(ui, navigate = { onClose(); navigate(it) })
                        Panel.Queue -> QueuePane(ui, onSkip = app.player::skipTo, onRemove = app.player::removeAt)
                    }
                }
            }

            Column(Modifier.padding(horizontal = 24.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            track.fullTitle, style = T.Title1, color = C.text, maxLines = 1,
                            modifier = Modifier.basicMarquee().pressable({ onClose(); navigate("album/${track.release.id}") }, scaleTo = 1f),
                        )
                        Text(
                            track.artistLine, style = T.BodyL, color = C.text.copy(alpha = 0.75f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.pressable({ track.artists.firstOrNull()?.let { onClose(); navigate("artist/${it.id}") } }, scaleTo = 1f),
                        )
                    }
                    HeartButton(track.id in ids.tracks, { app.toggle("tracks", track.id) }, size = 26.dp, tint = C.text)
                }
                SeekBar(ui, app.player::seekTo)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    TransportIcon(Icons.Filled.Shuffle, if (ui.shuffle) "Перемешивание включено" else "Перемешать", ui.shuffle) { app.player.setShuffle(!ui.shuffle) }
                    TransportIcon(Icons.Filled.SkipPrevious, "Предыдущий", false, big = true) { app.player.previous() }
                    AccentPlayButton(ui.isPlaying, { app.player.toggle() }, size = 72.dp)
                    TransportIcon(Icons.Filled.SkipNext, "Следующий", false, big = true) { app.player.next() }
                    TransportIcon(
                        if (ui.repeat == Player.REPEAT_MODE_ONE) Icons.Filled.RepeatOne else Icons.Filled.Repeat,
                        when (ui.repeat) { Player.REPEAT_MODE_ONE -> "Повтор трека"; Player.REPEAT_MODE_ALL -> "Повтор очереди"; else -> "Повтор выключен" },
                        ui.repeat != Player.REPEAT_MODE_OFF,
                    ) { app.player.cycleRepeat() }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    QualityPill(track.audio.hires, track.audio.lossless)
                    Spacer(Modifier.weight(1f))
                    VolumeControl()
                }
                ui.error?.let { Text(it, style = T.Caption, color = C.text2) }
            }
        }
    }
}

@Composable
private fun TransportIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, active: Boolean, big: Boolean = false, onClick: () -> Unit) {
    val tint = if (active) C.accent else if (big) C.text else C.text2
    Box(Modifier.size(if (big) 56.dp else 44.dp).pressable(onClick, scaleTo = 0.85f, label = description), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = description, tint = tint, modifier = Modifier.size(if (big) 36.dp else 26.dp))
        if (active) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp).size(4.dp).clip(CircleShape).background(C.accent))
    }
}

/** Thin line with mono timestamps; thickens and shows a knob while dragging (ProgressBar large). */
@Composable
private fun SeekBar(ui: PlayerUi, onSeek: (Long) -> Unit) {
    var dragging by remember { mutableStateOf(false) }
    var value by remember { mutableFloatStateOf(0f) }
    val duration = ui.durationMs.coerceAtLeast(1)
    val shown = if (dragging) value else (ui.positionMs.toFloat() / duration).coerceIn(0f, 1f)
    val thickness by animateFloatAsState(if (dragging) 8f else 4f, spring(stiffness = 600f), label = "seek")
    val track = C.fg.copy(alpha = 0.18f)
    val fill = C.text
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(formatDuration((shown * duration).toLong()), style = T.Mono.copy(letterSpacing = 0.sp, fontSize = 12.sp), color = C.text2, modifier = Modifier.width(44.dp))
        Box(
            Modifier.weight(1f).height(32.dp)
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
                    val h = thickness.dp.toPx()
                    val y = size.height / 2 - h / 2
                    drawRoundRect(track, Offset(0f, y), Size(size.width, h), CornerRadius(h / 2))
                    drawRoundRect(fill, Offset(0f, y), Size(size.width * shown, h), CornerRadius(h / 2))
                    if (dragging) drawCircle(fill, 8.dp.toPx(), Offset(size.width * shown, size.height / 2))
                },
        )
        Text(formatDuration(ui.durationMs), style = T.Mono.copy(letterSpacing = 0.sp, fontSize = 12.sp), color = C.text2, modifier = Modifier.width(44.dp).padding(start = 8.dp))
    }
}

@Composable
private fun QualityPill(hires: Boolean, lossless: Boolean) {
    val label = if (hires) "HI-RES" else if (lossless) "LOSSLESS" else "AAC"
    val color = if (hires || lossless) Gold else C.text2
    Box(Modifier.clip(CircleShape).background(Color.Transparent).drawBehind {
        drawRoundRect(color.copy(alpha = 0.7f), cornerRadius = CornerRadius(size.height / 2), style = androidx.compose.ui.graphics.drawscope.Stroke(1.5.dp.toPx()))
    }.padding(horizontal = 14.dp, vertical = 6.dp)) {
        Text(label, style = T.Mono.copy(fontSize = 13.sp, letterSpacing = 0.8.sp), color = color)
    }
}

/** System media volume (the web player has its own volume; on a phone that is the device volume). */
@Composable
private fun VolumeControl() {
    val context = LocalContext.current
    val audio = remember { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    val max = remember { audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1) }
    var level by remember { mutableFloatStateOf(audio.getStreamVolume(AudioManager.STREAM_MUSIC) / max.toFloat()) }
    val fill = C.text
    val track = C.fg.copy(alpha = 0.18f)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.AutoMirrored.Filled.VolumeUp, contentDescription = null, tint = C.text2, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(10.dp))
        Box(
            Modifier.width(120.dp).height(28.dp)
                .semantics { contentDescription = "Громкость ${(level * 100).roundToInt()}%" }
                .pointerInput(Unit) {
                    fun set(x: Float) {
                        level = (x / size.width).coerceIn(0f, 1f)
                        audio.setStreamVolume(AudioManager.STREAM_MUSIC, (level * max).roundToInt(), 0)
                    }
                    detectHorizontalDragGestures(onDragStart = { set(it.x) }) { change, _ -> set(change.position.x) }
                }
                .drawBehind {
                    val h = 4.dp.toPx()
                    val y = size.height / 2 - h / 2
                    drawRoundRect(track, Offset(0f, y), Size(size.width, h), CornerRadius(h / 2))
                    drawRoundRect(fill, Offset(0f, y), Size(size.width * level, h), CornerRadius(h / 2))
                },
        )
    }
}

@Composable
private fun LyricsPane(lyrics: Lyrics?, loaded: Boolean, ui: PlayerUi, onSeek: (Long) -> Unit) {
    Box(Modifier.fillMaxSize().glass(RoundedCornerShape(22.dp)).padding(4.dp)) {
        when {
            !loaded -> Unit
            lyrics == null -> Text("Для этого трека нет текста", style = T.Body, color = C.text2, modifier = Modifier.align(Alignment.Center))
            lyrics.type == "static" || lyrics.lines.isEmpty() -> LazyColumn(contentPadding = PaddingValues(20.dp)) {
                item { Text(lyrics.text ?: lyrics.lines.joinToString("\n") { it.text }, style = T.BodyL.copy(lineHeight = 30.sp), color = C.text) }
            }
            else -> {
                val active = lyrics.lines.indexOfLast { it.startMs <= ui.positionMs + 150 }
                val list = rememberLazyListState()
                LaunchedEffect(active) { if (active > 1) list.animateScrollToItem(active - 1) }
                LazyColumn(state = list, contentPadding = PaddingValues(horizontal = 20.dp, vertical = 40.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    itemsIndexed(lyrics.lines) { i, line ->
                        val a by animateFloatAsState(if (i == active) 1f else if (i < active) 0.35f else 0.55f, label = "line")
                        val s by animateFloatAsState(if (i == active) 1f else 0.94f, spring(stiffness = 300f), label = "lineScale")
                        Text(
                            line.text.ifBlank { "♪" },
                            style = T.Title2.copy(fontSize = 24.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold),
                            color = C.text,
                            modifier = Modifier.graphicsLayer { alpha = a; scaleX = s; scaleY = s; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0.5f) }
                                .pressable({ onSeek(line.startMs) }, scaleTo = 0.98f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun InfoPane(ui: PlayerUi, navigate: (String) -> Unit) {
    val t = ui.track ?: return
    Column(Modifier.fillMaxSize().glass(RoundedCornerShape(22.dp)).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("О треке", style = T.Title3, color = C.text)
        Row(Modifier.fillMaxWidth().pressable({ navigate("album/${t.release.id}") }, scaleTo = 0.98f), verticalAlignment = Alignment.CenterVertically) {
            Cover(t.release.artwork, 56.dp, seed = t.release.id)
            Column(Modifier.padding(start = 12.dp)) {
                MonoLabel(releaseKind(t.release.type))
                Text(t.release.title, style = T.BodyBold, color = C.text)
            }
        }
        t.artists.forEach { a ->
            Row(Modifier.fillMaxWidth().pressable({ navigate("artist/${a.id}") }, scaleTo = 0.98f), verticalAlignment = Alignment.CenterVertically) {
                MonoLabel(if (a.role == "featured") "При участии" else "Артист", Modifier.width(110.dp))
                Text(a.name, style = T.BodyBold, color = C.text)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            MonoLabel("Длительность", Modifier.width(110.dp))
            Text(formatDuration(t.durationMs), style = T.Body, color = C.text)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            MonoLabel("Качество", Modifier.width(110.dp))
            if (t.audio.hires || t.audio.lossless) QualityBadge(t.audio.hires, t.audio.lossless) else Text("AAC", style = T.Body, color = C.text)
        }
        if (t.isExplicit) Text("Содержит ненормативную лексику", style = T.Caption, color = C.text2)
    }
}

@Composable
private fun QueuePane(ui: PlayerUi, onSkip: (Int) -> Unit, onRemove: (Int) -> Unit) {
    val list = rememberLazyListState(initialFirstVisibleItemIndex = ui.index.coerceAtLeast(0))
    Box(Modifier.fillMaxSize().glass(RoundedCornerShape(22.dp))) {
        LazyColumn(state = list, contentPadding = PaddingValues(vertical = 8.dp)) {
            itemsIndexed(ui.queue) { i, t ->
                Row(
                    Modifier.fillMaxWidth().pressable({ onSkip(i) }, scaleTo = 0.98f).padding(horizontal = 14.dp, vertical = 6.dp)
                        .semantics { contentDescription = "${i + 1}. ${t.fullTitle}, ${t.artistLine}" },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Cover(t.release.artwork, 44.dp, shape = RoundedCornerShape(8.dp), seed = t.release.id)
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(t.fullTitle, style = T.BodyBold, color = if (i == ui.index) C.accent else C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(t.artistLine, style = T.Caption, color = C.text2, maxLines = 1)
                    }
                    if (i != ui.index) Box(Modifier.size(40.dp).pressable({ onRemove(i) }, scaleTo = 0.85f, label = "Убрать из очереди"), contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Close, contentDescription = "Убрать из очереди", tint = C.text2, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
    }
}
