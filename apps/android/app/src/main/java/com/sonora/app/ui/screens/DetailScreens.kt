package com.sonora.app.ui.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.net.Artist
import com.sonora.app.data.net.ArtistStats
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
import com.sonora.app.ui.AppTopBar
import com.sonora.app.ui.LocalBottomInset
import com.sonora.app.ui.components.ArtistCard
import com.sonora.app.ui.components.Cover
import com.sonora.app.ui.components.LoadState
import com.sonora.app.ui.components.ReleaseCard
import com.sonora.app.ui.components.Shelf
import com.sonora.app.ui.components.TrackListBox
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.components.formatDuration
import com.sonora.app.ui.components.releaseKind
import com.sonora.app.ui.design.AccentPlayButton
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.GlassIconButton
import com.sonora.app.ui.design.HeartButton
import com.sonora.app.ui.design.MonoLabel
import com.sonora.app.ui.design.QualityBadge
import com.sonora.app.ui.design.SectionHeader
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.appear
import com.sonora.app.ui.design.glass
import com.sonora.app.ui.design.hexColor
import com.sonora.app.ui.design.pressable
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.serialization.Serializable
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject

@HiltViewModel
class AlbumViewModel @Inject constructor(handle: SavedStateHandle, private val api: SonoraApi, override val cache: OfflineCache) : LoadingViewModel<Release>() {
    private val id: String = checkNotNull(handle["id"])
    override suspend fun fetch() = cache.load("release:$id") { api.release(id) }
    init { load() }
}

@Serializable
data class ArtistPage(
    val artist: Artist,
    val top: List<Track>,
    val releases: List<ReleaseSummary>,
    val similar: List<ArtistSummary>,
    val stats: ArtistStats? = null,
)

