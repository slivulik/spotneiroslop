package com.sonora.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.net.ArtistSummary
import com.sonora.app.data.net.HistoryEntry
import com.sonora.app.data.net.PlaylistSummary
import com.sonora.app.data.net.ReleaseSummary
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.net.Track
import com.sonora.app.data.repo.Loaded
import com.sonora.app.data.repo.OfflineCache
import com.sonora.app.playback.PlayContext
import com.sonora.app.ui.components.CardTile
import com.sonora.app.ui.components.LoadState
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.theme.Sonora
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.serialization.Serializable
import javax.inject.Inject

@Serializable
data class LibraryData(
    val playlists: List<PlaylistSummary>,
    val tracks: List<Track>,
    val releases: List<ReleaseSummary>,
    val artists: List<ArtistSummary>,
    val history: List<HistoryEntry>,
)

@HiltViewModel
class LibraryViewModel @Inject constructor(private val api: SonoraApi, override val cache: OfflineCache) : LoadingViewModel<LibraryData>() {
    override suspend fun fetch(): Loaded<LibraryData> = cache.load("library") {
        LibraryData(api.myPlaylists(), api.likedTracks().items, api.likedReleases(), api.followedArtists(), api.history(100).items)
    }
}

private val TABS = listOf("Плейлисты", "Любимые треки", "Альбомы", "Артисты", "История")

@UnstableApi
@Composable
fun LibraryScreen(app: AppViewModel, navigate: (String) -> Unit, vm: LibraryViewModel = hiltViewModel()) {
    val signedIn by app.auth.signedIn.collectAsStateWithLifecycle()
    if (signedIn == null) {
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Войдите, чтобы собрать свою медиатеку", style = MaterialTheme.typography.titleLarge)
            Text("Любимые треки, альбомы, артисты и плейлисты — те же, что в веб-версии.", color = Sonora.colors.textSecondary, modifier = Modifier.padding(vertical = 12.dp))
            Button(onClick = { navigate("login") }) { Text("Войти") }
        }
        return
    }
    val ids by app.library.ids.collectAsStateWithLifecycle()
    LaunchedEffect(ids) { vm.load() } // likes made elsewhere show up here
    val state by vm.state.collectAsStateWithLifecycle()
    val player by app.player.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        Text("Медиатека", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(16.dp))
        ScrollableTabRow(selectedTabIndex = tab, edgePadding = 16.dp) {
            TABS.forEachIndexed { i, label -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) }) }
        }
        LoadState(state, onRetry = { vm.load() }) { data ->
            when (tab) {
                0 -> Grid(data.playlists, { it.id }, "Своих плейлистов пока нет — добавьте трек в новый плейлист из меню «…»") { p ->
                    CardTile(p.artwork ?: p.mosaic.firstOrNull(), p.title, "${p.trackCount} треков", width = 160.dp) { navigate("playlist/${p.id}") }
                }
                1 -> TrackTab(data.tracks, "Любимые треки", "Нажмите на сердечко рядом с треком — он появится здесь.", app, navigate, player.track?.id)
                2 -> Grid(data.releases, { it.id }, "Нет сохранённых альбомов") { r ->
                    CardTile(r.artwork, r.title, r.artists.joinToString(", ") { it.name }, width = 160.dp) { navigate("album/${r.id}") }
                }
                3 -> Grid(data.artists, { it.id }, "Вы ни на кого не подписаны") { a ->
                    CardTile(a.artwork, a.name, "Артист", round = true, width = 160.dp) { navigate("artist/${a.id}") }
                }
                else -> TrackTab(data.history.map { it.track }, "История", "Здесь появятся треки, которые вы слушали.", app, navigate, player.track?.id)
            }
        }
    }
}

@Composable
private fun <T> Grid(items: List<T>, key: (T) -> String, empty: String, content: @Composable (T) -> Unit) {
    if (items.isEmpty()) return Text(empty, color = Sonora.colors.textSecondary, modifier = Modifier.padding(24.dp))
    LazyVerticalGrid(GridCells.Adaptive(150.dp), contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        items(items, key = key) { content(it) }
    }
}

@UnstableApi
@Composable
private fun TrackTab(tracks: List<Track>, title: String, empty: String, app: AppViewModel, navigate: (String) -> Unit, currentId: String?) {
    if (tracks.isEmpty()) return Text(empty, color = Sonora.colors.textSecondary, modifier = Modifier.padding(24.dp))
    val ctx = PlayContext("tracks", null, title)
    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Column(Modifier.padding(16.dp)) {
                TextButton(onClick = { app.player.play(tracks, (tracks.indices).random(), ctx, shuffle = true) }) { Text("Перемешать все (${tracks.size})") }
            }
        }
        items(tracks.size) { i ->
            val t = tracks[i]
            TrackRow(t, t.id == currentId, app.actions(navigate, ctx), onPlay = { app.player.play(tracks, i, ctx) })
        }
    }
}
