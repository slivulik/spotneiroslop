package com.sonora.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.sonora.app.data.net.ArtistSummary
import com.sonora.app.data.net.Artwork
import com.sonora.app.data.net.Genre
import com.sonora.app.data.net.PlaylistSummary
import com.sonora.app.data.net.ReleaseSummary
import com.sonora.app.data.net.Track
import com.sonora.app.playback.PlayContext
import com.sonora.app.ui.LocalActions
import com.sonora.app.ui.LocalEnv
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.EqBars
import com.sonora.app.ui.design.IconBtn
import com.sonora.app.ui.design.PrimaryButton
import com.sonora.app.ui.design.S
import com.sonora.app.ui.design.Skeleton
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.hexColor
import com.sonora.app.ui.design.press
import com.sonora.core.designsystem.tokens.SonoraTokens

fun formatDuration(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

fun parseColor(hex: String?): Color? = hexColor(hex)

private val RELEASE_KIND = mapOf("album" to "Альбом", "single" to "Сингл", "ep" to "EP", "compilation" to "Сборник")
fun releaseKind(type: String) = RELEASE_KIND[type] ?: "Альбом"

fun tracksWord(n: Int): String {
    val m10 = n % 10
    val m100 = n % 100
    val w = when {
        m10 == 1 && m100 != 11 -> "трек"
        m10 in 2..4 && m100 !in 12..14 -> "трека"
        else -> "треков"
    }
    return "$n $w"
}

private val PLACEHOLDER = listOf(SonoraTokens.Colors.WaveA, SonoraTokens.Colors.WaveB, SonoraTokens.Colors.WaveC, SonoraTokens.Colors.WaveD)

/** The two colours of the placeholder gradient [Cover] draws for [seed] while there is no artwork. */
fun placeholderColors(seed: String): Pair<Color, Color> {
    val h = seed.hashCode()
    val a = PLACEHOLDER[Math.floorMod(h, 4)]
    val b = PLACEHOLDER[Math.floorMod(h / 4 + 1, 4)].takeIf { it != a } ?: PLACEHOLDER[(Math.floorMod(h, 4) + 2) % 4]
    return a to b
}

/**
 * Three colours that belong to a cover: its palette (vibrant first) when the server extracted one,
 * otherwise the placeholder pair, so ambient backgrounds always match what the cover shows.
 */
fun coverColors(artwork: Artwork?, seed: String): List<Color> {
    val p = artwork?.palette
    val fromCover = listOfNotNull(hexColor(p?.vibrant), hexColor(p?.accent), hexColor(p?.dominant), hexColor(p?.muted)).distinct()
    return when (fromCover.size) {
        0 -> placeholderColors(seed).let { (a, b) -> listOf(a, b, PLACEHOLDER.first { it != a && it != b }) }
        1 -> fromCover[0].let { c -> listOf(c, lerp(c, Color.White, 0.35f), lerp(c, Color.Black, 0.4f)) }
        2 -> fromCover + lerp(fromCover[0], fromCover[1], 0.5f)
        else -> fromCover.take(3)
    }
}

/** Artwork, or a calm two-tone gradient picked from the seed while there is none. */
@Composable
fun Cover(artwork: Artwork?, size: Dp, modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(6.dp), description: String? = null, seed: String = "") {
    val px = with(LocalDensity.current) { size.roundToPx() }
    val (a, b) = placeholderColors(seed)
    val tint = hexColor(artwork?.palette?.dominant) ?: Color(0xFF1D1A26)
    Box(
        modifier.size(size).clip(shape).drawBehind {
            if (artwork == null) {
                drawRect(Brush.linearGradient(listOf(a.copy(alpha = 0.9f), b.copy(alpha = 0.75f)), Offset.Zero, Offset(this.size.width, this.size.height)))
            } else {
                drawRect(tint)
            }
        },
    ) {
        if (artwork != null) AsyncImage(model = artwork.url(px), contentDescription = description, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

/** Transparent top bar with a back arrow and an optional title (detail pages, settings). */
@Composable
fun BackBar(title: String? = null, trailing: (@Composable () -> Unit)? = null) {
    val actions = LocalActions.current
    Row(Modifier.fillMaxWidth().statusBarsPadding().height(56.dp).padding(horizontal = S.xs), verticalAlignment = Alignment.CenterVertically) {
        IconBtn(Icons.AutoMirrored.Filled.ArrowBack, "Назад", actions::back, tint = C.text)
        if (title != null) Text(title, style = T.Title, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = S.xs))
        else Spacer(Modifier.weight(1f))
        trailing?.invoke()
    }
}

/** Shelf card: cover, title, one line of detail — nothing around it. */
@Composable
fun MediaCard(artwork: Artwork?, title: String, subtitle: String?, seed: String, width: Dp = 148.dp, round: Boolean = false, onClick: () -> Unit) {
    Column(Modifier.width(width).press(onClick, label = title), horizontalAlignment = if (round) Alignment.CenterHorizontally else Alignment.Start) {
        Cover(artwork, width, shape = if (round) CircleShape else RoundedCornerShape(8.dp), description = title, seed = seed)
        Spacer(Modifier.height(S.s))
        Text(title, style = T.LabelBold, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = if (round) TextAlign.Center else TextAlign.Start)
        if (!subtitle.isNullOrBlank()) Text(subtitle, style = T.Caption, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = if (round) TextAlign.Center else TextAlign.Start)
    }
}

@Composable
fun ReleaseCard(r: ReleaseSummary, width: Dp = 148.dp) {
    val actions = LocalActions.current
    MediaCard(r.artwork, r.title, listOfNotNull(r.releaseDate?.take(4), r.artists.firstOrNull()?.name).joinToString(" · ").ifBlank { releaseKind(r.type) }, r.id, width) { actions.navigate("album/${r.id}") }
}

@Composable
fun PlaylistCard(p: PlaylistSummary, width: Dp = 148.dp) {
    val actions = LocalActions.current
    MediaCard(p.artwork ?: p.mosaic.firstOrNull(), p.title, p.description?.takeIf { it.isNotBlank() } ?: tracksWord(p.trackCount), p.id, width) { actions.navigate("playlist/${p.id}") }
}

@Composable
fun ArtistCircle(a: ArtistSummary, width: Dp = 120.dp) {
    val actions = LocalActions.current
    MediaCard(a.artwork, a.name, "Артист", a.id, width, round = true) { actions.navigate("artist/${a.id}") }
}

/** Genre tile: colour block, name in the top-left corner. */
@Composable
fun GenreTile(g: Genre, modifier: Modifier = Modifier) {
    val actions = LocalActions.current
    val c = hexColor(g.color) ?: C.accent
    Box(
        modifier.height(96.dp).clip(RoundedCornerShape(8.dp)).background(Brush.linearGradient(listOf(c, c.copy(red = c.red * 0.7f, green = c.green * 0.7f, blue = c.blue * 0.7f))))
            .press({ actions.navigate("genre/${g.slug}") }, label = g.name).padding(S.m),
    ) {
        Text(g.name, style = T.Title, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun <T> Shelf(items: List<T>, key: (T) -> String, content: @Composable (T) -> Unit) {
    LazyRow(contentPadding = PaddingValues(horizontal = S.page), horizontalArrangement = Arrangement.spacedBy(S.m)) {
        itemsIndexed(items, key = { _, it -> key(it) }) { _, it -> content(it) }
    }
}

/**
 * One track: cover (or number), title, artist; a small heart if saved; «⋮» for actions.
 * The row dims on press; the playing row turns accent and shows bouncing bars.
 */
@Composable
fun TrackRow(track: Track, tracks: List<Track>, index: Int, ctx: PlayContext, numbered: Boolean = false, showAlbum: Boolean = false) {
    val env = LocalEnv.current
    val actions = LocalActions.current
    val current = track.id == env.currentId
    val titleColor by animateColorAsState(
        when {
            current -> C.accent
            !track.playable -> C.text3
            else -> C.text
        },
        label = "row",
    )
    Row(
        Modifier.fillMaxWidth().height(64.dp)
            .press({ actions.play(tracks, index, ctx) }, enabled = track.playable)
            .padding(start = S.page, end = S.xs)
            .semantics { contentDescription = "${track.fullTitle}, ${track.artistLine}" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (numbered) {
            Box(Modifier.width(28.dp), contentAlignment = Alignment.CenterStart) {
                if (current) EqBars(env.playing) else Text("${track.trackNumber}", style = T.Body, color = C.text2)
            }
        } else {
            Box(contentAlignment = Alignment.Center) {
                Cover(track.release.artwork, 48.dp, seed = track.release.id)
                if (current) Box(Modifier.size(48.dp).clip(RoundedCornerShape(6.dp)).background(Color.Black.copy(alpha = 0.5f)), contentAlignment = Alignment.Center) { EqBars(env.playing, Color.White) }
            }
        }
        Spacer(Modifier.width(S.m))
        Column(Modifier.weight(1f)) {
            Text(track.fullTitle, style = T.BodyMedium, color = titleColor, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (track.isExplicit) {
                    Box(Modifier.padding(end = 6.dp).clip(RoundedCornerShape(2.dp)).background(C.text3).padding(horizontal = 4.dp)) { Text("E", style = T.Small, color = C.bg) }
                }
                Text(
                    if (showAlbum) "${track.artistLine} · ${track.release.title}" else track.artistLine,
                    style = T.Caption, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (track.id in env.likedTracks) Icon(Icons.Filled.Favorite, contentDescription = "В любимых", tint = C.accent, modifier = Modifier.padding(start = S.s).size(16.dp))
        IconBtn(Icons.Filled.MoreVert, "Действия с треком", { actions.openTrackMenu(track, ctx) }, size = 20.dp)
    }
}

/** Loading (skeleton matching the layout) / error / offline banner. */
@Composable
fun <T> LoadState(state: UiState<T>, onRetry: () -> Unit, content: @Composable (T) -> Unit) {
    when (state) {
        is UiState.Loading -> Column(Modifier.fillMaxSize().statusBarsPadding().padding(S.page)) {
            Skeleton(Modifier.width(180.dp).height(28.dp))
            Spacer(Modifier.height(S.xl))
            Skeleton(Modifier.fillMaxWidth().height(140.dp), RoundedCornerShape(12.dp))
            Spacer(Modifier.height(S.xl))
            Skeleton(Modifier.width(140.dp).height(20.dp))
            Spacer(Modifier.height(S.m))
            Row(horizontalArrangement = Arrangement.spacedBy(S.m)) { repeat(3) { Skeleton(Modifier.size(148.dp)) } }
            Spacer(Modifier.height(S.xl))
            repeat(4) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = S.s)) {
                    Skeleton(Modifier.size(48.dp))
                    Spacer(Modifier.width(S.m))
                    Column { Skeleton(Modifier.width(180.dp).height(14.dp)); Spacer(Modifier.height(6.dp)); Skeleton(Modifier.width(110.dp).height(12.dp)) }
                }
            }
        }
        is UiState.Failed -> Column(Modifier.fillMaxSize().padding(S.xxl), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Filled.WifiOff, contentDescription = null, tint = C.text3, modifier = Modifier.size(40.dp))
            Spacer(Modifier.height(S.l))
            Text(state.message, style = T.Title, color = C.text, textAlign = TextAlign.Center)
            Spacer(Modifier.height(S.xl))
            PrimaryButton("Повторить", onRetry, Modifier.width(200.dp))
        }
        is UiState.Ready -> Column {
            AnimatedVisibility(state.offline, enter = expandVertically() + fadeIn()) {
                Text(
                    "Нет сети — показана сохранённая версия", style = T.Caption, color = C.text,
                    modifier = Modifier.fillMaxWidth().background(C.surfaceHigh).statusBarsPadding().padding(horizontal = S.page, vertical = S.s),
                )
            }
            content(state.data)
        }
    }
}

sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Failed(val message: String) : UiState<Nothing>
    data class Ready<T>(val data: T, val offline: Boolean = false) : UiState<T>
}
