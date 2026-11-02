package com.sonora.app.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
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
import com.sonora.app.ui.AppTopBar
import com.sonora.app.ui.LocalBottomInset
import com.sonora.app.ui.components.ArtistCard
import com.sonora.app.ui.components.LoadState
import com.sonora.app.ui.components.PlaylistCard
import com.sonora.app.ui.components.ReleaseCard
import com.sonora.app.ui.components.TrackListBox
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.components.formatDuration
import com.sonora.app.ui.design.AccentPlayButton
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.Chip
import com.sonora.app.ui.design.GlassIconButton
import com.sonora.app.ui.design.PrimaryButton
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.appear
import com.sonora.app.ui.design.dashedBorder
import com.sonora.app.ui.design.pressable
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
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

@OptIn(ExperimentalLayoutApi::class)
@UnstableApi
@Composable
fun LibraryScreen(app: AppViewModel, navigate: (String) -> Unit, vm: LibraryViewModel = hiltViewModel()) {
    val signedIn by app.auth.signedIn.collectAsStateWithLifecycle()
    if (signedIn == null) {
        Column(Modifier.fillMaxSize()) {
            AppTopBar(app, navigate)
            Text("Медиатека", style = T.DisplayL, color = C.text, modifier = Modifier.padding(16.dp))
            Column(
                Modifier.padding(16.dp).fillMaxWidth().dashedBorder(C.borderStrong, 20.dp).padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Войдите, чтобы собрать свою медиатеку", style = T.Title3, color = C.text)
                Text("Любимые треки, альбомы, артисты и плейлисты синхронизируются между веб-версией и телефоном.", style = T.Body, color = C.text2, modifier = Modifier.padding(vertical = 12.dp))
                PrimaryButton("Войти", { navigate("login") })
            }
        }
        return
    }
    val ids by app.library.ids.collectAsStateWithLifecycle()
    LaunchedEffect(ids) { vm.load() } // likes made elsewhere show up here
    val state by vm.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(0) }
    LoadState(state, onRetry = { vm.load() }) { data ->
        LazyColumn(contentPadding = PaddingValues(bottom = LocalBottomInset.current + 16.dp)) {
            item { AppTopBar(app, navigate) }
            item { Text("Медиатека", style = T.DisplayL, color = C.text, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).appear()) }
            item {
                FlowRow(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TABS.forEachIndexed { i, label -> Chip(label, tab == i, { tab = i }) }
                }
            }
            item {
                AnimatedContent(tab, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "lib") { t ->
                    Column(Modifier.padding(top = 8.dp)) {
                        when (t) {
                            0 -> PlaylistsGrid(data.playlists, app, navigate)
                            1 -> Tracks(data.tracks, "Любимые треки", "Пока пусто", "Нажмите на сердечко рядом с треком — он появится здесь.", app, navigate, likedHeader = true)
                            2 -> Grid(data.releases, "Нет сохранённых альбомов", "Откройте альбом или сингл и нажмите на сердечко в шапке.") { i, r, w -> ReleaseCard(r, i, w) { navigate("album/${r.id}") } }
                            3 -> Grid(data.artists, "Вы ни на кого не подписаны", "Подпишитесь на артиста на его странице — новые релизы окажутся под рукой.") { i, a, w ->
                                ArtistCard(a, a.id in ids.artists, { app.toggle("artists", a.id) }, w, i) { navigate("artist/${a.id}") }
                            }
                            else -> Tracks(data.history.map { it.track }, "История", "История пуста", "Здесь появятся треки, которые вы слушали.", app, navigate)
                        }
                    }
                }
            }
        }
    }
}

/** Two-column grid like the web library at phone width. */
@Composable
private fun <T> Grid(items: List<T>, emptyTitle: String, emptyText: String, lead: (@Composable (Dp) -> Unit)? = null, card: @Composable (Int, T, Dp) -> Unit) {
    if (items.isEmpty() && lead == null) return Empty(emptyTitle, emptyText)
    BoxWithConstraints(Modifier.padding(horizontal = 16.dp)) {
        val w = (maxWidth - 12.dp) / 2
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val cells: List<(@Composable () -> Unit)> = buildList {
                if (lead != null) add { lead(w) }
                items.forEachIndexed { i, it -> add { card(i, it, w) } }
            }
            cells.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { it() }
                }
            }
        }
    }
}

@UnstableApi
@Composable
private fun PlaylistsGrid(playlists: List<PlaylistSummary>, app: AppViewModel, navigate: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    Grid(playlists, "", "", lead = { w ->
        // «Новый плейлист»: dashed tile with a round accent plus (library/page.tsx).
        Column(
            Modifier.size(w, w * 1.28f).dashedBorder(C.borderStrong, 18.dp).pressable({
                scope.launch {
                    runCatching { app.library.createPlaylist("Новый плейлист", emptyList()) }
                        .onSuccess { navigate("playlist/${it.id}") }
                        .onFailure { app.say("Не удалось создать плейлист") }
                }
            }, scaleTo = 0.97f, label = "Новый плейлист"),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(Modifier.size(48.dp).clip(CircleShape).background(C.accentMuted), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Add, null, tint = C.accent) }
            Spacer(Modifier.height(12.dp))
            Text("Новый плейлист", style = T.BodyBold, color = C.text2)
        }
    }) { i, p, w -> PlaylistCard(p, i, w) { navigate("playlist/${p.id}") } }
}

@UnstableApi
@Composable
private fun Tracks(tracks: List<Track>, title: String, emptyTitle: String, emptyText: String, app: AppViewModel, navigate: (String) -> Unit, likedHeader: Boolean = false) {
    if (tracks.isEmpty()) return Empty(emptyTitle, emptyText)
    val player by app.player.state.collectAsStateWithLifecycle()
    val ctx = PlayContext("tracks", null, title)
    val isThis = player.context?.title == title
    if (likedHeader) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(64.dp).clip(RoundedCornerShape(14.dp)).background(C.accent), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Favorite, null, tint = C.onAccent, modifier = Modifier.size(28.dp)) }
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(title, style = T.Title2, color = C.text)
                Text("${tracks.size} · ${formatDuration(tracks.sumOf { it.durationMs })}", style = T.Caption, color = C.text2)
            }
            AccentPlayButton(isThis && player.isPlaying, { if (isThis) app.player.toggle() else app.player.play(tracks, 0, ctx) }, size = 52.dp)
            Spacer(Modifier.size(8.dp))
            GlassIconButton(Icons.Filled.Shuffle, "Перемешать", { app.player.play(tracks, tracks.indices.random(), ctx, shuffle = true) })
        }
    }
    TrackListBox(Modifier.padding(top = 8.dp)) {
        tracks.forEachIndexed { i, t ->
            TrackRow(t, t.id == player.track?.id, player.isPlaying, app.actions(navigate, ctx), onPlay = { app.player.play(tracks, i, ctx) }, showCover = true)
        }
    }
}

@Composable
private fun Empty(title: String, text: String) {
    Column(Modifier.padding(16.dp).fillMaxWidth().dashedBorder(C.borderStrong, 20.dp).padding(vertical = 48.dp, horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = T.Title3, color = C.text)
        Spacer(Modifier.height(8.dp))
        Text(text, style = T.Body, color = C.text2, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}
