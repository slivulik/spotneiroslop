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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.sonora.app.data.net.Genre
import com.sonora.app.data.net.SearchResult
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.repo.LibraryRepository
import com.sonora.app.data.repo.userMessage
import com.sonora.app.playback.PlayContext
import com.sonora.app.ui.LocalBottomInset
import com.sonora.app.ui.components.ArtistCircle
import com.sonora.app.ui.components.GenreTile
import com.sonora.app.ui.components.PlaylistCard
import com.sonora.app.ui.components.ReleaseCard
import com.sonora.app.ui.components.Shelf
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.Chip
import com.sonora.app.ui.design.IconBtn
import com.sonora.app.ui.design.S
import com.sonora.app.ui.design.SectionTitle
import com.sonora.app.ui.design.Skeleton
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.press
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

    init {
        viewModelScope.launch {
            val history = runCatching { api.searchHistory().queries }.getOrDefault(emptyList())
            val popular = runCatching { api.popularSearches().queries }.getOrDefault(emptyList())
            val genres = runCatching { api.genres().items }.getOrDefault(emptyList())
            _ui.update { it.copy(history = history, popular = popular, genres = genres) }
        }
    }

    /** Debounced as-you-type search (the server tolerates typos via trigram similarity). */
    fun setQuery(q: String) {
        _ui.update { it.copy(query = q) }
        job?.cancel()
        if (q.isBlank()) return _ui.update { it.copy(result = null, loading = false, error = null) }
        job = viewModelScope.launch {
            delay(250)
            val s = _ui.value
            _ui.update { it.copy(loading = true, error = null) }
            runCatching { api.search(s.query.trim(), 30, s.sort) }
                .onSuccess { r -> _ui.update { it.copy(result = r, loading = false) } }
                .onFailure { e -> _ui.update { it.copy(loading = false, error = e.userMessage(json)) } }
        }
    }

    fun submit() {
        val q = _ui.value.query.trim()
        if (q.length >= 2) library.recordSearch(q)
    }

    fun clearHistory() = viewModelScope.launch {
        runCatching { api.clearSearchHistory() }
        _ui.update { it.copy(history = emptyList()) }
    }
}

@Composable
fun SearchScreen(vm: SearchViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    SearchContent(ui, vm::setQuery, vm::submit) { vm.clearHistory() }
}

@Composable
fun SearchContent(ui: SearchUi, onQuery: (String) -> Unit, onSubmit: () -> Unit, onClearHistory: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.statusBarsPadding().padding(start = S.page, end = S.page, top = S.m, bottom = S.s)) {
            Text("Поиск", style = T.PageTitle, color = C.text)
            Spacer(Modifier.height(S.m))
            Row(Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(8.dp)).background(C.surfaceHigh).padding(start = S.m), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Search, null, tint = C.text2, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(S.s))
                Box(Modifier.weight(1f)) {
                    if (ui.query.isEmpty()) Text("Трек, артист, альбом", style = T.Body, color = C.text3, maxLines = 1)
                    BasicTextField(
                        ui.query, onQuery, singleLine = true, textStyle = T.Body.copy(color = C.text), cursorBrush = SolidColor(C.accent),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { onSubmit() }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (ui.query.isNotEmpty()) IconBtn(Icons.Filled.Close, "Очистить", { onQuery("") }, size = 20.dp)
            }
        }
        if (ui.query.isBlank()) Browse(ui, onQuery, onClearHistory) else Results(ui, onSubmit)
    }
}

