package com.sonora.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.PlaylistPlay
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sonora.app.data.net.ArtistSummary
import com.sonora.app.data.net.Artwork
import com.sonora.app.data.net.Genre
import com.sonora.app.data.net.PlaylistSummary
import com.sonora.app.data.net.ReleaseSummary
import com.sonora.app.data.net.Track
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.EqBars
import com.sonora.app.ui.design.HeartButton
import com.sonora.app.ui.design.MonoLabel
import com.sonora.app.ui.design.PrimaryButton
import com.sonora.app.ui.design.Skeleton
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.WaveA
import com.sonora.app.ui.design.WaveB
import com.sonora.app.ui.design.WaveC
import com.sonora.app.ui.design.appear
import com.sonora.app.ui.design.glass
import com.sonora.app.ui.design.hexColor
import com.sonora.app.ui.design.pressable

fun formatDuration(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

fun parseColor(hex: String?): Color? = hexColor(hex)

private val RELEASE_KIND = mapOf("album" to "Альбом", "single" to "Сингл", "ep" to "EP", "compilation" to "Сборник")
fun releaseKind(type: String) = RELEASE_KIND[type] ?: "Альбом"

/** Artwork, or a seeded colour field like the web Artwork fallback. */
@Composable
fun Cover(
    artwork: Artwork?,
    size: Dp,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(10.dp),
    description: String? = null,
    seed: String? = null,
) {
    val px = with(LocalDensity.current) { size.roundToPx() }
    val tint = hexColor(artwork?.palette?.dominant) ?: hexColor(artwork?.palette?.vibrant)
    val h = (seed ?: description ?: "").hashCode()
    val wave = listOf(WaveA, WaveB, WaveC)
    val a = wave[Math.floorMod(h, 3)]
    val b = wave[Math.floorMod(h / 3, 3)].takeIf { it != a } ?: wave[(Math.floorMod(h, 3) + 1) % 3]
    Box(
        modifier.size(size).clip(shape).drawBehind {
            if (artwork == null) {
                drawRect(Color(0xFF15131C))
                drawCircle(Brush.radialGradient(listOf(a.copy(alpha = 0.85f), Color.Transparent), Offset(this.size.width * 0.3f, this.size.height * 0.35f), this.size.width * 0.6f))
                drawCircle(Brush.radialGradient(listOf(b.copy(alpha = 0.75f), Color.Transparent), Offset(this.size.width * 0.75f, this.size.height * 0.7f), this.size.width * 0.55f))
            } else {
                drawRect((tint ?: Color(0xFF1D1A26)).copy(alpha = 0.5f))
            }
        },
    ) {
        if (artwork != null) {
            AsyncImage(model = artwork.url(px), contentDescription = description, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

/** Sticky-looking header row of every page: logo, search pill, avatar / «Войти» (TopBar.tsx). */
@Composable
fun TopBar(navigate: (String) -> Unit, initial: String?, signedIn: Boolean, onAvatar: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(32.dp).clip(RoundedCornerShape(9.dp)).background(C.accent).pressable({ navigate("home") }, label = "Главная"),
            contentAlignment = Alignment.Center,
        ) { Text("S", style = T.Title3, color = C.onAccent) }
        Row(
            Modifier.weight(1f).height(40.dp).glass(CircleShape, shadow = false).pressable({ navigate("search") }, scaleTo = 0.98f, label = "Поиск").padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Search, null, tint = C.text2, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
            Text("Треки, артисты, альбомы, жанры", style = T.Body, color = C.text3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (signedIn) {
            Box(Modifier.size(36.dp).clip(CircleShape).background(C.accent).pressable(onAvatar, label = "Профиль и настройки"), contentAlignment = Alignment.Center) {
                Text((initial ?: "S").take(1).uppercase(), style = T.BodyBold, color = C.onAccent)
            }
        } else {
            Box(Modifier.height(36.dp).clip(CircleShape).background(C.fg.copy(alpha = 0.08f)).pressable(onAvatar).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                Text("Войти", style = T.BodyBold, color = C.text)
            }
        }
    }
}

/** `liquid rounded-xl p-2.5` card: cover, bold title, caption (ReleaseCard). */
@Composable
fun MediaCard(artwork: Artwork?, title: String, subtitle: String?, width: Dp = 160.dp, index: Int = 0, seed: String? = null, onClick: () -> Unit) {
    Column(
        Modifier.width(width).appear(index).glass(RoundedCornerShape(18.dp)).pressable(onClick, scaleTo = 0.97f, label = title).padding(10.dp),
    ) {
        Cover(artwork, width - 20.dp, shape = RoundedCornerShape(14.dp), description = title, seed = seed ?: title, modifier = Modifier.shadow(6.dp, RoundedCornerShape(14.dp)))
        Column(Modifier.padding(start = 4.dp, end = 4.dp, top = 10.dp, bottom = 4.dp)) {
            Text(title, style = T.BodyBold, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrBlank()) Text(subtitle, style = T.Caption, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun ReleaseCard(r: ReleaseSummary, index: Int = 0, width: Dp = 160.dp, onClick: () -> Unit) =
    MediaCard(r.artwork, r.title, "${releaseKind(r.type)} · ${r.artists.joinToString(", ") { it.name }}", width, index, r.id, onClick)

@Composable
fun PlaylistCard(p: PlaylistSummary, index: Int = 0, width: Dp = 160.dp, onClick: () -> Unit) =
    MediaCard(p.artwork ?: p.mosaic.firstOrNull(), p.title, p.description?.takeIf { it.isNotBlank() } ?: "${p.trackCount} треков", width, index, p.id, onClick)

/** Tall 3:4 artist card: photo, dark gradient, «АРТИСТ» mono + display name, heart on glass (ArtistCard.tsx). */
@Composable
fun ArtistCard(a: ArtistSummary, saved: Boolean, onToggle: () -> Unit, width: Dp = 150.dp, index: Int = 0, onClick: () -> Unit) {
    Box(
        Modifier.width(width).aspectRatio(3f / 4f).appear(index).shadow(8.dp, RoundedCornerShape(18.dp)).clip(RoundedCornerShape(18.dp)).background(C.raised)
            .pressable(onClick, scaleTo = 0.97f, label = a.name),
    ) {
        Cover(a.artwork, width * 4 / 3, modifier = Modifier.fillMaxSize(), shape = RoundedCornerShape(0.dp), description = a.name, seed = a.name)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color.Transparent, 0.5f to Color.Black.copy(alpha = 0.1f), 1f to Color.Black.copy(alpha = 0.8f))))
        Box(Modifier.align(Alignment.TopEnd).padding(6.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.35f))) {
            HeartButton(saved, onToggle, size = 16.dp, tint = Color.White)
        }
        Column(Modifier.align(Alignment.BottomStart).padding(12.dp)) {
            MonoLabel((if (a.verified) "✓ " else "") + "Артист", color = Color.White.copy(alpha = 0.7f))
            Text(a.name, style = T.Title3, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Coloured genre tile with the name in display type. */
@Composable
fun GenreTile(g: Genre, index: Int = 0, width: Dp = 160.dp, onClick: () -> Unit) {
    val c = hexColor(g.color) ?: C.accent
    Box(
        Modifier.width(width).height(96.dp).appear(index).clip(RoundedCornerShape(18.dp))
            .background(Brush.linearGradient(listOf(c, c.copy(alpha = 0.55f), Color(0xFF120E24))))
            .pressable(onClick, scaleTo = 0.96f, label = g.name).padding(14.dp),
    ) {
        Text(g.name, style = T.Title3, color = Color.White, modifier = Modifier.align(Alignment.BottomStart))
    }
}

@Composable
fun <T> Shelf(items: List<T>, key: (T) -> String, content: @Composable (Int, T) -> Unit) {
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        itemsIndexed(items, key = { _, it -> key(it) }) { i, it -> content(i, it) }
    }
}

/** Actions shared by every track row: queue, playlists, navigation, share. */
data class TrackActions(
    val onPlayNext: (Track) -> Unit,
    val onAddToQueue: (Track) -> Unit,
    val onAddToPlaylist: (Track) -> Unit,
    val onOpenAlbum: (String) -> Unit,
    val onOpenArtist: (String) -> Unit,
    val onShare: (Track) -> Unit,
    val isLiked: (String) -> Boolean,
    val onToggleLike: (Track) -> Unit,
)

/** Glass container for a list of rows (`liquid rounded-xl` TrackList on the web). */
@Composable
fun TrackListBox(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.padding(horizontal = 16.dp).fillMaxWidth().glass(RoundedCornerShape(20.dp)).padding(vertical = 6.dp)) { content() }
}

/** One row: number / bouncing bars, title (accent while playing), artist · album, heart, time, «…». */
@Composable
fun TrackRow(
    track: Track,
    current: Boolean,
    playing: Boolean,
    actions: TrackActions,
    onPlay: () -> Unit,
    index: Int? = null,
    showCover: Boolean = false,
    showAlbum: Boolean = true,
) {
    var menu by remember { mutableStateOf(false) }
    val titleColor by animateColorAsState(
        when {
            current -> C.accent
            !track.playable -> C.text3
            else -> C.text
        },
        label = "title",
    )
    Row(
        Modifier
            .fillMaxWidth()
            .pressable(onPlay, scaleTo = 0.985f, enabled = track.playable)
            .padding(start = 12.dp, end = 2.dp, top = 6.dp, bottom = 6.dp)
            .semantics { contentDescription = "${track.fullTitle}, ${track.artistLine}" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (index != null) {
            Box(Modifier.width(30.dp), contentAlignment = Alignment.Center) {
                if (current) EqBars(playing) else Text("$index", style = T.Body, color = C.text3)
            }
            Spacer(Modifier.width(6.dp))
        }
        if (showCover) {
            Box {
                Cover(track.release.artwork, 46.dp, shape = RoundedCornerShape(8.dp), seed = track.release.id)
                if (current && index == null) Box(Modifier.size(46.dp).clip(RoundedCornerShape(8.dp)).background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) { EqBars(playing, Color.White) }
            }
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(track.fullTitle, style = T.Body.copy(fontSize = 16.sp), color = titleColor, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (track.isExplicit) ExplicitMark()
                Text(
                    if (showAlbum) "${track.artistLine} · ${track.release.title}" else track.artistLine,
                    style = T.Caption, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        HeartButton(actions.isLiked(track.id), { actions.onToggleLike(track) }, size = 20.dp)
        Text(formatDuration(track.durationMs), style = T.Caption, color = C.text3)
        Box {
            Box(Modifier.size(40.dp).pressable({ menu = true }, scaleTo = 0.85f, label = "Ещё"), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.MoreHoriz, contentDescription = "Ещё", tint = C.text2, modifier = Modifier.size(20.dp))
            }
            TrackMenu(track, menu, { menu = false }, actions)
        }
    }
}

@Composable
private fun ExplicitMark() {
    Box(Modifier.padding(end = 6.dp).clip(RoundedCornerShape(3.dp)).background(C.text3.copy(alpha = 0.35f)).padding(horizontal = 4.dp)) {
        Text("E", style = T.Micro, color = C.text)
    }
}

@Composable
fun TrackMenu(track: Track, open: Boolean, onDismiss: () -> Unit, actions: TrackActions) {
    DropdownMenu(expanded = open, onDismissRequest = onDismiss, containerColor = C.elevated, shape = RoundedCornerShape(16.dp)) {
        @Composable
        fun item(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean = true, run: () -> Unit) =
            DropdownMenuItem(
                text = { Text(text, style = T.CaptionBold.copy(fontSize = 14.sp), color = C.text, maxLines = 1) },
                leadingIcon = { Icon(icon, null, tint = C.text2) },
                enabled = enabled,
                onClick = { onDismiss(); run() },
            )
        item("Слушать следующим", Icons.AutoMirrored.Filled.PlaylistPlay, track.playable) { actions.onPlayNext(track) }
        item("Добавить в очередь", Icons.AutoMirrored.Filled.QueueMusic, track.playable) { actions.onAddToQueue(track) }
        item("Добавить в плейлист…", Icons.AutoMirrored.Filled.PlaylistAdd) { actions.onAddToPlaylist(track) }
        item("Перейти к альбому", Icons.Filled.Album) { actions.onOpenAlbum(track.release.id) }
        track.artists.take(2).forEach { a -> item("Артист: ${a.name}", Icons.Filled.Person) { actions.onOpenArtist(a.id) } }
        item("Поделиться", Icons.Filled.Share) { actions.onShare(track) }
    }
}

/** Loading (shimmer skeletons) / error / offline wrapper used by every screen. */
@Composable
fun <T> LoadState(state: UiState<T>, onRetry: () -> Unit, content: @Composable (T) -> Unit) {
    when (state) {
        is UiState.Loading -> Column(Modifier.fillMaxSize().statusBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Skeleton(Modifier.fillMaxWidth().height(40.dp), CircleShape)
            Skeleton(Modifier.fillMaxWidth().height(220.dp), RoundedCornerShape(22.dp))
            Skeleton(Modifier.width(200.dp).height(26.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { repeat(3) { Skeleton(Modifier.size(150.dp)) } }
            repeat(4) { Skeleton(Modifier.fillMaxWidth().height(56.dp)) }
        }
        is UiState.Failed -> Column(
            Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Filled.WifiOff, contentDescription = null, tint = C.text3, modifier = Modifier.size(48.dp))
            Spacer(Modifier.height(12.dp))
            Text(state.message, style = T.BodyL, color = C.text)
            Spacer(Modifier.height(20.dp))
            PrimaryButton("Повторить", onRetry, Modifier.width(200.dp))
        }
        is UiState.Ready -> Column {
            AnimatedVisibility(state.offline, enter = expandVertically() + fadeIn()) {
                Row(
                    Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 4.dp).clip(CircleShape).background(C.accentMuted).border(1.dp, C.accent.copy(alpha = 0.4f), CircleShape)
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.WifiOff, null, tint = C.accent, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Нет сети — показана сохранённая версия", style = T.Caption, color = C.text)
                }
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
