package com.sonora.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.net.ArtistSummary
import com.sonora.app.data.net.Home
import com.sonora.app.data.net.HomeBlock
import com.sonora.app.data.net.MixSummary
import com.sonora.app.data.net.PlaylistSummary
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.net.Track
import com.sonora.app.data.net.SessionStore
import com.sonora.app.data.repo.OfflineCache
import com.sonora.app.data.repo.userMessage
import com.sonora.app.playback.PlayContext
import com.sonora.app.ui.AppTopBar
import com.sonora.app.ui.LocalBottomInset
import com.sonora.app.ui.components.ArtistCard
import com.sonora.app.ui.components.Cover
import com.sonora.app.ui.components.GenreTile
import com.sonora.app.ui.components.LoadState
import com.sonora.app.ui.components.MediaCard
import com.sonora.app.ui.components.PlaylistCard
import com.sonora.app.ui.components.ReleaseCard
import com.sonora.app.ui.components.Shelf
import com.sonora.app.ui.components.TrackListBox
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.components.UiState
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.EqBars
import com.sonora.app.ui.design.GradientHeadline
import com.sonora.app.ui.design.MonoLabel
import com.sonora.app.ui.design.SectionHeader
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.WaveLine
import com.sonora.app.ui.design.WhitePillButton
import com.sonora.app.ui.design.appear
import com.sonora.app.ui.design.pressable
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject

/** Loads a screen through the offline cache into a [UiState]. */
abstract class LoadingViewModel<T> : ViewModel() {
    protected val _state = MutableStateFlow<UiState<T>>(UiState.Loading)
    val state: StateFlow<UiState<T>> = _state
    protected abstract val cache: OfflineCache
    protected abstract suspend fun fetch(): com.sonora.app.data.repo.Loaded<T>

    fun load() = viewModelScope.launch {
        if (_state.value !is UiState.Ready) _state.value = UiState.Loading
        _state.value = runCatching { fetch() }.fold(
            onSuccess = { UiState.Ready(it.data, it.offline) },
            onFailure = { UiState.Failed(it.userMessage(cache.json)) },
        )
    }
}

@Serializable
data class HomeData(
    val home: Home,
    val recent: List<Track> = emptyList(),
    val mixes: List<MixSummary> = emptyList(),
    val artists: List<ArtistSummary> = emptyList(),
    val playlists: List<PlaylistSummary> = emptyList(),
)

@HiltViewModel
class HomeViewModel @Inject constructor(private val api: SonoraApi, private val session: SessionStore, override val cache: OfflineCache) : LoadingViewModel<HomeData>() {
    override suspend fun fetch() = cache.load("home:${session.tokens.value != null}") {
        coroutineScope {
            val home = async { api.home() }
            if (session.tokens.value == null) return@coroutineScope HomeData(home.await())
            val recent = async { runCatching { api.recent().items }.getOrDefault(emptyList()) }
            val mixes = async { runCatching { api.mixes() }.getOrDefault(emptyList()) }
            val artists = async { runCatching { api.topArtists() }.getOrDefault(emptyList()) }
            val playlists = async { runCatching { api.myPlaylists() }.getOrDefault(emptyList()) }
            HomeData(home.await(), recent.await(), mixes.await(), artists.await(), playlists.await().filter { it.type == "user" })
        }
    }
    init { load() }
}

/** Same words as the web home (app/page.tsx). */
private fun greeting(): String {
    val h = LocalTime.now().hour
    return when {
        h < 5 -> "Ночной эфир"
        h < 12 -> "Утренний эфир"
        h < 18 -> "Дневной эфир"
        else -> "Вечерний эфир"
    }
}

private val dateFormat = DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.forLanguageTag("ru"))

