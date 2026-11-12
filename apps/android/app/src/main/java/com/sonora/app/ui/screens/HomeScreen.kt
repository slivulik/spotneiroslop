package com.sonora.app.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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
import com.sonora.app.data.net.SessionStore
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.net.Track
import com.sonora.app.data.repo.OfflineCache
import com.sonora.app.data.repo.userMessage
import com.sonora.app.playback.PlayContext
import com.sonora.app.ui.LocalActions
import com.sonora.app.ui.LocalBottomInset
import com.sonora.app.ui.LocalEnv
import com.sonora.app.ui.components.ArtistCircle
import com.sonora.app.ui.components.Cover
import com.sonora.app.ui.components.GenreTile
import com.sonora.app.ui.components.LoadState
import com.sonora.app.ui.components.MediaCard
import com.sonora.app.ui.components.PlaylistCard
import com.sonora.app.ui.components.ReleaseCard
import com.sonora.app.ui.components.Shelf
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.components.UiState
import com.sonora.app.ui.components.tracksWord
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.EqBars
import com.sonora.app.ui.design.S
import com.sonora.app.ui.design.SectionTitle
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.press
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.LocalTime
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

fun greeting(hour: Int = LocalTime.now().hour): String = when {
    hour < 5 -> "Доброй ночи"
    hour < 12 -> "Доброе утро"
    hour < 18 -> "Добрый день"
    else -> "Добрый вечер"
}

@UnstableApi
@Composable
fun HomeScreen(app: AppViewModel, vm: HomeViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val signedIn by app.auth.signedIn.collectAsStateWithLifecycle()
    val player by app.player.state.collectAsStateWithLifecycle()
    val waveSettings by app.waves.settings.collectAsStateWithLifecycle()
    val waving = player.context?.type == "wave"
    val hero = remember(player.track, waving, player.isPlaying, waveSettings) { WaveHeroUi(player.track, waving, waving && player.isPlaying, waveSettings) }
    LaunchedEffect(signedIn) { vm.load() }
    LoadState(state, onRetry = { vm.load() }) { HomeContent(it, hero = hero) }
}

@Composable
fun HomeContent(data: HomeData, hour: Int = LocalTime.now().hour, hero: WaveHeroUi = WaveHeroUi()) {
    val env = LocalEnv.current
    val actions = LocalActions.current
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalBottomInset.current + S.l)) {
        // «Моя волна» needs an account; signed out, the page starts with the greeting.
        if (env.signedIn) item(key = "home:wave") { WaveHero(hero) { Greeting(hour) } }
        else item(key = "home:greeting") { Greeting(hour, Modifier.statusBarsPadding()) }
        if (env.signedIn && data.recent.isNotEmpty()) item { RecentGrid(data.recent.take(6)) }
        if (data.mixes.isNotEmpty()) {
            item { SectionTitle("Миксы для вас") }
            item { Shelf(data.mixes, { it.key }) { m -> MediaCard(m.mosaic.firstOrNull(), m.title, m.subtitle ?: tracksWord(m.trackCount), m.key) { actions.navigate("mix/${m.key}") } } }
        }
        if (data.artists.isNotEmpty()) {
            item { SectionTitle("Ваши артисты") }
            item { Shelf(data.artists, { it.id }) { ArtistCircle(it) } }
        }
        if (data.playlists.isNotEmpty()) {
            item { SectionTitle("Ваши плейлисты") }
            item { Shelf(data.playlists, { it.id }) { PlaylistCard(it) } }
        }
        data.home.sections.forEach { block -> item(key = block.id) { Block(block) } }
    }
}

@Composable
private fun Greeting(hour: Int, modifier: Modifier = Modifier) {
    val env = LocalEnv.current
    val actions = LocalActions.current
    Row(modifier.fillMaxWidth().padding(start = S.page, end = S.page, top = S.m, bottom = S.s), verticalAlignment = Alignment.CenterVertically) {
        Text(greeting(hour), style = T.PageTitle, color = C.text, modifier = Modifier.weight(1f))
        Avatar(env.userName ?: env.email, env.signedIn) { actions.navigate(if (env.signedIn) "settings" else "login") }
    }
}

