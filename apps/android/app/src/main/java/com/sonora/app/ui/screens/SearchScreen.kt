package com.sonora.app.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.net.Genre
import com.sonora.app.data.net.SearchResult
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.repo.LibraryRepository
import com.sonora.app.data.repo.userMessage
import com.sonora.app.playback.PlayContext
import com.sonora.app.ui.LocalBottomInset
import com.sonora.app.ui.components.ArtistCard
import com.sonora.app.ui.components.GenreTile
import com.sonora.app.ui.components.PlaylistCard
import com.sonora.app.ui.components.ReleaseCard
import com.sonora.app.ui.components.Shelf
import com.sonora.app.ui.components.TrackListBox
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.Chip
import com.sonora.app.ui.design.MonoLabel
import com.sonora.app.ui.design.Skeleton
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.appear
import com.sonora.app.ui.design.glass
import com.sonora.app.ui.design.pressable
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import javax.inject.Inject

data class SearchUi(
    val query: String = "",
    val sort: String? = null,
    val loading: Boolean = false,
    val result: SearchResult? = null,
    val error: String? = null,
    val history: List<String> = emptyList(),
    val popular: List<String> = emptyList(),
    val genres: List<Genre> = emptyList(),
)

@HiltViewModel
class SearchViewModel @Inject constructor(private val api: SonoraApi, private val library: LibraryRepository, private val json: Json) : ViewModel() {
    private val _ui = MutableStateFlow(SearchUi())
    val ui: StateFlow<SearchUi> = _ui
    private var job: Job? = null

    init { refreshSuggestions() }

    fun refreshSuggestions() = viewModelScope.launch {
        val history = runCatching { api.searchHistory().queries }.getOrDefault(emptyList())
        val popular = runCatching { api.popularSearches().queries }.getOrDefault(emptyList())
        val genres = runCatching { api.genres().items }.getOrDefault(emptyList())
        _ui.update { it.copy(history = history, popular = popular, genres = genres) }
    }

    /** Debounced as-you-type search (the server tolerates typos via trigram similarity). */
    fun setQuery(q: String) {
        _ui.update { it.copy(query = q) }
        job?.cancel()
        if (q.isBlank()) return _ui.update { it.copy(result = null, loading = false, error = null) }
        job = viewModelScope.launch {
            delay(250)
            run()
        }
    }

    fun setSort(sort: String?) {
        _ui.update { it.copy(sort = sort) }
        if (_ui.value.query.isNotBlank()) viewModelScope.launch { run() }
    }

    fun submit() {
        val q = _ui.value.query.trim()
        if (q.length >= 2) library.recordSearch(q)
    }

    fun clearHistory() = viewModelScope.launch {
        runCatching { api.clearSearchHistory() }
        _ui.update { it.copy(history = emptyList()) }
    }

    private suspend fun run() {
        val s = _ui.value
        _ui.update { it.copy(loading = true, error = null) }
        runCatching { api.search(s.query.trim(), 30, s.sort) }
            .onSuccess { r -> _ui.update { it.copy(result = r, loading = false) } }
            .onFailure { e -> _ui.update { it.copy(loading = false, error = e.userMessage(json)) } }
    }
}

private val SORTS = listOf(null to "По совпадению", "popular" to "Популярные", "new" to "Новые")

