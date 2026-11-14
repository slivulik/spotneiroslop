package com.sonora.app.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Subject
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import androidx.lifecycle.viewModelScope
import com.sonora.app.data.net.Lyrics
import com.sonora.app.data.net.LyricsLine
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.GlassPill
import com.sonora.app.ui.design.S
import com.sonora.app.ui.design.Skeleton
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.press
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Lyrics of one track as the player shows them. */
sealed interface LyricsState {
    data object Loading : LyricsState
    data class Ready(val lyrics: Lyrics) : LyricsState
    /** The server has none and found none in the open lyrics database (404). */
    data object NotFound : LyricsState
    /** Offline or a server error: worth another try. */
    data object Failed : LyricsState
}

/**
 * Loads lyrics for the playing track. Tracks without stored lyrics are asked for too: the server
 * looks them up on demand and remembers misses, so the request is cheap on repeat.
 */
@HiltViewModel
class LyricsViewModel @Inject constructor(private val api: SonoraApi) : ViewModel() {
    private val _lyrics = MutableStateFlow<Pair<String, LyricsState>?>(null)
    val lyrics: StateFlow<Pair<String, LyricsState>?> = _lyrics
    private var job: Job? = null

    /** No-op if this track is loaded or loading; a failed load is retried. */
    fun load(trackId: String) {
        val current = _lyrics.value
        if (current != null && current.first == trackId && current.second != LyricsState.Failed) return
        job?.cancel()
        _lyrics.value = trackId to LyricsState.Loading
        job = viewModelScope.launch {
            val state = try {
                val response = api.lyrics(trackId)
                val body = response.body()
                when {
                    response.isSuccessful && body != null && (body.lines.isNotEmpty() || !body.text.isNullOrBlank()) -> LyricsState.Ready(body)
                    response.isSuccessful || response.code() == 404 -> LyricsState.NotFound
                    else -> LyricsState.Failed
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                LyricsState.Failed
            }
            _lyrics.value = trackId to state
        }
    }
}

/** Big bold lines; the active one is scaled up and filled like karaoke. */
private val LyricStyle = TextStyle(
    fontFamily = T.Headline.fontFamily, fontWeight = T.Headline.fontWeight,
    fontSize = 26.sp, lineHeight = 34.sp, letterSpacing = (-0.01).em,
)

/**
 * Lyrics panel of the full player.
 * Synced lines: the active line is bright and fills from left to right with the playback position
 * (polled every 80 ms while the screen is visible), past lines dim, the list keeps the active line
 * in the upper third. Dragging pauses the auto-scroll for 3 s; tapping a line seeks to it.
 */
@Composable
fun LyricsPanel(state: LyricsState?, position: () -> Long, onSeek: (Long) -> Unit, onRetry: () -> Unit) {
    when (state) {
        null, LyricsState.Loading -> LyricsLoading()
        LyricsState.NotFound -> LyricsMessage("Текст не найден", "Мы поискали и в открытой базе текстов — пока пусто.")
        LyricsState.Failed -> LyricsMessage("Не удалось загрузить текст", "Проверьте соединение.") {
            GlassPill(Icons.Filled.Refresh, "Повторить", onRetry)
        }
        is LyricsState.Ready -> {
            val lyrics = state.lyrics
            if (lyrics.type == "static" || lyrics.lines.isEmpty()) StaticLyrics(lyrics.text ?: lyrics.lines.joinToString("\n") { it.text })
            else KaraokeLyrics(lyrics.lines, position, onSeek)
        }
    }
}

@Composable
private fun KaraokeLyrics(lines: List<LyricsLine>, position: () -> Long, onSeek: (Long) -> Unit) {
    val readPosition by rememberUpdatedState(position)
    var positionMs by remember { mutableLongStateOf(position()) }
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val visible = lifecycleState.isAtLeast(Lifecycle.State.STARTED)
    LaunchedEffect(visible) {
        if (!visible) return@LaunchedEffect
        while (true) {
            positionMs = readPosition()
            delay(80)
        }
    }

    val active = lines.indexOfLast { it.startMs <= positionMs + 150 }
    val list = rememberLazyListState(initialFirstVisibleItemIndex = active.coerceAtLeast(0))
    val dragged by list.interactionSource.collectIsDraggedAsState()
    var follow by remember { mutableStateOf(true) }
    LaunchedEffect(dragged) {
        if (dragged) {
            follow = false
        } else if (!follow) {
            delay(3000)
            follow = true
        }
    }
    LaunchedEffect(active, follow) {
        if (follow && active >= 0) list.animateScrollToItem(active)
    }

    val text = C.text
    val glow = if (C.dark) Shadow(Color.White.copy(alpha = 0.35f), blurRadius = 18f) else null
    BoxWithConstraints(Modifier.fillMaxSize()) {
        // Padding puts the scrolled-to (active) line a third of the way down; the edges fade out.
        LazyColumn(
            state = list,
            contentPadding = PaddingValues(start = S.xs, end = S.xl, top = maxHeight / 3, bottom = maxHeight * 2 / 3),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.fillMaxSize().fadingEdges(),
        ) {
            itemsIndexed(lines) { i, line ->
                val end = line.endMs.takeIf { it > line.startMs } ?: lines.getOrNull(i + 1)?.startMs?.takeIf { it > line.startMs } ?: (line.startMs + 4000)
                val progress = if (i == active) ((positionMs - line.startMs).toFloat() / (end - line.startMs)).coerceIn(0f, 1f) else 0f
                KaraokeLine(
                    text = line.text.ifBlank { "♪" },
                    active = i == active,
                    past = i < active,
                    progress = progress,
                    color = text,
                    glow = glow,
                ) {
                    follow = true
                    onSeek(line.startMs)
                }
            }
        }
    }
}

@Composable
private fun KaraokeLine(text: String, active: Boolean, past: Boolean, progress: Float, color: Color, glow: Shadow?, onClick: () -> Unit) {
    val scale by animateFloatAsState(if (active) 1f else 0.9f, spring(dampingRatio = 0.8f, stiffness = 260f), label = "lineScale")
    val alpha by animateFloatAsState(
        when {
            active -> 1f
            past -> 0.28f
            else -> 0.45f
        },
        tween(300), label = "lineAlpha",
    )
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    Box(
        Modifier.fillMaxWidth()
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                transformOrigin = TransformOrigin(0f, 0.5f)
                this.alpha = alpha
            }
            .press(onClick, label = text),
    ) {
        // Unfilled text; on the active line the sung part is drawn over it, line by line.
        Text(text, style = LyricStyle, color = if (active) color.copy(alpha = 0.42f) else color, onTextLayout = { layout = it })
        if (active && progress > 0f) {
            Text(
                text, style = LyricStyle.copy(shadow = glow), color = color,
                modifier = Modifier.drawWithContent {
                    val l = layout ?: return@drawWithContent
                    val widths = FloatArray(l.lineCount) { l.getLineRight(it) - l.getLineLeft(it) }
                    var remaining = widths.sum() * progress
                    for (n in 0 until l.lineCount) {
                        if (remaining <= 0f) break
                        val fill = minOf(widths[n], remaining)
                        clipRect(0f, l.getLineTop(n), l.getLineLeft(n) + fill, l.getLineBottom(n)) { this@drawWithContent.drawContent() }
                        remaining -= fill
                    }
                },
            )
        }
    }
}

