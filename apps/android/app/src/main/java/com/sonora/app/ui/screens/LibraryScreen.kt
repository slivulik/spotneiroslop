package com.sonora.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.History
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.net.ArtistSummary
import com.sonora.app.data.net.Artwork
import com.sonora.app.data.net.HistoryEntry
import com.sonora.app.data.net.PlaylistSummary
import com.sonora.app.data.net.ReleaseSummary
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.net.Track
import com.sonora.app.data.repo.Loaded
import com.sonora.app.data.repo.OfflineCache
import com.sonora.app.playback.PlayContext
import com.sonora.app.ui.LocalActions
import com.sonora.app.ui.LocalBottomInset
import com.sonora.app.ui.LocalEnv
import com.sonora.app.ui.components.Cover
import com.sonora.app.ui.components.LoadState
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.components.releaseKind
import com.sonora.app.ui.components.tracksWord
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.Chip
import com.sonora.app.ui.design.IconBtn
import com.sonora.app.ui.design.PlayButton
import com.sonora.app.ui.design.PrimaryButton
import com.sonora.app.ui.design.S
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.press
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

@UnstableApi
@Composable
fun LibraryScreen(app: AppViewModel, vm: LibraryViewModel = hiltViewModel()) {
    val signedIn by app.auth.signedIn.collectAsStateWithLifecycle()
    if (signedIn == null) return LibrarySignedOut()
    val ids by app.library.ids.collectAsStateWithLifecycle()
    LaunchedEffect(ids) { vm.load() } // likes made elsewhere show up here
    val state by vm.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    LoadState(state, onRetry = { vm.load() }) { data ->
        LibraryContent(data) {
            scope.launch {
                runCatching { app.library.createPlaylist("Новый плейлист", emptyList()) }
                    .onSuccess { vm.load(); app.say("Плейлист создан") }
                    .onFailure { app.say("Не удалось создать плейлист") }
            }
        }
    }
}

@Composable
private fun LibrarySignedOut() {
    val actions = LocalActions.current
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(S.page)) {
        Text("Медиатека", style = T.PageTitle, color = C.text, modifier = Modifier.padding(top = S.m))
        Spacer(Modifier.weight(1f))
        Text("Ваша музыка — в одном месте", style = T.Headline, color = C.text, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(S.s))
        Text("Войдите, и здесь появятся любимые треки, альбомы, артисты и плейлисты — те же, что на сайте.", style = T.Body, color = C.text2, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(S.xl))
        PrimaryButton("Войти", { actions.navigate("login") })
        Spacer(Modifier.weight(1.3f))
    }
}

private val FILTERS = listOf("all" to "Всё", "playlists" to "Плейлисты", "albums" to "Альбомы", "artists" to "Артисты")

@Composable
fun LibraryContent(data: LibraryData, onNewPlaylist: () -> Unit) {
    val env = LocalEnv.current
    val actions = LocalActions.current
    var filter by rememberSaveable { mutableStateOf("all") }
    var showLiked by rememberSaveable { mutableStateOf(false) }
    var showHistory by rememberSaveable { mutableStateOf(false) }
    if (showLiked) return TrackPage("Любимые треки", data.tracks, "Нажмите ♥ у трека — он появится здесь.") { showLiked = false }
    if (showHistory) return TrackPage("История", data.history.map { it.track }, "Здесь появятся треки, которые вы слушали.") { showHistory = false }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalBottomInset.current + S.l)) {
        item {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = S.page, end = S.xs, top = S.m), verticalAlignment = Alignment.CenterVertically) {
                Avatar(env.userName ?: env.email, env.signedIn) { actions.navigate("settings") }
                Spacer(Modifier.width(S.m))
                Text("Медиатека", style = T.PageTitle, color = C.text, modifier = Modifier.weight(1f))
                Box(Modifier.size(48.dp).press(onNewPlaylist, scale = true, label = "Новый плейлист"), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Add, contentDescription = "Новый плейлист", tint = C.text, modifier = Modifier.size(28.dp))
                }
            }
        }
        item {
            LazyRow(contentPadding = PaddingValues(horizontal = S.page, vertical = S.m), horizontalArrangement = Arrangement.spacedBy(S.s)) {
                items(FILTERS.size) { i -> Chip(FILTERS[i].second, filter == FILTERS[i].first, { filter = if (filter == FILTERS[i].first) "all" else FILTERS[i].first }) }
            }
        }
        if (filter == "all" || filter == "playlists") {
            item {
                LibraryRow(null, "Любимые треки", "Плейлист · ${tracksWord(data.tracks.size)}", "liked", special = Icons.Filled.Favorite) { showLiked = true }
            }
            item { LibraryRow(null, "История", "Недавно прослушанное", "history", special = Icons.Filled.History, specialColor = C.surfaceHigh) { showHistory = true } }
            items(data.playlists.size) { i ->
                val p = data.playlists[i]
                LibraryRow(p.artwork ?: p.mosaic.firstOrNull(), p.title, "Плейлист · ${p.ownerName ?: "Вы"}", p.id) { actions.navigate("playlist/${p.id}") }
            }
        }
        if (filter == "all" || filter == "albums") {
            items(data.releases.size) { i ->
                val r = data.releases[i]
                LibraryRow(r.artwork, r.title, "${releaseKind(r.type)} · ${r.artists.firstOrNull()?.name ?: ""}", r.id) { actions.navigate("album/${r.id}") }
            }
        }
        if (filter == "all" || filter == "artists") {
            items(data.artists.size) { i ->
                val a = data.artists[i]
                LibraryRow(a.artwork, a.name, "Артист", a.id, shape = CircleShape) { actions.navigate("artist/${a.id}") }
            }
        }
    }
}

