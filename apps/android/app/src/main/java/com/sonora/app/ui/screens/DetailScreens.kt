package com.sonora.app.ui.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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
import com.sonora.app.ui.LocalActions
import com.sonora.app.ui.LocalBottomInset
import com.sonora.app.ui.LocalEnv
import com.sonora.app.ui.components.ArtistCircle
import com.sonora.app.ui.components.BackBar
import com.sonora.app.ui.components.Cover
import com.sonora.app.ui.components.LoadState
import com.sonora.app.ui.components.ReleaseCard
import com.sonora.app.ui.components.Shelf
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.components.formatDuration
import com.sonora.app.ui.components.releaseKind
import com.sonora.app.ui.components.tracksWord
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.HeartBtn
import com.sonora.app.ui.design.IconBtn
import com.sonora.app.ui.design.OutlinePill
import com.sonora.app.ui.design.PlayButton
import com.sonora.app.ui.design.QualityMark
import com.sonora.app.ui.design.S
import com.sonora.app.ui.design.SectionTitle
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.headerWash
import com.sonora.app.ui.design.muted
import com.sonora.app.ui.design.press
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
private val ru = Locale.forLanguageTag("ru")

@Composable fun AlbumScreen(vm: AlbumViewModel = hiltViewModel()) { val s by vm.state.collectAsStateWithLifecycle(); LoadState(s, { vm.load() }) { AlbumContent(it) } }
@Composable fun PlaylistScreen(vm: PlaylistViewModel = hiltViewModel()) { val s by vm.state.collectAsStateWithLifecycle(); LoadState(s, { vm.load() }) { PlaylistContent(it) } }
@Composable fun MixScreen(vm: MixViewModel = hiltViewModel()) { val s by vm.state.collectAsStateWithLifecycle(); LoadState(s, { vm.load() }) { MixContent(it) } }
@Composable fun GenreScreen(vm: GenreViewModel = hiltViewModel()) { val s by vm.state.collectAsStateWithLifecycle(); LoadState(s, { vm.load() }) { GenreContent(it) } }
@Composable fun ArtistScreen(vm: ArtistViewModel = hiltViewModel()) { val s by vm.state.collectAsStateWithLifecycle(); LoadState(s, { vm.load() }) { ArtistContent(it) } }

