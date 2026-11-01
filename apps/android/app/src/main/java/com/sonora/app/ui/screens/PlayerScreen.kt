package com.sonora.app.ui.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
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
import com.sonora.app.ui.components.Cover
import com.sonora.app.ui.components.LikeButton
import com.sonora.app.ui.components.formatDuration
import com.sonora.app.ui.components.parseColor
import com.sonora.app.ui.theme.Sonora
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

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

@UnstableApi
@Composable
fun MiniPlayer(app: AppViewModel, onOpen: () -> Unit) {
    val ui by app.player.state.collectAsStateWithLifecycle()
    val track = ui.track ?: return
    val ids by app.library.ids.collectAsStateWithLifecycle()
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp).clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh).clickable(onClick = onOpen)
            .semantics { contentDescription = "Сейчас играет: ${track.fullTitle}. Открыть плеер" },
    ) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Cover(track.release.artwork, 44.dp)
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(track.fullTitle, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(track.artistLine, style = MaterialTheme.typography.bodySmall, color = Sonora.colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            LikeButton(track.id in ids.tracks, { app.toggle("tracks", track.id) })
            IconButton(onClick = { app.player.toggle() }) {
                Icon(if (ui.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (ui.isPlaying) "Пауза" else "Играть")
            }
            IconButton(onClick = { app.player.next() }) { Icon(Icons.Filled.SkipNext, contentDescription = "Следующий") }
        }
        LinearProgressIndicator(
            progress = { if (ui.durationMs > 0) (ui.positionMs.toFloat() / ui.durationMs).coerceIn(0f, 1f) else 0f },
            modifier = Modifier.fillMaxWidth().height(2.dp),
        )
    }
}

@UnstableApi
@Composable
fun FullPlayer(app: AppViewModel, navigate: (String) -> Unit, onClose: () -> Unit, lyricsVm: LyricsViewModel = hiltViewModel()) {
    val ui by app.player.state.collectAsStateWithLifecycle()
    val ids by app.library.ids.collectAsStateWithLifecycle()
    val track = ui.track
    if (track == null) {
        LaunchedEffect(Unit) { onClose() }
        return
    }
    LaunchedEffect(track.id) { lyricsVm.load(track.id) }
    val lyrics by lyricsVm.lyrics.collectAsStateWithLifecycle()
    val tint by animateColorAsState(parseColor(track.release.artwork?.palette?.vibrant) ?: MaterialTheme.colorScheme.primary, label = "tint")
    var tab by rememberSaveable { mutableIntStateOf(0) }
    Column(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(tint.copy(alpha = 0.55f), MaterialTheme.colorScheme.background, MaterialTheme.colorScheme.background)))
            .statusBarsPadding(),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Свернуть плеер") }
            Text(ui.context?.title ?: "", style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            IconButton(onClick = { app.share("/track/${track.id}", "${track.fullTitle} — ${track.artistLine}") }) { Icon(Icons.Filled.Share, contentDescription = "Поделиться") }
        }
        TabRow(selectedTabIndex = tab, containerColor = Color.Transparent) {
            listOf("Сейчас", "Текст", "Очередь").forEachIndexed { i, label -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) }) }
        }
        Box(Modifier.weight(1f)) {
            when (tab) {
                0 -> Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
                    Cover(track.release.artwork, 360.dp, modifier = Modifier.fillMaxWidth().aspectRatio(1f), shape = RoundedCornerShape(16.dp), description = track.release.title)
                }
                1 -> LyricsPane(lyrics?.takeIf { it.first == track.id }?.second, loaded = lyrics?.first == track.id, ui = ui, onSeek = app.player::seekTo)
                else -> QueuePane(ui, onSkip = app.player::skipTo, onRemove = app.player::removeAt)
            }
        }
        Column(Modifier.padding(horizontal = 24.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(track.fullTitle, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable { onClose(); navigate("album/${track.release.id}") })
                    Text(track.artistLine, color = Sonora.colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable { track.artists.firstOrNull()?.let { onClose(); navigate("artist/${it.id}") } })
                }
                LikeButton(track.id in ids.tracks, { app.toggle("tracks", track.id) })
            }
            Seek(ui, app.player::seekTo)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { app.player.setShuffle(!ui.shuffle) }) {
                    Icon(Icons.Filled.Shuffle, contentDescription = if (ui.shuffle) "Перемешивание включено" else "Перемешать", tint = if (ui.shuffle) MaterialTheme.colorScheme.primary else Sonora.colors.textSecondary)
                }
                IconButton(onClick = { app.player.previous() }, modifier = Modifier.size(56.dp)) { Icon(Icons.Filled.SkipPrevious, contentDescription = "Предыдущий", modifier = Modifier.size(36.dp)) }
                FilledIconButton(onClick = { app.player.toggle() }, modifier = Modifier.size(72.dp), shape = CircleShape) {
                    Icon(if (ui.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (ui.isPlaying) "Пауза" else "Играть", modifier = Modifier.size(36.dp))
                }
                IconButton(onClick = { app.player.next() }, modifier = Modifier.size(56.dp)) { Icon(Icons.Filled.SkipNext, contentDescription = "Следующий", modifier = Modifier.size(36.dp)) }
                IconButton(onClick = { app.player.cycleRepeat() }) {
                    val on = ui.repeat != Player.REPEAT_MODE_OFF
                    Icon(
                        if (ui.repeat == Player.REPEAT_MODE_ONE) Icons.Filled.RepeatOne else Icons.Filled.Repeat,
                        contentDescription = when (ui.repeat) { Player.REPEAT_MODE_ONE -> "Повтор трека"; Player.REPEAT_MODE_ALL -> "Повтор очереди"; else -> "Повтор выключен" },
                        tint = if (on) MaterialTheme.colorScheme.primary else Sonora.colors.textSecondary,
                    )
                }
            }
            ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun Seek(ui: PlayerUi, onSeek: (Long) -> Unit) {
    var dragging by remember { mutableStateOf(false) }
    var value by remember { mutableFloatStateOf(0f) }
    val duration = ui.durationMs.coerceAtLeast(1)
    val shown = if (dragging) value else (ui.positionMs.toFloat() / duration).coerceIn(0f, 1f)
    Slider(
        value = shown,
        onValueChange = { dragging = true; value = it },
        onValueChangeFinished = { onSeek((value * duration).toLong()); dragging = false },
        modifier = Modifier.semantics { contentDescription = "Перемотка: ${formatDuration((shown * duration).toLong())} из ${formatDuration(duration)}" },
    )
    Row(Modifier.fillMaxWidth()) {
        Text(formatDuration((shown * duration).toLong()), style = MaterialTheme.typography.labelSmall, color = Sonora.colors.textSecondary)
        Spacer(Modifier.weight(1f))
        Text(formatDuration(ui.durationMs), style = MaterialTheme.typography.labelSmall, color = Sonora.colors.textSecondary)
    }
}