/** 64-dp library row: square (or round) artwork, title, kind · owner. */
@Composable
private fun LibraryRow(
    artwork: Artwork?,
    title: String,
    subtitle: String,
    seed: String,
    shape: Shape = RoundedCornerShape(6.dp),
    special: ImageVector? = null,
    specialColor: Color? = null,
    onClick: () -> Unit,
) {
    val accent = C.accent
    Row(Modifier.fillMaxWidth().height(72.dp).press(onClick, label = title).padding(horizontal = S.page), verticalAlignment = Alignment.CenterVertically) {
        if (special != null) {
            Box(
                Modifier.size(56.dp).clip(RoundedCornerShape(6.dp)).drawBehind {
                    if (specialColor != null) drawRect(specialColor)
                    else drawRect(Brush.linearGradient(listOf(accent, Color(0xFFB9A8FF)), Offset.Zero, Offset(size.width, size.height)))
                },
                contentAlignment = Alignment.Center,
            ) { Icon(special, null, tint = Color.White, modifier = Modifier.size(24.dp)) }
        } else {
            Cover(artwork, 56.dp, shape = shape, seed = seed, description = title)
        }
        Spacer(Modifier.width(S.m))
        Column(Modifier.weight(1f)) {
            Text(title, style = T.BodyMedium, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Text(subtitle, style = T.Caption, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Liked tracks / history as their own page. */
@Composable
private fun TrackPage(title: String, tracks: List<Track>, empty: String, onBack: () -> Unit) {
    val env = LocalEnv.current
    val actions = LocalActions.current
    val ctx = PlayContext("tracks", null, title)
    androidx.activity.compose.BackHandler(onBack = onBack)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalBottomInset.current + S.l)) {
        item {
            Row(Modifier.fillMaxWidth().statusBarsPadding().height(56.dp).padding(horizontal = S.xs), verticalAlignment = Alignment.CenterVertically) {
                IconBtn(Icons.AutoMirrored.Filled.ArrowBack, "Назад", onBack, tint = C.text)
            }
        }
        item {
            Row(Modifier.fillMaxWidth().padding(start = S.page, end = S.page, bottom = S.l), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(title, style = T.Headline, color = C.text)
                    Text(tracksWord(tracks.size), style = T.Caption, color = C.text2)
                }
                if (tracks.isNotEmpty()) {
                    val here = env.currentContext?.title == title
                    PlayButton(here && env.playing, { if (here) actions.togglePlay() else actions.play(tracks, 0, ctx) })
                }
            }
        }
        if (tracks.isEmpty()) item { Text(empty, style = T.Body, color = C.text2, modifier = Modifier.padding(S.page)) }
        items(tracks.size) { i -> TrackRow(tracks[i], tracks, i, ctx) }
    }
}