@Composable
fun Avatar(name: String?, signedIn: Boolean, onClick: () -> Unit) {
    if (signedIn) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(C.accent).press(onClick, scale = true, label = "Профиль и настройки"), contentAlignment = Alignment.Center) {
            Text((name ?: "S").take(1).uppercase(), style = T.Title, color = C.onAccent)
        }
    } else {
        Box(Modifier.height(36.dp).clip(CircleShape).background(C.surfaceHigh).press(onClick).padding(horizontal = S.l), contentAlignment = Alignment.Center) {
            Text("Войти", style = T.LabelBold, color = C.text)
        }
    }
}

/** 2 × 3 grid of recent tracks (Spotify's top grid). */
@Composable
private fun RecentGrid(tracks: List<Track>) {
    val env = LocalEnv.current
    val actions = LocalActions.current
    val ctx = PlayContext("tracks", null, "Недавнее")
    Column(Modifier.padding(horizontal = S.page, vertical = S.s), verticalArrangement = Arrangement.spacedBy(S.s)) {
        tracks.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(S.s)) {
                row.forEach { t ->
                    val i = tracks.indexOf(t)
                    val current = t.id == env.currentId
                    Row(
                        Modifier.weight(1f).height(56.dp).clip(RoundedCornerShape(6.dp)).background(C.surfaceHigh)
                            .press({ if (current) actions.togglePlay() else actions.play(tracks, i, ctx) }, label = t.fullTitle),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Cover(t.release.artwork, 56.dp, shape = RoundedCornerShape(topStart = 6.dp, bottomStart = 6.dp), seed = t.release.id)
                        Text(
                            t.fullTitle, style = T.LabelBold, color = if (current) C.accent else C.text, maxLines = 2, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f).padding(horizontal = S.s),
                        )
                        if (current) EqBars(env.playing, modifier = Modifier.padding(end = S.s))
                    }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun Block(block: HomeBlock) {
    val actions = LocalActions.current
    when (block.type) {
        "hero" -> block.hero?.let { hero ->
            Box(
                Modifier.padding(horizontal = S.page, vertical = S.m).fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp))
                    .press({ hero.link?.let { actions.navigate(it.trimStart('/')) } }, enabled = hero.link != null, label = block.title),
            ) {
                Cover(hero.artwork, 400.dp, modifier = Modifier.fillMaxSize(), shape = RoundedCornerShape(0.dp), seed = block.id)
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.4f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.75f))))
                Column(Modifier.align(Alignment.BottomStart).padding(S.l)) {
                    Text(block.title, style = T.Headline.copy(color = Color.White), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    block.subtitle?.let { Text(it, style = T.Caption, color = Color.White.copy(alpha = 0.85f), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
        }
        "tracks" -> Column {
            SectionTitle(block.title)
            val ctx = PlayContext("home", null, block.title)
            block.tracks.take(5).forEachIndexed { i, t -> TrackRow(t, block.tracks, i, ctx) }
        }
        "releases" -> Column {
            SectionTitle(block.title)
            if (block.style == "stories") {
                Shelf(block.releases, { it.id }) { r -> MediaCard(r.artwork, r.title, r.artists.firstOrNull()?.name, r.id, 104.dp, round = true) { actions.navigate("album/${r.id}") } }
            } else {
                Shelf(block.releases, { it.id }) { ReleaseCard(it) }
            }
        }
        "playlists" -> Column {
            SectionTitle(block.title)
            Shelf(block.playlists, { it.id }) { PlaylistCard(it) }
        }
        "artists" -> Column {
            SectionTitle(block.title)
            Shelf(block.artists, { it.id }) { ArtistCircle(it) }
        }
        "genres" -> Column {
            SectionTitle(block.title)
            Shelf(block.genres, { it.id }) { GenreTile(it, Modifier.width(160.dp)) }
        }
    }
}