@Composable
private fun LyricsPane(lyrics: Lyrics?, loaded: Boolean, ui: PlayerUi, onSeek: (Long) -> Unit) {
    if (!loaded) return
    if (lyrics == null) return Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Для этого трека нет текста", color = Sonora.colors.textSecondary) }
    if (lyrics.type == "static" || lyrics.lines.isEmpty()) {
        return LazyColumn(contentPadding = PaddingValues(24.dp)) {
            item { Text(lyrics.text ?: lyrics.lines.joinToString("\n") { it.text }, style = MaterialTheme.typography.titleMedium, lineHeight = 30.sp) }
        }
    }
    val active = lyrics.lines.indexOfLast { it.startMs <= ui.positionMs + 150 }
    val list = rememberLazyListState()
    LaunchedEffect(active) { if (active > 1) list.animateScrollToItem(active - 1) }
    LazyColumn(state = list, contentPadding = PaddingValues(horizontal = 24.dp, vertical = 48.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        itemsIndexed(lyrics.lines) { i, line ->
            Text(
                line.text.ifBlank { "♪" },
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                color = when {
                    i == active -> MaterialTheme.colorScheme.onBackground
                    i < active -> Sonora.colors.textTertiary
                    else -> Sonora.colors.textSecondary
                },
                modifier = Modifier.clickable { onSeek(line.startMs) },
            )
        }
    }
}

@Composable
private fun QueuePane(ui: PlayerUi, onSkip: (Int) -> Unit, onRemove: (Int) -> Unit) {
    val list = rememberLazyListState(initialFirstVisibleItemIndex = ui.index.coerceAtLeast(0))
    LazyColumn(state = list, contentPadding = PaddingValues(vertical = 8.dp)) {
        itemsIndexed(ui.queue) { i, t ->
            Row(
                Modifier.fillMaxWidth().clickable { onSkip(i) }.padding(horizontal = 16.dp, vertical = 6.dp)
                    .semantics { contentDescription = "${i + 1}. ${t.fullTitle}, ${t.artistLine}" },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Cover(t.release.artwork, 44.dp)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(t.fullTitle, color = if (i == ui.index) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(t.artistLine, style = MaterialTheme.typography.bodySmall, color = Sonora.colors.textSecondary, maxLines = 1)
                }
                if (i != ui.index) IconButton(onClick = { onRemove(i) }) { Icon(Icons.Filled.Close, contentDescription = "Убрать из очереди") }
            }
        }
    }
}