@HiltViewModel
class ArtistViewModel @Inject constructor(handle: SavedStateHandle, private val api: SonoraApi, override val cache: OfflineCache) : LoadingViewModel<ArtistPage>() {
    private val id: String = checkNotNull(handle["id"])
    override suspend fun fetch(): Loaded<ArtistPage> = cache.load("artist:$id") {
        ArtistPage(
            api.artist(id), api.artistTopTracks(id).items, api.artistReleases(id).items,
            runCatching { api.similarArtists(id) }.getOrDefault(emptyList()),
            runCatching { api.artistStats(id) }.getOrNull(),
        )
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

private val numbers = NumberFormat.getIntegerInstance(Locale.forLanguageTag("ru"))

/** Glass header card: cover, mono kind, display title, meta, badge, actions (CollectionHeader.tsx). */
@UnstableApi
@Composable
private fun CollectionHeader(
    app: AppViewModel,
    artwork: Artwork?,
    seed: String,
    kind: String,
    title: String,
    meta: String,
    tracks: List<Track>,
    ctx: PlayContext,
    like: Pair<String, String>?,
    sharePath: String?,
    onMeta: (() -> Unit)? = null,
) {
    val player by app.player.state.collectAsStateWithLifecycle()
    val ids by app.library.ids.collectAsStateWithLifecycle()
    val isThis = player.context?.type == ctx.type && player.context?.id == ctx.id
    val tint = hexColor(artwork?.palette?.vibrant) ?: hexColor(artwork?.palette?.dominant) ?: C.accent
    // The cover settles in like the web header (scale from 0.92 with a spring).
    val enter = remember { Animatable(0.92f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, spring(dampingRatio = 0.7f, stiffness = 200f)) }
    Column(
        Modifier.padding(horizontal = 16.dp).padding(top = 4.dp).fillMaxWidth().glass(RoundedCornerShape(24.dp))
            .drawBehind { drawRect(Brush.radialGradient(listOf(tint.copy(alpha = 0.35f), Color.Transparent), Offset.Zero, size.width * 1.2f)) }
            .padding(horizontal = 24.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Cover(
            artwork, 270.dp, shape = RoundedCornerShape(18.dp), seed = seed, description = title,
            modifier = Modifier.graphicsLayer { scaleX = enter.value; scaleY = enter.value }.shadow(24.dp, RoundedCornerShape(18.dp), spotColor = tint),
        )
        Spacer(Modifier.height(20.dp))
        MonoLabel(kind, color = C.text2)
        Spacer(Modifier.height(6.dp))
        Text(title, style = T.Title1.copy(fontSize = 32.sp, lineHeight = 36.sp), color = C.text, textAlign = TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.appear())
        Spacer(Modifier.height(6.dp))
        Text(meta, style = T.BodyBold, color = C.text.copy(alpha = 0.85f), textAlign = TextAlign.Center, modifier = if (onMeta != null) Modifier.pressable(onMeta) else Modifier)
        val hires = tracks.any { it.audio.hires }
        val lossless = tracks.any { it.audio.lossless }
        if (hires || lossless) {
            Spacer(Modifier.height(12.dp))
            QualityBadge(hires, lossless)
        }
        Spacer(Modifier.height(20.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            AccentPlayButton(isThis && player.isPlaying, { if (isThis) app.player.toggle() else app.player.play(tracks, 0, ctx) }, size = 64.dp, enabled = tracks.any { it.playable })
            GlassIconButton(Icons.Filled.Shuffle, "Перемешать", { app.player.play(tracks, tracks.indices.random(), ctx, shuffle = true) }, size = 48.dp, enabled = tracks.isNotEmpty())
            if (like != null) {
                val saved = when (like.first) {
                    "releases" -> like.second in ids.releases
                    "artists" -> like.second in ids.artists
                    else -> like.second in ids.playlists
                }
                Box(Modifier.size(48.dp).glass(CircleShape, shadow = false), contentAlignment = Alignment.Center) { HeartButton(saved, { app.toggle(like.first, like.second) }, size = 22.dp, tint = C.text) }
            }
            if (sharePath != null) GlassIconButton(Icons.Filled.IosShare, "Поделиться", { app.share(sharePath, title) }, size = 48.dp)
        }
    }
}

@UnstableApi
@Composable
private fun CollectionPage(
    app: AppViewModel,
    navigate: (String) -> Unit,
    header: @Composable () -> Unit,
    tracks: List<Track>,
    ctx: PlayContext,
    numbered: Boolean,
    footer: (@Composable () -> Unit)? = null,
) {
    val player by app.player.state.collectAsStateWithLifecycle()
    LazyColumn(contentPadding = PaddingValues(bottom = LocalBottomInset.current + 16.dp)) {
        item { AppTopBar(app, navigate) }
        item { header() }
        item { Spacer(Modifier.height(20.dp)) }
        if (tracks.isNotEmpty()) {
            item {
                TrackListBox(Modifier.appear(1)) {
                    tracks.forEachIndexed { i, t ->
                        TrackRow(
                            t, t.id == player.track?.id, player.isPlaying, app.actions(navigate, ctx), onPlay = { app.player.play(tracks, i, ctx) },
                            index = if (numbered) t.trackNumber else null, showCover = !numbered, showAlbum = !numbered,
                        )
                    }
                }
            }
        }
        if (footer != null) item { footer() }
    }
}

@UnstableApi
@Composable
fun AlbumScreen(app: AppViewModel, navigate: (String) -> Unit, vm: AlbumViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LoadState(state, onRetry = { vm.load() }) { r ->
        val ctx = PlayContext("release", r.id, r.title)
        CollectionPage(app, navigate, {
            CollectionHeader(
                app, r.artwork, r.id, releaseKind(r.type), r.title,
                listOfNotNull(r.artists.joinToString(", ") { it.name }, r.releaseDate?.take(4)).joinToString(" · "),
                r.tracks, ctx, "releases" to r.id, "/album/${r.id}",
                onMeta = r.artists.firstOrNull()?.let { a -> { navigate("artist/${a.id}") } },
            )
        }, r.tracks, ctx, numbered = true) {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 16.dp)) {
                val date = r.releaseDate?.let { runCatching { LocalDate.parse(it).format(DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.forLanguageTag("ru"))) }.getOrNull() }
                date?.let { Text(it, style = T.Caption, color = C.text3) }
                Text("${r.trackCount} треков · ${formatDuration(r.totalDurationMs)}", style = T.Caption, color = C.text3)
                r.label?.let { Text("℗ $it", style = T.Caption, color = C.text3) }
                if (r.genres.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        r.genres.take(3).forEach { g ->
                            Box(Modifier.clip(CircleShape).background(C.fg.copy(alpha = 0.06f)).pressable({ navigate("genre/${g.slug}") }).padding(horizontal = 12.dp, vertical = 6.dp)) {
                                Text(g.name, style = T.CaptionBold, color = C.text2)
                            }
                        }
                    }
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
        val ctx = PlayContext("playlist", p.id, p.title)
        CollectionPage(app, navigate, {
            CollectionHeader(
                app, p.artwork ?: p.mosaic.firstOrNull(), p.id, "Плейлист", p.title,
                listOf(p.ownerName ?: "Sonora", "${p.trackCount} треков", formatDuration(p.totalDurationMs)).joinToString(" · "),
                p.tracks, ctx, if (p.ownerId == null) "playlists" to p.id else null, "/playlist/${p.id}",
            )
        }, p.tracks, ctx, numbered = false)
    }
}

@UnstableApi
@Composable
fun MixScreen(app: AppViewModel, navigate: (String) -> Unit, vm: MixViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LoadState(state, onRetry = { vm.load() }) { m ->
        val ctx = PlayContext("mix", m.key, m.title)
        CollectionPage(app, navigate, {
            CollectionHeader(app, m.tracks.firstOrNull()?.release?.artwork, m.key, "Микс дня", m.title, m.subtitle ?: "${m.tracks.size} треков", m.tracks, ctx, null, null)
        }, m.tracks, ctx, numbered = false)
    }
}

@UnstableApi
@Composable
fun GenreScreen(app: AppViewModel, navigate: (String) -> Unit, vm: GenreViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LoadState(state, onRetry = { vm.load() }) { g ->
        val ctx = PlayContext("genre", g.genre.id, g.genre.name)
        CollectionPage(app, navigate, {
            CollectionHeader(app, g.genre.artwork ?: g.releases.firstOrNull()?.artwork, g.genre.slug, "Жанр", g.genre.name, g.description ?: "${g.tracks.size} треков", g.tracks, ctx, null, "/genre/${g.genre.slug}")
        }, g.tracks, ctx, numbered = false) {
            if (g.releases.isNotEmpty()) {
                SectionHeader(0, "Релизы", modifier = Modifier.padding(top = 20.dp))
                Shelf(g.releases, { it.id }) { i, r -> ReleaseCard(r, i) { navigate("album/${r.id}") } }
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
        val isThis = player.context?.type == "artist" && player.context?.id == a.id
        val albums = page.releases.filter { it.type == "album" || it.type == "compilation" }
        val singles = page.releases - albums.toSet()
        val latest = page.releases.maxByOrNull { it.releaseDate ?: "" }
        LazyColumn(contentPadding = PaddingValues(bottom = LocalBottomInset.current + 16.dp)) {
            var section = 0
            item { AppTopBar(app, navigate) }
            item {
                // Hero: the photo is the page, the name set large over a scrim (artist/[id]/page.tsx).
                val tint = hexColor(a.artwork?.palette?.vibrant) ?: C.accent
                Box(Modifier.padding(horizontal = 16.dp).fillMaxWidth().height(380.dp).shadow(16.dp, RoundedCornerShape(24.dp)).clip(RoundedCornerShape(24.dp))) {
                    Box(Modifier.matchParentSizeCompat().drawBehind { drawRect(Brush.radialGradient(listOf(tint, Color(0xFF0B0A10)), Offset(0f, size.height), size.width * 1.4f)) })
                    if (a.artwork != null) Cover(a.artwork, 420.dp, modifier = Modifier.matchParentSizeCompat(), shape = RoundedCornerShape(0.dp), description = a.name)
                    Box(Modifier.matchParentSizeCompat().background(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.05f), 0.5f to Color.Black.copy(alpha = 0.3f), 1f to Color.Black.copy(alpha = 0.85f))))
                    if (a.photoCredit != null) MonoLabel("Фото: Wikimedia Commons", Modifier.align(Alignment.TopEnd).padding(14.dp), color = Color.White.copy(alpha = 0.7f))
                    Column(Modifier.align(Alignment.BottomStart).padding(22.dp)) {
                        MonoLabel(if (a.verified) "✓ Подтверждённый артист" else "Артист", color = Color.White.copy(alpha = 0.8f))
                        Spacer(Modifier.height(6.dp))
                        Text(a.name, style = T.DisplayL, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.appear())
                        Spacer(Modifier.height(6.dp))
                        Text("${numbers.format(page.stats?.monthlyListeners ?: a.monthlyListeners)} слушателей за месяц", style = T.Body, color = Color.White.copy(alpha = 0.85f))
                        Spacer(Modifier.height(16.dp))
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            AccentPlayButton(isThis && player.isPlaying, { if (isThis) app.player.toggle() else app.player.play(page.top, 0, ctx) }, size = 56.dp, enabled = page.top.isNotEmpty())
                            GlassIconButton(Icons.Filled.Shuffle, "Перемешать", { app.player.play(page.top, page.top.indices.random(), ctx, shuffle = true) }, size = 48.dp, tint = Color.White, enabled = page.top.isNotEmpty())
                            Box(Modifier.size(48.dp).glass(CircleShape, shadow = false), contentAlignment = Alignment.Center) { HeartButton(a.id in ids.artists, { app.toggle("artists", a.id) }, tint = Color.White) }
                            GlassIconButton(Icons.Filled.IosShare, "Поделиться", { app.share("/artist/${a.id}", a.name) }, size = 48.dp, tint = Color.White)
                        }
                    }
                }
            }
            if (page.top.isNotEmpty()) {
                val n = section++
                item { SectionHeader(n, "Популярные треки", modifier = Modifier.padding(top = 20.dp)) }
                item {
                    TrackListBox {
                        page.top.take(10).forEachIndexed { i, t ->
                            TrackRow(t, t.id == player.track?.id, player.isPlaying, app.actions(navigate, ctx), onPlay = { app.player.play(page.top, i, ctx) }, index = i + 1)
                        }
                    }
                }
            }
            if (albums.isNotEmpty()) {
                val n = section++
                item { SectionHeader(n, "Альбомы", modifier = Modifier.padding(top = 20.dp)) }
                item { Shelf(albums, { it.id }) { i, r -> ReleaseCard(r, i) { navigate("album/${r.id}") } } }
            }
            if (singles.isNotEmpty()) {
                val n = section++
                item { SectionHeader(n, "Синглы и EP", modifier = Modifier.padding(top = 20.dp)) }
                item { Shelf(singles, { it.id }) { i, r -> ReleaseCard(r, i) { navigate("album/${r.id}") } } }
            }
            if (latest != null) {
                item {
                    Row(
                        Modifier.padding(16.dp).padding(top = 8.dp).fillMaxWidth().glass(RoundedCornerShape(20.dp)).pressable({ navigate("album/${latest.id}") }, scaleTo = 0.98f).padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Cover(latest.artwork, 88.dp, shape = RoundedCornerShape(12.dp), seed = latest.id)
                        Column(Modifier.padding(start = 14.dp)) {
                            MonoLabel("Новый релиз", color = C.accent)
                            Text(latest.title, style = T.Title3, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            latest.releaseDate?.let { d ->
                                Text(runCatching { LocalDate.parse(d).format(DateTimeFormatter.ofPattern("d MMMM yyyy 'г.'", Locale.forLanguageTag("ru"))) }.getOrDefault(d), style = T.Caption, color = C.text2)
                            }
                        }
                    }
                }
            }
            page.stats?.let { stats -> item { StatsCard(stats) } }
            a.bio?.let { bio ->
                item {
                    Column(Modifier.padding(16.dp).fillMaxWidth().glass(RoundedCornerShape(20.dp)).padding(20.dp).animateContentSize()) {
                        Text("Об артисте", style = T.Title3, color = C.text)
                        Spacer(Modifier.height(8.dp))
                        Text(bio, style = T.Body, color = C.text2, maxLines = if (bioOpen) Int.MAX_VALUE else 6, overflow = TextOverflow.Ellipsis)
                        if (bio.length > 320) Text(if (bioOpen) "Свернуть" else "Читать полностью", style = T.CaptionBold, color = C.text, modifier = Modifier.padding(top = 8.dp).pressable({ bioOpen = !bioOpen }))
                        if (a.bioSource != null) Text("Источник: Википедия, CC BY-SA", style = T.Micro, color = C.text3, modifier = Modifier.padding(top = 10.dp))
                    }
                }
            }
            if (page.similar.isNotEmpty()) {
                val n = section++
                item { SectionHeader(n, "Похожие артисты", "Их слушают те же люди", modifier = Modifier.padding(top = 12.dp)) }
                item { Shelf(page.similar, { it.id }) { i, s -> ArtistCard(s, s.id in ids.artists, { app.toggle("artists", s.id) }, index = i) { navigate("artist/${s.id}") } } }
            }
        }
    }
}

/** «Статистика»: four tiles and 12 weeks of plays as bars (artist page). */
@Composable
private fun StatsCard(s: ArtistStats) {
    Column(Modifier.padding(16.dp).fillMaxWidth().glass(RoundedCornerShape(20.dp)).padding(20.dp)) {
        Text("Статистика", style = T.Title3, color = C.text)
        Spacer(Modifier.height(12.dp))
        val tiles = listOf(
            "За 30 дней" to numbers.format(s.plays30d),
            "Всего прослушиваний" to numbers.format(s.totalPlays),
            "Слушателей за месяц" to numbers.format(s.monthlyListeners),
            "Первый релиз" to (s.firstRelease?.take(4) ?: "—"),
        )
        tiles.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                row.forEach { (label, value) ->
                    Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(C.fg.copy(alpha = 0.04f)).padding(12.dp)) {
                        Text(label, style = T.Micro, color = C.text3, maxLines = 1)
                        Text(value, style = T.Title3, color = C.text)
                    }
                }
            }
        }
        if (s.weekly.isNotEmpty()) {
            val max = s.weekly.maxOf { it.plays }.coerceAtLeast(1)
            val accent = C.accent
            val empty = C.fg.copy(alpha = 0.1f)
            Row(Modifier.fillMaxWidth().height(96.dp).padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
                s.weekly.forEachIndexed { i, w ->
                    val grow = remember { Animatable(0f) }
                    LaunchedEffect(Unit) {
                        kotlinx.coroutines.delay(i * 40L)
                        grow.animateTo(1f, spring(dampingRatio = 0.7f, stiffness = 180f))
                    }
                    Box(
                        Modifier.weight(1f).fillMaxHeight(fraction = (w.plays.toFloat() / max).coerceAtLeast(0.03f) * grow.value.coerceAtLeast(0.03f))
                            .clip(RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp)).background(if (w.plays > 0) accent else empty),
                    )
                }
            }
            Row(Modifier.fillMaxWidth().padding(top = 6.dp)) {
                Text(s.weekly.first().week.take(10), style = T.Micro, color = C.text3)
                Spacer(Modifier.weight(1f))
                Text("Прослушивания по неделям", style = T.Micro, color = C.text)
                Spacer(Modifier.weight(1f))
                Text("сейчас", style = T.Micro, color = C.text3)
            }
        }
        Text("По данным Sonora: засчитываются прослушивания дольше 30 секунд.", style = T.Micro, color = C.text3, modifier = Modifier.padding(top = 10.dp))
    }
}

/** `matchParentSize` needs a BoxScope receiver; for layered boxes inside a sized Box this is equivalent. */
private fun Modifier.matchParentSizeCompat(): Modifier = this.fillMaxWidth().fillMaxHeight()
