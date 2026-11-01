package com.sonora.app.ui.screens

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.net.Artist
import com.sonora.app.data.net.ArtistSummary
import com.sonora.app.data.net.Artwork
import com.sonora.app.data.net.GenreDetail
import com.sonora.app.data.net.Mix
import com.sonora.app.data.net.Playlist
import com.sonora.app.data.net.Release
import com.sonora.app.data.net.ReleaseSummary
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.net.Track
import com.sonora.app.data.repo.Loaded
import com.sonora.app.data.repo.OfflineCache
import com.sonora.app.playback.PlayContext
import com.sonora.app.ui.components.CardTile
import com.sonora.app.ui.components.Cover
import com.sonora.app.ui.components.LikeButton
import com.sonora.app.ui.components.LoadState
import com.sonora.app.ui.components.SectionTitle
import com.sonora.app.ui.components.Shelf
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.components.formatDuration
import com.sonora.app.ui.theme.Sonora
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.serialization.Serializable
import java.text.NumberFormat
import java.util.Locale
import javax.inject.Inject

@HiltViewModel
class AlbumViewModel @Inject constructor(handle: SavedStateHandle, private val api: SonoraApi, override val cache: OfflineCache) : LoadingViewModel<Release>() {
    private val id: String = checkNotNull(handle["id"])
    override suspend fun fetch() = cache.load("release:$id") { api.release(id) }
    init { load() }
}

@Serializable
data class ArtistPage(val artist: Artist, val top: List<Track>, val releases: List<ReleaseSummary>, val similar: List<ArtistSummary>)

@HiltViewModel
class ArtistViewModel @Inject constructor(handle: SavedStateHandle, private val api: SonoraApi, override val cache: OfflineCache) : LoadingViewModel<ArtistPage>() {
    private val id: String = checkNotNull(handle["id"])
    override suspend fun fetch(): Loaded<ArtistPage> = cache.load("artist:$id") {
        ArtistPage(api.artist(id), api.artistTopTracks(id).items, api.artistReleases(id).items, runCatching { api.similarArtists(id) }.getOrDefault(emptyList()))
    }
    init { load() }
}

@HiltViewModel
class PlaylistViewModel @Inject constructor(handle: SavedStateHandle, private val api: SonoraApi, override val cache: OfflineCache) : LoadingViewModel<Playlist>() {
    private val id: String = checkNotNull(handle["id"])
    override suspend fun fetch() = cache.load("playlist:$id") { api.playlist(id) }
    init { load() }
}

@HiltViewModel
class MixViewModel @Inject constructor(handle: SavedStateHandle, private val api: SonoraApi, override val cache: OfflineCache) : LoadingViewModel<Mix>() {
    private val key: String = checkNotNull(handle["key"])
    override suspend fun fetch() = cache.load("mix:$key") { api.mix(key) }
    init { load() }
}

@HiltViewModel
class GenreViewModel @Inject constructor(handle: SavedStateHandle, private val api: SonoraApi, override val cache: OfflineCache) : LoadingViewModel<GenreDetail>() {
    private val slug: String = checkNotNull(handle["slug"])
    override suspend fun fetch() = cache.load("genre:$slug") { api.genre(slug) }
    init { load() }
}

private val numbers = NumberFormat.getIntegerInstance(Locale("ru"))

