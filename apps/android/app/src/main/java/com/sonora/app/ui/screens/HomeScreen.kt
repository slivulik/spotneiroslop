package com.sonora.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.net.Home
import com.sonora.app.data.net.HomeBlock
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.repo.OfflineCache
import com.sonora.app.data.repo.userMessage
import com.sonora.app.playback.PlayContext
import com.sonora.app.ui.components.CardTile
import com.sonora.app.ui.components.LoadState
import com.sonora.app.ui.components.SectionTitle
import com.sonora.app.ui.components.Shelf
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.components.UiState
import com.sonora.app.ui.components.parseColor
import com.sonora.app.ui.theme.Sonora
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
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

@HiltViewModel
class HomeViewModel @Inject constructor(private val api: SonoraApi, override val cache: OfflineCache) : LoadingViewModel<Home>() {
    override suspend fun fetch() = cache.load("home") { api.home() }
    init { load() }
}

@UnstableApi
@Composable
fun HomeScreen(app: AppViewModel, navigate: (String) -> Unit, vm: HomeViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val player by app.player.state.collectAsStateWithLifecycle()
    val signedIn by app.auth.signedIn.collectAsStateWithLifecycle()
    LaunchedEffect(signedIn) { vm.load() }
    LoadState(state, onRetry = { vm.load() }) { home ->
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(greeting(), style = MaterialTheme.typography.headlineMedium, modifier = Modifier.weight(1f))
                    IconButton(onClick = { navigate("settings") }) { Icon(Icons.Filled.Settings, contentDescription = "Настройки") }
                }
            }
            if (signedIn != null) item { WaveCard(playing = player.context?.type == "wave" && player.isPlaying) { app.player.playWave() } }
            items(home.sections, key = { it.id }) { block -> Block(block, app, navigate, player.track?.id) }
        }
    }
}

private fun greeting(): String = when (LocalTime.now().hour) {
    in 5..11 -> "Доброе утро"
    in 12..16 -> "Добрый день"
    in 17..22 -> "Добрый вечер"
    else -> "Доброй ночи"
}

@Composable
private fun WaveCard(playing: Boolean, onPlay: () -> Unit) {
    val accent = MaterialTheme.colorScheme.primary
    Box(
        Modifier.padding(16.dp).fillMaxWidth().height(132.dp).clip(RoundedCornerShape(18.dp))
            .background(Brush.linearGradient(listOf(accent, accent.copy(alpha = 0.55f), Color(0xFF15131C))))
            .clickable(onClick = onPlay)
            .padding(20.dp),
    ) {
        Column(Modifier.align(Alignment.CenterStart)) {
            Text("Моя волна", style = MaterialTheme.typography.headlineSmall, color = Color.White)
            Text(if (playing) "Играет — подбирается под вас" else "Бесконечный поток под ваш вкус", color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.bodyMedium)
        }
        FilledIconButton(onClick = onPlay, modifier = Modifier.align(Alignment.CenterEnd).size(56.dp), shape = CircleShape) {
            Icon(Icons.Filled.PlayArrow, contentDescription = "Слушать волну")
        }
    }
}

@UnstableApi
@Composable
private fun Block(block: HomeBlock, app: AppViewModel, navigate: (String) -> Unit, currentId: String?) {
    Column(Modifier.padding(vertical = 8.dp)) {
        when (block.type) {
            "hero" -> block.hero?.let { hero ->
                Column(Modifier.padding(horizontal = 16.dp).clip(RoundedCornerShape(18.dp)).clickable(enabled = hero.link != null) { hero.link?.let { navigate(it.trimStart('/')) } }) {
                    com.sonora.app.ui.components.Cover(hero.artwork, 360.dp, modifier = Modifier.fillMaxWidth().height(180.dp), shape = RoundedCornerShape(18.dp))
                    Text(block.title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 8.dp))
                    block.subtitle?.let { Text(it, color = Sonora.colors.textSecondary, style = MaterialTheme.typography.bodySmall) }
                }
            }
            "tracks" -> {
                SectionTitle(block.title, block.subtitle)
                val ctx = PlayContext("home", null, block.title)
                block.tracks.take(8).forEachIndexed { i, t ->
                    TrackRow(t, t.id == currentId, app.actions(navigate, ctx), onPlay = { app.player.play(block.tracks, i, ctx) })
                }
            }
            "releases" -> {
                SectionTitle(block.title, block.subtitle)
                Shelf(block.releases, { it.id }) { r -> CardTile(r.artwork, r.title, r.artists.joinToString(", ") { it.name }) { navigate("album/${r.id}") } }
            }
            "playlists" -> {
                SectionTitle(block.title, block.subtitle)
                Shelf(block.playlists, { it.id }) { p -> CardTile(p.artwork ?: p.mosaic.firstOrNull(), p.title, p.description ?: "${p.trackCount} треков") { navigate("playlist/${p.id}") } }
            }
            "artists" -> {
                SectionTitle(block.title, block.subtitle)
                Shelf(block.artists, { it.id }) { a -> CardTile(a.artwork, a.name, if (a.verified) "Артист ✓" else "Артист", round = true, width = 128.dp) { navigate("artist/${a.id}") } }
            }
            "genres" -> {
                SectionTitle(block.title, block.subtitle)
                Shelf(block.genres, { it.id }) { g ->
                    Box(
                        Modifier.size(150.dp, 84.dp).clip(RoundedCornerShape(12.dp))
                            .background(parseColor(g.color) ?: MaterialTheme.colorScheme.primary)
                            .clickable { navigate("genre/${g.slug}") }.padding(12.dp),
                    ) { Text(g.name, style = MaterialTheme.typography.titleMedium, color = Color.White) }
                }
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}