@UnstableApi
@Composable
fun HomeScreen(app: AppViewModel, navigate: (String) -> Unit, vm: HomeViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val player by app.player.state.collectAsStateWithLifecycle()
    val signedIn by app.auth.signedIn.collectAsStateWithLifecycle()
    val me by app.auth.me.collectAsStateWithLifecycle()
    val ids by app.library.ids.collectAsStateWithLifecycle()
    LaunchedEffect(signedIn) { vm.load() }
    LoadState(state, onRetry = { vm.load() }) { data ->
        LazyColumn(contentPadding = PaddingValues(bottom = LocalBottomInset.current + 16.dp)) {
            var section = 0 // numbering "01, 02…" is fixed while the list is built
            item { AppTopBar(app, navigate) }
            item {
                Column(Modifier.padding(horizontal = 16.dp).padding(top = 8.dp, bottom = 4.dp)) {
                    MonoLabel(LocalDate.now().format(dateFormat), color = C.text2, dot = true)
                    Spacer(Modifier.height(12.dp))
                    GradientHeadline(greeting(), me?.displayName?.let { ", $it" }, modifier = Modifier.appear(0))
                    WaveLine(Modifier.padding(top = 4.dp), amplitude = 6.dp, energy = if (player.isPlaying) 0.6f else 0f)
                }
            }
            if (signedIn != null) {
                item { WaveCard(playing = player.context?.type == "wave" && player.isPlaying) { if (player.context?.type == "wave") app.player.toggle() else app.player.playWave() } }
                if (data.recent.isNotEmpty()) item { ContinueListening(data.recent.take(6), player.track?.id, player.isPlaying, app) }
                if (data.mixes.isNotEmpty()) {
                    val n = section++
                    item { SectionHeader(n, "Миксы дня", "Собраны из того, что вы слушаете") }
                    item { Shelf(data.mixes, { it.key }) { i, m -> MediaCard(m.mosaic.firstOrNull(), m.title, m.subtitle ?: "${m.trackCount} треков", index = i, seed = m.key) { navigate("mix/${m.key}") } } }
                }
                if (data.artists.isNotEmpty()) {
                    val n = section++
                    item { SectionHeader(n, "Ваши артисты") }
                    item { Shelf(data.artists, { it.id }) { i, a -> ArtistCard(a, a.id in ids.artists, { app.toggle("artists", a.id) }, index = i) { navigate("artist/${a.id}") } } }
                }
                if (data.playlists.isNotEmpty()) {
                    val n = section++
                    item { SectionHeader(n, "Ваши плейлисты") }
                    item { Shelf(data.playlists, { it.id }) { i, p -> PlaylistCard(p, i) { navigate("playlist/${p.id}") } } }
                }
            }
            val first = section
            items(data.home.sections.size, key = { data.home.sections[it].id }) { i ->
                Block(data.home.sections[i], first + i, app, navigate, player.track?.id, player.isPlaying, ids.artists)
            }
        }
    }
}

/** «Моя волна»: radial accent card, mono kicker, display title, white pill (Personal.tsx WaveCard). */
@Composable
private fun WaveCard(playing: Boolean, onPlay: () -> Unit) {
    val hover = C.accentHover
    val pressed = C.accentPressed
    Box(
        Modifier.padding(horizontal = 16.dp, vertical = 16.dp).fillMaxWidth().heightIn(min = 220.dp).appear(1).clip(RoundedCornerShape(22.dp))
            .drawBehind {
                drawRect(Brush.radialGradient(0f to hover, 0.45f to pressed, 1f to Color(0xFF120E24), center = Offset.Zero, radius = size.width * 1.4f))
            },
    ) {
        WaveLine(Modifier.align(Alignment.BottomCenter).padding(bottom = 28.dp), amplitude = 10.dp, energy = if (playing) 0.8f else 0f)
        Column(Modifier.padding(24.dp)) {
            MonoLabel("Персональный поток", color = Color.White.copy(alpha = 0.75f))
            Spacer(Modifier.height(4.dp))
            Text("Моя волна", style = T.DisplayL, color = Color.White)
            Spacer(Modifier.height(8.dp))
            Text("Бесконечная музыка под ваш вкус: любимое, похожее и новое, без повторов.", style = T.Body, color = Color.White.copy(alpha = 0.8f))
            Spacer(Modifier.height(16.dp))
            WhitePillButton(if (playing) "Пауза" else "Слушать", if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, onPlay)
        }
    }
}

