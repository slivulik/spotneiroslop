package com.sonora.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.automirrored.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.sonora.app.data.net.Artwork
import com.sonora.app.data.net.Track
import com.sonora.app.ui.theme.Sonora

fun formatDuration(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

fun parseColor(hex: String?): Color? = hex?.removePrefix("#")?.toLongOrNull(16)?.let { Color(0xFF000000 or it) }

@Composable
fun Cover(artwork: Artwork?, size: Dp, modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(8.dp), description: String? = null) {
    val px = with(LocalDensity.current) { size.roundToPx() }
    val tint = parseColor(artwork?.palette?.vibrant) ?: MaterialTheme.colorScheme.surfaceVariant
    Box(modifier.size(size).clip(shape).background(tint.copy(alpha = 0.35f))) {
        if (artwork != null) {
            AsyncImage(model = artwork.url(px), contentDescription = description, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Icon(Icons.Filled.Album, contentDescription = null, tint = Sonora.colors.textTertiary, modifier = Modifier.align(Alignment.Center).size(size / 3))
        }
    }
}

@Composable
fun SectionTitle(title: String, subtitle: String? = null, modifier: Modifier = Modifier) {
    Column(modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (!subtitle.isNullOrBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Sonora.colors.textSecondary, maxLines = 1)
    }
}

@Composable
fun <T> Shelf(items: List<T>, key: (T) -> String, content: @Composable (T) -> Unit) {
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(items, key = key) { content(it) }
    }
}

@Composable
fun CardTile(artwork: Artwork?, title: String, subtitle: String?, round: Boolean = false, width: Dp = 148.dp, onClick: () -> Unit) {
    Column(Modifier.width(width).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(bottom = 4.dp)) {
        Cover(artwork, width, shape = if (round) CircleShape else RoundedCornerShape(10.dp), description = title)
        Spacer(Modifier.height(8.dp))
        Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (!subtitle.isNullOrBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Sonora.colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun LikeButton(saved: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    IconButton(onClick = onToggle, modifier = modifier) {
        Icon(
            if (saved) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
            contentDescription = if (saved) "Убрать из любимых" else "В любимые",
            tint = if (saved) MaterialTheme.colorScheme.primary else Sonora.colors.textSecondary,
        )
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

@Composable
fun TrackRow(
    track: Track,
    playing: Boolean,
    actions: TrackActions,
    onPlay: () -> Unit,
    index: Int? = null,
    showCover: Boolean = true,
) {
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = track.playable, onClick = onPlay)
            .padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp)
            .semantics { contentDescription = "${track.fullTitle}, ${track.artistLine}" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (index != null) {
            Text(
                "$index", style = MaterialTheme.typography.bodyMedium, color = if (playing) MaterialTheme.colorScheme.primary else Sonora.colors.textTertiary,
                modifier = Modifier.width(28.dp),
            )
        }
        if (showCover) {
            Cover(track.release.artwork, 48.dp)
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(
                track.fullTitle, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = when {
                    playing -> MaterialTheme.colorScheme.primary
                    !track.playable -> Sonora.colors.textTertiary
                    else -> MaterialTheme.colorScheme.onSurface
                },
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (track.isExplicit) Badge("E")
                if (track.audio.hires) Badge("Hi-Res") else if (track.audio.lossless) Badge("Lossless")
                Text(track.artistLine, style = MaterialTheme.typography.bodySmall, color = Sonora.colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Text(formatDuration(track.durationMs), style = MaterialTheme.typography.bodySmall, color = Sonora.colors.textTertiary)
        LikeButton(actions.isLiked(track.id), { actions.onToggleLike(track) })
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "Ещё") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Слушать следующим") }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.PlaylistPlay, null) }, enabled = track.playable, onClick = { menu = false; actions.onPlayNext(track) })
                DropdownMenuItem(text = { Text("Добавить в очередь") }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.QueueMusic, null) }, enabled = track.playable, onClick = { menu = false; actions.onAddToQueue(track) })
                DropdownMenuItem(text = { Text("Добавить в плейлист…") }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.PlaylistAdd, null) }, onClick = { menu = false; actions.onAddToPlaylist(track) })
                DropdownMenuItem(text = { Text("Перейти к альбому") }, leadingIcon = { Icon(Icons.Filled.Album, null) }, onClick = { menu = false; actions.onOpenAlbum(track.release.id) })
                track.artists.take(2).forEach { a ->
                    DropdownMenuItem(text = { Text("Артист: ${a.name}", maxLines = 1) }, leadingIcon = { Icon(Icons.Filled.Person, null) }, onClick = { menu = false; actions.onOpenArtist(a.id) })
                }
                DropdownMenuItem(text = { Text("Поделиться") }, leadingIcon = { Icon(Icons.Filled.Share, null) }, onClick = { menu = false; actions.onShare(track) })
            }
        }
    }
}

@Composable
fun Badge(text: String) {
    Surface(color = Sonora.colors.accentMuted, shape = RoundedCornerShape(4.dp), modifier = Modifier.padding(end = 6.dp)) {
        Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp))
    }
}

/** Loading / error / offline wrapper used by every screen. */
@Composable
fun <T> LoadState(state: UiState<T>, onRetry: () -> Unit, content: @Composable (T) -> Unit) {
    when (state) {
        is UiState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is UiState.Failed -> Column(
            Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Filled.WifiOff, contentDescription = null, tint = Sonora.colors.textTertiary, modifier = Modifier.size(48.dp))
            Spacer(Modifier.height(12.dp))
            Text(state.message, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(16.dp))
            Button(onClick = onRetry) { Text("Повторить") }
        }
        is UiState.Ready -> Column {
            if (state.offline) {
                Text(
                    "Нет сети — показана сохранённая версия", style = MaterialTheme.typography.labelMedium, color = Sonora.colors.textSecondary,
                    modifier = Modifier.fillMaxWidth().background(Sonora.colors.accentMuted).padding(horizontal = 16.dp, vertical = 6.dp),
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