@UnstableApi
@Composable
fun SearchScreen(app: AppViewModel, navigate: (String) -> Unit, vm: SearchViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (ui.query.isEmpty()) runCatching { focus.requestFocus() } }
    Column(Modifier.fillMaxSize()) {
        // The search field lives where the web TopBar pill is.
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(32.dp).clip(RoundedCornerShape(9.dp)).background(C.accent).pressable({ navigate("home") }, label = "Главная"), contentAlignment = Alignment.Center) {
                Text("S", style = T.Title3, color = C.onAccent)
            }
            Spacer(Modifier.width(12.dp))
            Row(Modifier.weight(1f).height(44.dp).glass(CircleShape, shadow = false).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Search, null, tint = C.text2, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Box(Modifier.weight(1f)) {
                    if (ui.query.isEmpty()) Text("Треки, артисты, альбомы, жанры", style = T.Body, color = C.text3, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    BasicTextField(
                        value = ui.query, onValueChange = vm::setQuery, singleLine = true, textStyle = T.Body.copy(color = C.text),
                        cursorBrush = SolidColor(C.accent),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { vm.submit() }),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus),
                    )
                }
                if (ui.query.isNotEmpty()) Box(Modifier.size(28.dp).pressable({ vm.setQuery("") }, label = "Очистить"), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Close, contentDescription = "Очистить", tint = C.text2, modifier = Modifier.size(18.dp))
                }
            }
        }
        AnimatedContent(ui.query.isBlank(), transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "search") { empty ->
            if (empty) Suggestions(ui, vm, navigate) else Results(ui, vm, app, navigate)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Suggestions(ui: SearchUi, vm: SearchViewModel, navigate: (String) -> Unit) {
    LazyColumn(contentPadding = PaddingValues(bottom = LocalBottomInset.current + 16.dp)) {
        item { Text("Поиск", style = T.DisplayL, color = C.text, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
        if (ui.history.isNotEmpty()) {
            item {
                Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, top = 12.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    MonoLabel("Недавние запросы", Modifier.weight(1f))
                    Text("Очистить", style = T.CaptionBold, color = C.text2, modifier = Modifier.pressable({ vm.clearHistory() }))
                }
            }
            items(ui.history.size) { i -> SuggestionRow(Icons.Filled.History, ui.history[i]) { vm.setQuery(ui.history[i]) } }
        }
        if (ui.popular.isNotEmpty()) {
            item { MonoLabel("Популярное", Modifier.padding(start = 20.dp, top = 16.dp, bottom = 10.dp)) }
            item {
                FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ui.popular.forEach { q ->
                        Row(Modifier.clip(CircleShape).background(C.fg.copy(alpha = 0.06f)).pressable({ vm.setQuery(q) }).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.AutoMirrored.Filled.TrendingUp, null, tint = C.accent, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(q, style = T.CaptionBold, color = C.text)
                        }
                    }
                }
            }
        }
        if (ui.genres.isNotEmpty()) {
            item { MonoLabel("Жанры и настроения", Modifier.padding(start = 20.dp, top = 24.dp, bottom = 10.dp)) }
            items((ui.genres.size + 1) / 2) { row ->
                Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ui.genres.drop(row * 2).take(2).forEachIndexed { j, g ->
                        Box(Modifier.weight(1f)) {
                            androidx.compose.foundation.layout.BoxWithConstraints { GenreTile(g, row * 2 + j, maxWidth) { navigate("genre/${g.slug}") } }
                        }
                    }
                    if (ui.genres.drop(row * 2).size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun SuggestionRow(icon: ImageVector, text: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().pressable(onClick, scaleTo = 0.98f).padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = C.text3, modifier = Modifier.size(20.dp))
        Text(text, modifier = Modifier.padding(start = 16.dp), style = T.BodyL, color = C.text)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@UnstableApi
@Composable
private fun Results(ui: SearchUi, vm: SearchViewModel, app: AppViewModel, navigate: (String) -> Unit) {
    val player by app.player.state.collectAsStateWithLifecycle()
    val ids by app.library.ids.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf("all") }
    var sortOpen by remember { mutableStateOf(false) }
    val r = ui.result
    val open: (String) -> Unit = { vm.submit(); navigate(it) }
    LazyColumn(contentPadding = PaddingValues(bottom = LocalBottomInset.current + 16.dp)) {
        item { Text("«${ui.query.trim()}»", style = T.DisplayL, color = C.text, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
        if (r != null) {
            val albums = r.releases.filter { it.type == "album" || it.type == "compilation" }
            val singles = r.releases - albums.toSet()
            val filters = listOf(
                "all" to ("Всё" to -1), "tracks" to ("Треки" to r.tracks.size), "artists" to ("Артисты" to r.artists.size),
                "albums" to ("Альбомы" to albums.size), "singles" to ("Синглы" to singles.size), "genres" to ("Жанры" to r.genres.size),
                "playlists" to ("Плейлисты" to r.playlists.size),
            )
            item {
                FlowRow(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    filters.forEach { (key, v) ->
                        val (label, n) = v
                        Chip(if (n < 0) label else "$label $n", filter == key, { filter = key }, enabled = n != 0)
                    }
                }
            }
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                    Text("Сортировка", style = T.Body, color = C.text2)
                    Spacer(Modifier.width(10.dp))
                    Box {
                        Row(Modifier.clip(CircleShape).background(C.fg.copy(alpha = 0.06f)).pressable({ sortOpen = true }).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(SORTS.first { it.first == ui.sort }.second, style = T.CaptionBold, color = C.text)
                            Icon(Icons.Filled.KeyboardArrowDown, null, tint = C.text2, modifier = Modifier.size(18.dp))
                        }
                        DropdownMenu(sortOpen, { sortOpen = false }, containerColor = C.elevated) {
                            SORTS.forEach { (key, label) -> DropdownMenuItem(text = { Text(label, style = T.Body, color = C.text) }, onClick = { sortOpen = false; vm.setSort(key) }) }
                        }
                    }
                }
            }
            val nothing = r.tracks.isEmpty() && r.releases.isEmpty() && r.artists.isEmpty() && r.playlists.isEmpty() && r.genres.isEmpty()
            if (nothing) {
                item { Text("По запросу «${ui.query.trim()}» ничего не нашлось. Проверьте написание или попробуйте короче.", style = T.Body, color = C.text2, modifier = Modifier.padding(16.dp)) }
            }
            fun shows(key: String) = filter == "all" || filter == key
            if (shows("tracks") && r.tracks.isNotEmpty()) {
                item { ResultsTitle("Треки") }
                item {
                    val ctx = PlayContext("tracks", null, "Поиск: ${ui.query}")
                    TrackListBox(Modifier.appear()) {
                        r.tracks.take(if (filter == "all") 5 else 30).forEachIndexed { i, t ->
                            TrackRow(t, t.id == player.track?.id, player.isPlaying, app.actions(open, ctx), onPlay = { vm.submit(); app.player.play(r.tracks, i, ctx) }, index = i + 1)
                        }
                    }
                }
            }
            if (shows("artists") && r.artists.isNotEmpty()) {
                item { ResultsTitle("Артисты") }
                item { Shelf(r.artists, { it.id }) { i, a -> ArtistCard(a, a.id in ids.artists, { app.toggle("artists", a.id) }, index = i) { open("artist/${a.id}") } } }
            }
            if (shows("albums") && albums.isNotEmpty()) {
                item { ResultsTitle("Альбомы") }
                item { Shelf(albums, { it.id }) { i, rel -> ReleaseCard(rel, i) { open("album/${rel.id}") } } }
            }
            if (shows("singles") && singles.isNotEmpty()) {
                item { ResultsTitle("Синглы и EP") }
                item { Shelf(singles, { it.id }) { i, rel -> ReleaseCard(rel, i) { open("album/${rel.id}") } } }
            }
            if (shows("genres") && r.genres.isNotEmpty()) {
                item { ResultsTitle("Жанры") }
                item { Shelf(r.genres, { it.id }) { i, g -> GenreTile(g, i) { open("genre/${g.slug}") } } }
            }
            if (shows("playlists") && r.playlists.isNotEmpty()) {
                item { ResultsTitle("Плейлисты") }
                item { Shelf(r.playlists, { it.id }) { i, p -> PlaylistCard(p, i) { open("playlist/${p.id}") } } }
            }
        } else if (ui.loading) {
            item {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { repeat(5) { Skeleton(Modifier.fillMaxWidth().height(56.dp)) } }
            }
        }
        ui.error?.let { e -> item { Text(e, style = T.Body, color = C.text2, modifier = Modifier.padding(16.dp)) } }
    }
}

@Composable
private fun ResultsTitle(text: String) {
    Text(text, style = T.Title1, color = C.text, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 12.dp))
}