/** Header + action row + tracks, shared by album, playlist, mix and genre pages. */
@Composable
private fun CollectionPage(
    artwork: Artwork?,
    seed: String,
    title: String,
    owner: String?,
    onOwner: (() -> Unit)?,
    meta: String,
    tracks: List<Track>,
    ctx: PlayContext,
    saveKind: String?,
    saveId: String,
    sharePath: String?,
    numbered: Boolean,
    footer: (@Composable () -> Unit)? = null,
) {
    val env = LocalEnv.current
    val actions = LocalActions.current
    val wash = muted(artwork?.palette?.dominant ?: artwork?.palette?.vibrant, C.surfaceHigh)
    val playingHere = env.isPlayingFrom(ctx)
    LazyColumn(Modifier.fillMaxSize().headerWash(wash), contentPadding = PaddingValues(bottom = LocalBottomInset.current + S.l)) {
        item { BackBar() }
        item {
            Column(Modifier.fillMaxWidth().padding(horizontal = S.page)) {
                Cover(
                    artwork, 232.dp, seed = seed, description = title, shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.align(Alignment.CenterHorizontally).shadow(24.dp, RoundedCornerShape(8.dp)),
                )
                Spacer(Modifier.height(S.xl))
                Text(title, style = T.Headline, color = C.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (owner != null) {
                    Spacer(Modifier.height(S.s))
                    Text(owner, style = T.LabelBold, color = C.text, modifier = if (onOwner != null) Modifier.press(onOwner) else Modifier)
                }
                Spacer(Modifier.height(S.xs))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(meta, style = T.Caption, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    Spacer(Modifier.size(S.s))
                    QualityMark(tracks.any { it.audio.hires }, tracks.any { it.audio.lossless })
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth().padding(start = S.xs, end = S.page, top = S.s, bottom = S.s), verticalAlignment = Alignment.CenterVertically) {
                if (saveKind != null) HeartBtn(env.saved(saveKind, saveId), { actions.toggleSaved(saveKind, saveId) })
                if (sharePath != null) IconBtn(Icons.Filled.IosShare, "Поделиться", { actions.share(sharePath, title) })
                Spacer(Modifier.weight(1f))
                IconBtn(Icons.Filled.Shuffle, "Перемешать", { actions.play(tracks, tracks.indices.random(), ctx, shuffle = true) }, enabled = tracks.isNotEmpty())
                Spacer(Modifier.size(S.s))
                PlayButton(playingHere, { if (env.currentContext?.id == ctx.id && env.currentContext?.type == ctx.type) actions.togglePlay() else actions.play(tracks, 0, ctx) }, enabled = tracks.any { it.playable })
            }
        }
        items(tracks.size) { i -> TrackRow(tracks[i], tracks, i, ctx, numbered = numbered) }
        if (footer != null) item { footer() }
    }
}

private fun year(date: String?) = date?.take(4)

@Composable
fun AlbumContent(r: Release) {
    val actions = LocalActions.current
    val ctx = PlayContext("release", r.id, r.title)
    CollectionPage(
        r.artwork, r.id, r.title,
        owner = r.artists.joinToString(", ") { it.name },
        onOwner = r.artists.firstOrNull()?.let { a -> { actions.navigate("artist/${a.id}") } },
        meta = listOfNotNull(releaseKind(r.type), year(r.releaseDate)).joinToString(" · "),
        tracks = r.tracks, ctx = ctx, saveKind = "releases", saveId = r.id, sharePath = "/album/${r.id}", numbered = true,
    ) {
        Column(Modifier.padding(horizontal = S.page, vertical = S.l)) {
            r.releaseDate?.let { d -> runCatching { LocalDate.parse(d).format(DateTimeFormatter.ofPattern("d MMMM yyyy", ru)) }.getOrNull() }?.let { Text(it, style = T.Caption, color = C.text2) }
            Text("${tracksWord(r.trackCount)}, ${formatDuration(r.totalDurationMs)}", style = T.Caption, color = C.text2)
            r.label?.let { Text("℗ $it", style = T.Caption, color = C.text3) }
        }
    }
}

@Composable
fun PlaylistContent(p: Playlist) = CollectionPage(
    p.artwork ?: p.mosaic.firstOrNull(), p.id, p.title, owner = p.ownerName ?: "Sonora", onOwner = null,
    meta = "${tracksWord(p.trackCount)} · ${formatDuration(p.totalDurationMs)}",
    tracks = p.tracks, ctx = PlayContext("playlist", p.id, p.title), saveKind = if (p.ownerId == null) "playlists" else null, saveId = p.id,
    sharePath = "/playlist/${p.id}", numbered = false,
)

@Composable
fun MixContent(m: Mix) = CollectionPage(
    m.tracks.firstOrNull()?.release?.artwork, m.key, m.title, owner = m.subtitle, onOwner = null, meta = "Микс дня · ${tracksWord(m.tracks.size)}",
    tracks = m.tracks, ctx = PlayContext("mix", m.key, m.title), saveKind = null, saveId = m.key, sharePath = null, numbered = false,
)

@Composable
fun GenreContent(g: GenreDetail) = CollectionPage(
    g.genre.artwork ?: g.releases.firstOrNull()?.artwork, g.genre.slug, g.genre.name, owner = g.description, onOwner = null, meta = "Жанр · ${tracksWord(g.tracks.size)}",
    tracks = g.tracks, ctx = PlayContext("genre", g.genre.id, g.genre.name), saveKind = null, saveId = g.genre.id, sharePath = "/genre/${g.genre.slug}", numbered = false,
) {
    if (g.releases.isNotEmpty()) {
        SectionTitle("Релизы")
        Shelf(g.releases, { it.id }) { ReleaseCard(it) }
    }
}

@Composable
fun ArtistContent(page: ArtistPage) {
    val env = LocalEnv.current
    val actions = LocalActions.current
    val a = page.artist
    val ctx = PlayContext("artist", a.id, a.name)
    val albums = page.releases.filter { it.type == "album" || it.type == "compilation" }
    val singles = page.releases - albums.toSet()
    var bioOpen by remember { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalBottomInset.current + S.l)) {
        item {
            // Photo edge to edge; the name sits on a gradient at its bottom.
            Box(Modifier.fillMaxWidth().height(340.dp)) {
                Cover(a.artwork, 420.dp, modifier = Modifier.fillMaxSize(), shape = RoundedCornerShape(0.dp), description = a.name, seed = a.id)
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.35f), 0.35f to Color.Transparent, 1f to C.bg)))
                Box(Modifier.statusBarsPadding().padding(S.xs)) {
                    Box(Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).background(Color.Black.copy(alpha = 0.35f)), contentAlignment = Alignment.Center) {
                        IconBtn(Icons.AutoMirrored.Filled.ArrowBack, "Назад", actions::back, tint = Color.White)
                    }
                }
                Column(Modifier.align(Alignment.BottomStart).padding(horizontal = S.page, vertical = S.s)) {
                    if (a.verified) Text("Подтверждённый артист", style = T.Small, color = C.text2)
                    Text(a.name, style = T.Headline.copy(fontSize = 34.sp, lineHeight = 40.sp), color = C.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        item {
            Column(Modifier.padding(horizontal = S.page)) {
                Text("${numbers.format(page.stats?.monthlyListeners ?: a.monthlyListeners)} слушателей за месяц", style = T.Caption, color = C.text2)
            }
            Row(Modifier.fillMaxWidth().padding(start = S.page, end = S.page, top = S.m, bottom = S.s), verticalAlignment = Alignment.CenterVertically) {
                OutlinePill(if (a.id in env.followed) "Вы подписаны" else "Подписаться", { actions.toggleSaved("artists", a.id) }, active = a.id in env.followed)
                Spacer(Modifier.size(S.xs))
                IconBtn(Icons.Filled.IosShare, "Поделиться", { actions.share("/artist/${a.id}", a.name) })
                Spacer(Modifier.weight(1f))
                IconBtn(Icons.Filled.Shuffle, "Перемешать", { actions.play(page.top, page.top.indices.random(), ctx, shuffle = true) }, enabled = page.top.isNotEmpty())
                Spacer(Modifier.size(S.s))
                PlayButton(env.isPlayingFrom(ctx), { if (env.currentContext?.id == a.id) actions.togglePlay() else actions.play(page.top, 0, ctx) }, enabled = page.top.isNotEmpty())
            }
        }
        if (page.top.isNotEmpty()) {
            item { SectionTitle("Популярные треки") }
            val top = page.top.take(5)
            items(top.size) { i -> TrackRow(top[i], page.top, i, ctx) }
        }
        if (albums.isNotEmpty()) {
            item { SectionTitle("Альбомы") }
            item { Shelf(albums, { it.id }) { ReleaseCard(it) } }
        }
        if (singles.isNotEmpty()) {
            item { SectionTitle("Синглы и EP") }
            item { Shelf(singles, { it.id }) { ReleaseCard(it) } }
        }
        page.stats?.takeIf { it.weekly.isNotEmpty() }?.let { s -> item { StatsCard(s) } }
        a.bio?.let { bio ->
            item {
                SectionTitle("Об артисте")
                Column(Modifier.padding(horizontal = S.page).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.surface).padding(S.l).animateContentSize()) {
                    Text(bio, style = T.Body, color = C.text2, maxLines = if (bioOpen) Int.MAX_VALUE else 5, overflow = TextOverflow.Ellipsis)
                    if (bio.length > 280) Text(if (bioOpen) "Свернуть" else "Ещё", style = T.LabelBold, color = C.text, modifier = Modifier.padding(top = S.s).press({ bioOpen = !bioOpen }))
                    if (a.bioSource != null) Text("Источник: Википедия", style = T.Small, color = C.text3, modifier = Modifier.padding(top = S.s))
                }
            }
        }
        if (page.similar.isNotEmpty()) {
            item { SectionTitle("Похожие артисты") }
            item { Shelf(page.similar, { it.id }) { ArtistCircle(it) } }
        }
    }
}