@UnstableApi
@Composable
private fun ContinueListening(tracks: List<Track>, currentId: String?, playing: Boolean, app: AppViewModel) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        MonoLabel("Продолжить слушать", Modifier.padding(start = 4.dp, bottom = 2.dp))
        tracks.forEachIndexed { i, t ->
            val current = t.id == currentId
            Row(
                Modifier.fillMaxWidth().appear(i + 2).clip(RoundedCornerShape(14.dp)).background(C.fg.copy(alpha = 0.05f))
                    .pressable({ if (current) app.player.toggle() else app.player.play(tracks, i, PlayContext("tracks", null, "Недавнее")) }, scaleTo = 0.98f),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box {
                    Cover(t.release.artwork, 56.dp, shape = RoundedCornerShape(0.dp), seed = t.release.id)
                    if (current) Box(Modifier.size(56.dp).background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) { EqBars(playing, Color.White) }
                }
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(t.fullTitle, style = T.CaptionBold.copy(fontSize = 15.sp), color = if (current) C.accent else C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(t.artistLine, style = T.Caption, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@UnstableApi
@Composable
private fun Block(block: HomeBlock, index: Int, app: AppViewModel, navigate: (String) -> Unit, currentId: String?, playing: Boolean, followed: List<String>) {
    Column(Modifier.padding(top = 20.dp)) {
        when (block.type) {
            "hero" -> block.hero?.let { hero ->
                Box(
                    Modifier.padding(horizontal = 16.dp).fillMaxWidth().height(200.dp).appear().clip(RoundedCornerShape(22.dp))
                        .pressable({ hero.link?.let { navigate(it.trimStart('/')) } }, scaleTo = 0.98f, enabled = hero.link != null),
                ) {
                    Cover(hero.artwork, 400.dp, modifier = Modifier.fillMaxWidth().height(200.dp), shape = RoundedCornerShape(0.dp), seed = block.id)
                    Box(Modifier.fillMaxWidth().height(200.dp).background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.75f)))))
                    Column(Modifier.align(Alignment.BottomStart).padding(18.dp)) {
                        Text(block.title, style = T.Title1, color = Color.White, maxLines = 2)
                        block.subtitle?.let { Text(it, style = T.Body, color = Color.White.copy(alpha = 0.85f), maxLines = 2) }
                        hero.ctaLabel?.let {
                            Spacer(Modifier.height(10.dp))
                            Box(Modifier.clip(CircleShape).background(Color.White).padding(horizontal = 16.dp, vertical = 8.dp)) { Text(it, style = T.CaptionBold, color = Color(0xFF1B1238)) }
                        }
                    }
                }
            }
            "tracks" -> {
                SectionHeader(index, block.title, block.subtitle)
                val ctx = PlayContext("home", null, block.title)
                TrackListBox {
                    block.tracks.take(8).forEachIndexed { i, t ->
                        TrackRow(t, t.id == currentId, playing, app.actions(navigate, ctx), onPlay = { app.player.play(block.tracks, i, ctx) }, showCover = true)
                    }
                }
            }
            "releases" -> {
                SectionHeader(index, block.title, block.subtitle)
                if (block.style == "stories") {
                    Shelf(block.releases, { it.id }) { i, r -> StoryCircle(r.artwork, r.title, r.id, i, r.id == currentId) { navigate("album/${r.id}") } }
                } else {
                    Shelf(block.releases, { it.id }) { i, r -> ReleaseCard(r, i) { navigate("album/${r.id}") } }
                }
            }
            "playlists" -> {
                SectionHeader(index, block.title, block.subtitle)
                Shelf(block.playlists, { it.id }) { i, p -> PlaylistCard(p, i) { navigate("playlist/${p.id}") } }
            }
            "artists" -> {
                SectionHeader(index, block.title, block.subtitle)
                Shelf(block.artists, { it.id }) { i, a -> ArtistCard(a, a.id in followed, { app.toggle("artists", a.id) }, index = i) { navigate("artist/${a.id}") } }
            }
            "genres" -> {
                SectionHeader(index, block.title, block.subtitle)
                Shelf(block.genres, { it.id }) { i, g -> GenreTile(g, i) { navigate("genre/${g.slug}") } }
            }
        }
    }
}

/** Round release with a resonance ring (Blocks.tsx StoryCircle). */
@Composable
private fun StoryCircle(artwork: com.sonora.app.data.net.Artwork?, title: String, seed: String, index: Int, live: Boolean, onClick: () -> Unit) {
    val a = com.sonora.app.ui.design.WaveA
    val b = com.sonora.app.ui.design.WaveB
    Column(Modifier.width(112.dp).appear(index).pressable(onClick, scaleTo = 0.94f, label = title), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(112.dp).drawBehind {
                drawCircle(Brush.sweepGradient(listOf(a, b, a)), radius = size.minDimension / 2, style = androidx.compose.ui.graphics.drawscope.Stroke(if (live) 3.dp.toPx() else 2.dp.toPx()))
            },
            contentAlignment = Alignment.Center,
        ) { Cover(artwork, 96.dp, shape = CircleShape, seed = seed, description = title) }
        Spacer(Modifier.height(6.dp))
        Text(title, style = T.CaptionBold, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