/** Header + tracks list shared by album, playlist, mix and genre pages. */
@UnstableApi
@Composable
private fun Collection(
    app: AppViewModel,
    navigate: (String) -> Unit,
    artwork: Artwork?,
    kicker: String,
    title: String,
    subtitle: String,
    tracks: List<Track>,
    ctx: PlayContext,
    numbered: Boolean,
    like: Pair<String, String>?,
    sharePath: String?,
    footer: (@Composable () -> Unit)? = null,
) {
    val player by app.player.state.collectAsStateWithLifecycle()
    val ids by app.library.ids.collectAsStateWithLifecycle()
    val isThis = player.context?.type == ctx.type && player.context?.id == ctx.id
    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Cover(artwork, 240.dp, description = title)
                Spacer(Modifier.height(16.dp))
                Text(kicker, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text(title, style = MaterialTheme.typography.headlineSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Sonora.colors.textSecondary)
                Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (like != null) LikeButton(like.first.let { kind -> if (kind == "releases") like.second in ids.releases else like.second in ids.playlists }, { app.toggle(like.first, like.second) })
                    FilledIconButton(onClick = { if (isThis) app.player.toggle() else app.player.play(tracks, 0, ctx) }, enabled = tracks.any { it.playable }, modifier = Modifier.size(60.dp), shape = CircleShape) {
                        Icon(if (isThis && player.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (isThis && player.isPlaying) "Пауза" else "Слушать")
                    }
                    IconButton(onClick = { app.player.play(tracks, tracks.indices.random(), ctx, shuffle = true) }, enabled = tracks.isNotEmpty()) { Icon(Icons.Filled.Shuffle, contentDescription = "Перемешать") }
                    if (sharePath != null) IconButton(onClick = { app.share(sharePath, title) }) { Icon(Icons.Filled.Share, contentDescription = "Поделиться") }
                }
            }
        }
        items(tracks.size) { i ->
            val t = tracks[i]
            TrackRow(t, t.id == player.track?.id, app.actions(navigate, ctx), onPlay = { app.player.play(tracks, i, ctx) }, index = if (numbered) t.trackNumber else null, showCover = !numbered)
        }
        if (footer != null) item { footer() }
    }
}