/** Plays over the last 12 weeks: one line of numbers and a quiet bar chart. */
@Composable
private fun StatsCard(s: ArtistStats) {
    SectionTitle("Статистика")
    Column(Modifier.padding(horizontal = S.page).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.surface).padding(S.l)) {
        Row {
            listOf("За 30 дней" to numbers.format(s.plays30d), "Всего" to numbers.format(s.totalPlays), "С" to (year(s.firstRelease) ?: "—")).forEach { (label, value) ->
                Column(Modifier.weight(1f)) {
                    Text(value, style = T.Title, color = C.text)
                    Text(if (label == "С") "Первый релиз" else label, style = T.Caption, color = C.text2)
                }
            }
        }
        Spacer(Modifier.height(S.l))
        val max = s.weekly.maxOf { it.plays }.coerceAtLeast(1)
        val accent = C.accent
        val empty = C.fg.copy(alpha = 0.08f)
        Row(Modifier.fillMaxWidth().height(64.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
            s.weekly.forEach { w ->
                Box(Modifier.weight(1f).fillMaxHeight((w.plays.toFloat() / max).coerceAtLeast(0.05f)).clip(RoundedCornerShape(2.dp)).background(if (w.plays > 0) accent else empty))
            }
        }
        Spacer(Modifier.height(S.s))
        Text("Прослушивания по неделям, 12 недель", style = T.Small, color = C.text3)
    }
}