@Composable
private fun Browse(ui: SearchUi, onQuery: (String) -> Unit, onClearHistory: () -> Unit) {
    LazyColumn(contentPadding = PaddingValues(bottom = LocalBottomInset.current + S.l)) {
        if (ui.history.isNotEmpty()) {
            item { SectionTitle("Недавние запросы", action = "Очистить", onAction = onClearHistory) }
            items(ui.history.size.coerceAtMost(6)) { i ->
                Row(Modifier.fillMaxWidth().height(48.dp).press({ onQuery(ui.history[i]) }).padding(horizontal = S.page), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.History, null, tint = C.text3, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(S.l))
                    Text(ui.history[i], style = T.Body, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        if (ui.genres.isNotEmpty()) {
            item { SectionTitle("Жанры") }
            items((ui.genres.size + 1) / 2) { row ->
                Row(Modifier.padding(horizontal = S.page).padding(bottom = S.s), horizontalArrangement = Arrangement.spacedBy(S.s)) {
                    val pair = ui.genres.drop(row * 2).take(2)
                    pair.forEach { GenreTile(it, Modifier.weight(1f)) }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun Results(ui: SearchUi, onSubmit: () -> Unit) {
    var filter by rememberSaveable { mutableStateOf("all") }
    val r = ui.result
    if (r == null) {
        if (ui.loading) Column(Modifier.padding(S.page)) {
            repeat(6) {
                Row(Modifier.padding(vertical = S.s), verticalAlignment = Alignment.CenterVertically) {
                    Skeleton(Modifier.size(48.dp)); Spacer(Modifier.width(S.m))
                    Column { Skeleton(Modifier.width(180.dp).height(14.dp)); Spacer(Modifier.height(6.dp)); Skeleton(Modifier.width(110.dp).height(12.dp)) }
                }
            }
        }
        ui.error?.let { Text(it, style = T.Body, color = C.text2, modifier = Modifier.padding(S.page)) }
        return
    }
    val albums = r.releases
    val nothing = r.tracks.isEmpty() && albums.isEmpty() && r.artists.isEmpty() && r.playlists.isEmpty() && r.genres.isEmpty()
    val filters = buildList {
        add("all" to "Всё")
        if (r.tracks.isNotEmpty()) add("tracks" to "Треки")
        if (r.artists.isNotEmpty()) add("artists" to "Артисты")
        if (albums.isNotEmpty()) add("albums" to "Альбомы")
        if (r.playlists.isNotEmpty()) add("playlists" to "Плейлисты")
        if (r.genres.isNotEmpty()) add("genres" to "Жанры")
    }
    fun shows(key: String) = filter == "all" || filter == key
    val ctx = PlayContext("tracks", null, "Поиск: ${ui.query.trim()}")
    LazyColumn(contentPadding = PaddingValues(bottom = LocalBottomInset.current + S.l)) {
        if (nothing) {
            item {
                Column(Modifier.fillMaxWidth().padding(S.xxl), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Ничего не нашлось", style = T.Title, color = C.text)
                    Spacer(Modifier.height(S.xs))
                    Text("Проверьте написание или попробуйте короче", style = T.Caption, color = C.text2)
                }
            }
            return@LazyColumn
        }
        item {
            LazyRow(contentPadding = PaddingValues(horizontal = S.page, vertical = S.s), horizontalArrangement = Arrangement.spacedBy(S.s)) {
                items(filters.size) { i -> Chip(filters[i].second, filter == filters[i].first, { filter = filters[i].first }) }
            }
        }
        if (shows("tracks") && r.tracks.isNotEmpty()) {
            if (filter == "all") item { SectionTitle("Треки") }
            val list = if (filter == "all") r.tracks.take(4) else r.tracks
            items(list.size) { i -> TrackRow(list[i], r.tracks, i, ctx, showAlbum = true) }
        }
        if (shows("artists") && r.artists.isNotEmpty()) {
            item { SectionTitle("Артисты") }
            item { Shelf(r.artists, { it.id }) { ArtistCircle(it) } }
        }
        if (shows("albums") && albums.isNotEmpty()) {
            item { SectionTitle("Альбомы и синглы") }
            item { Shelf(albums, { it.id }) { ReleaseCard(it) } }
        }
        if (shows("playlists") && r.playlists.isNotEmpty()) {
            item { SectionTitle("Плейлисты") }
            item { Shelf(r.playlists, { it.id }) { PlaylistCard(it) } }
        }
        if (shows("genres") && r.genres.isNotEmpty()) {
            item { SectionTitle("Жанры") }
            item { Shelf(r.genres, { it.id }) { GenreTile(it, Modifier.width(160.dp)) } }
        }
    }
}