/** Fades the list out at the top and bottom edges instead of cutting lines off. */
private fun Modifier.fadingEdges(): Modifier = this
    .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent {
        drawContent()
        drawRect(
            Brush.verticalGradient(0f to Color.Transparent, 0.12f to Color.Black, 0.85f to Color.Black, 1f to Color.Transparent),
            blendMode = BlendMode.DstIn,
        )
    }

@Composable
private fun StaticLyrics(text: String) {
    LazyColumn(Modifier.fillMaxSize().fadingEdges(), contentPadding = PaddingValues(start = S.xs, end = S.xl, top = S.xxl, bottom = S.xxl)) {
        item { Text(text, style = LyricStyle.copy(fontSize = 20.sp, lineHeight = 30.sp), color = C.text) }
    }
}

@Composable
private fun LyricsLoading() {
    Column(Modifier.fillMaxSize().padding(top = S.xxl, start = S.xs, end = S.xxl), verticalArrangement = Arrangement.spacedBy(S.l)) {
        Text("Ищем текст…", style = T.Label, color = C.text2)
        listOf(0.82f, 0.64f, 0.9f, 0.5f, 0.72f).forEach { f -> Skeleton(Modifier.fillMaxWidth(f).height(24.dp)) }
    }
}

@Composable
private fun LyricsMessage(title: String, hint: String, action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxSize().padding(S.xl), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.AutoMirrored.Filled.Subject, contentDescription = null, tint = C.text3, modifier = Modifier.size(40.dp))
        Spacer(Modifier.height(S.m))
        Text(title, style = T.Title, color = C.text, textAlign = TextAlign.Center)
        Spacer(Modifier.height(S.xs))
        Text(hint, style = T.Caption, color = C.text2, textAlign = TextAlign.Center)
        if (action != null) {
            Spacer(Modifier.height(S.l))
            action()
        }
    }
}