@UnstableApi
@Composable
fun AlbumScreen(app: AppViewModel, navigate: (String) -> Unit, vm: AlbumViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LoadState(state, onRetry = { vm.load() }) { r ->
        val kind = mapOf("album" to "Альбом", "single" to "Сингл", "ep" to "EP", "compilation" to "Сборник")[r.type] ?: "Альбом"
        Collection(
            app, navigate, r.artwork, kind, r.title,
            listOfNotNull(r.artists.joinToString(", ") { it.name }, r.releaseDate?.take(4)).joinToString(" · "),
            r.tracks, PlayContext("release", r.id, r.title), numbered = true, like = "releases" to r.id, sharePath = "/album/${r.id}",
        ) {
            Column(Modifier.padding(16.dp)) {
                Text("${r.trackCount} треков · ${formatDuration(r.totalDurationMs)}", color = Sonora.colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                r.label?.let { Text("℗ $it", color = Sonora.colors.textTertiary, style = MaterialTheme.typography.bodySmall) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                    r.artists.take(2).forEach { a -> OutlinedButton(onClick = { navigate("artist/${a.id}") }) { Text(a.name, maxLines = 1) } }
                }
            }
        }
    }
}

@UnstableApi
@Composable
fun PlaylistScreen(app: AppViewModel, navigate: (String) -> Unit, vm: PlaylistViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LoadState(state, onRetry = { vm.load() }) { p ->
        Collection(
            app, navigate, p.artwork ?: p.mosaic.firstOrNull(), "Плейлист", p.title,
            listOfNotNull(p.ownerName ?: "Sonora", "${p.trackCount} треков", formatDuration(p.totalDurationMs)).joinToString(" · "),
            p.tracks, PlayContext("playlist", p.id, p.title), numbered = false,
            like = if (p.ownerId == null) "playlists" to p.id else null, sharePath = "/playlist/${p.id}",
        )
    }
}

@UnstableApi
@Composable
fun MixScreen(app: AppViewModel, navigate: (String) -> Unit, vm: MixViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LoadState(state, onRetry = { vm.load() }) { m ->
        Collection(app, navigate, m.tracks.firstOrNull()?.release?.artwork, "Микс дня", m.title, m.subtitle ?: "", m.tracks, PlayContext("mix", m.key, m.title), numbered = false, like = null, sharePath = null)
    }
}

@UnstableApi
@Composable
fun GenreScreen(app: AppViewModel, navigate: (String) -> Unit, vm: GenreViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LoadState(state, onRetry = { vm.load() }) { g ->
        Collection(
            app, navigate, g.genre.artwork ?: g.releases.firstOrNull()?.artwork, "Жанр", g.genre.name, g.description ?: "",
            g.tracks, PlayContext("genre", g.genre.id, g.genre.name), numbered = false, like = null, sharePath = "/genre/${g.genre.slug}",
        ) {
            if (g.releases.isNotEmpty()) {
                SectionTitle("Релизы")
                Shelf(g.releases, { it.id }) { r -> CardTile(r.artwork, r.title, r.artists.joinToString(", ") { it.name }) { navigate("album/${r.id}") } }
            }
        }
    }
}

@UnstableApi
@Composable
fun ArtistScreen(app: AppViewModel, navigate: (String) -> Unit, vm: ArtistViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val ids by app.library.ids.collectAsStateWithLifecycle()
    val player by app.player.state.collectAsStateWithLifecycle()
    var bioOpen by remember { mutableStateOf(false) }
    LoadState(state, onRetry = { vm.load() }) { page ->
        val a = page.artist
        val ctx = PlayContext("artist", a.id, a.name)
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                Box(Modifier.fillMaxWidth().height(320.dp)) {
                    Cover(a.artwork, 420.dp, modifier = Modifier.fillMaxWidth().height(320.dp), shape = androidx.compose.ui.graphics.RectangleShape, description = a.name)
                    Column(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
                        if (a.verified) Text("✓ Подтверждённый артист", style = MaterialTheme.typography.labelMedium, color = androidx.compose.ui.graphics.Color.White)
                        Text(a.name, style = MaterialTheme.typography.displaySmall, color = androidx.compose.ui.graphics.Color.White)
                        Text("${numbers.format(a.monthlyListeners)} слушателей за месяц", color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.85f))
                    }
                    if (a.photoCredit != null) Text("Фото: Wikimedia Commons", style = MaterialTheme.typography.labelSmall, color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.7f), modifier = Modifier.align(Alignment.TopEnd).padding(12.dp))
                }
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilledIconButton(onClick = { app.player.play(page.top, 0, ctx) }, enabled = page.top.isNotEmpty(), modifier = Modifier.size(56.dp), shape = CircleShape) { Icon(Icons.Filled.PlayArrow, contentDescription = "Слушать") }
                    IconButton(onClick = { app.player.play(page.top, page.top.indices.random(), ctx, shuffle = true) }, enabled = page.top.isNotEmpty()) { Icon(Icons.Filled.Shuffle, contentDescription = "Перемешать") }
                    OutlinedButton(onClick = { app.toggle("artists", a.id) }) { Text(if (a.id in ids.artists) "Вы подписаны" else "Подписаться") }
                    IconButton(onClick = { app.share("/artist/${a.id}", a.name) }) { Icon(Icons.Filled.Share, contentDescription = "Поделиться") }
                }
            }
            if (page.top.isNotEmpty()) {
                item { SectionTitle("Популярные треки") }
                items(page.top.take(10).size) { i ->
                    val t = page.top[i]
                    TrackRow(t, t.id == player.track?.id, app.actions(navigate, ctx), onPlay = { app.player.play(page.top, i, ctx) }, index = i + 1)
                }
            }
            val albums = page.releases.filter { it.type == "album" || it.type == "compilation" }
            val singles = page.releases - albums.toSet()
            if (albums.isNotEmpty()) {
                item { SectionTitle("Альбомы") }
                item { Shelf(albums, { it.id }) { r -> CardTile(r.artwork, r.title, r.releaseDate?.take(4)) { navigate("album/${r.id}") } } }
            }
            if (singles.isNotEmpty()) {
                item { SectionTitle("Синглы и EP") }
                item { Shelf(singles, { it.id }) { r -> CardTile(r.artwork, r.title, r.releaseDate?.take(4)) { navigate("album/${r.id}") } } }
            }
            a.bio?.let { bio ->
                item {
                    Column(Modifier.padding(16.dp)) {
                        Text("Об артисте", style = MaterialTheme.typography.titleLarge)
                        Text(bio, maxLines = if (bioOpen) Int.MAX_VALUE else 6, overflow = TextOverflow.Ellipsis, color = Sonora.colors.textSecondary, modifier = Modifier.padding(top = 8.dp))
                        if (bio.length > 320) androidx.compose.material3.TextButton(onClick = { bioOpen = !bioOpen }) { Text(if (bioOpen) "Свернуть" else "Читать полностью") }
                        if (a.bioSource != null) Text("Источник: Википедия, CC BY-SA", style = MaterialTheme.typography.labelSmall, color = Sonora.colors.textTertiary)
                    }
                }
            }
            if (page.similar.isNotEmpty()) {
                item { SectionTitle("Похожие артисты", "Их слушают те же люди") }
                item { Shelf(page.similar, { it.id }) { s -> CardTile(s.artwork, s.name, "Артист", round = true, width = 120.dp) { navigate("artist/${s.id}") } } }
            }
        }
    }
}
