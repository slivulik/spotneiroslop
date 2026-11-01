package com.sonora.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.media3.common.util.UnstableApi
import com.sonora.app.data.net.SearchResult
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.repo.LibraryRepository
import com.sonora.app.data.repo.userMessage
import com.sonora.app.playback.PlayContext
import com.sonora.app.ui.components.CardTile
import com.sonora.app.ui.components.SectionTitle
import com.sonora.app.ui.components.Shelf
import com.sonora.app.ui.components.TrackRow
import com.sonora.app.ui.theme.Sonora
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
        _ui.update { it.copy(history = history, popular = popular) }
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
        runCatching { api.search(s.query.trim(), 20, s.sort) }
            .onSuccess { r -> _ui.update { it.copy(result = r, loading = false) } }
            .onFailure { e -> _ui.update { it.copy(loading = false, error = e.userMessage(json)) } }
    }
}

@UnstableApi
@Composable
fun SearchScreen(app: AppViewModel, navigate: (String) -> Unit, vm: SearchViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val player by app.player.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = ui.query,
            onValueChange = vm::setQuery,
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            placeholder = { Text("Треки, артисты, альбомы, жанры") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = { if (ui.query.isNotEmpty()) IconButton(onClick = { vm.setQuery("") }) { Icon(Icons.Filled.Close, contentDescription = "Очистить") } },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { vm.submit() }),
        )
        if (ui.query.isBlank()) {
            Suggestions(ui, vm)
            return@Column
        }
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val sorts = listOf(null to "По релевантности", "popular" to "Популярные", "new" to "Новые")
            items(sorts) { (key, label) -> FilterChip(selected = ui.sort == key, onClick = { vm.setSort(key) }, label = { Text(label) }) }
        }
        when {
            ui.loading && ui.result == null -> Row(Modifier.fillMaxWidth().padding(32.dp), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() }
            ui.error != null -> Text(ui.error!!, modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
            ui.result != null -> Results(ui.result!!, app, navigate, player.track?.id, ui.query, vm::submit)
        }
    }
}

@Composable
private fun Suggestions(ui: SearchUi, vm: SearchViewModel) {
    LazyColumn {
        if (ui.history.isNotEmpty()) {
            item {
                Row(Modifier.fillMaxWidth().padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    SectionTitle("Недавние запросы", modifier = Modifier.weight(1f))
                    TextButton(onClick = { vm.clearHistory() }) { Text("Очистить") }
                }
            }
            items(ui.history) { q -> SuggestionRow(Icons.Filled.History, q) { vm.setQuery(q) } }
        }
        if (ui.popular.isNotEmpty()) {
            item { SectionTitle("Популярное") }
            items(ui.popular) { q -> SuggestionRow(Icons.AutoMirrored.Filled.TrendingUp, q) { vm.setQuery(q) } }
        }
    }
}

@Composable
private fun SuggestionRow(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = Sonora.colors.textTertiary)
        Text(text, modifier = Modifier.padding(start = 16.dp), style = MaterialTheme.typography.bodyLarge)
    }
}

@UnstableApi
@Composable
private fun Results(r: SearchResult, app: AppViewModel, navigate: (String) -> Unit, currentId: String?, query: String, remember: () -> Unit) {
    val open: (String) -> Unit = { remember(); navigate(it) }
    if (r.tracks.isEmpty() && r.releases.isEmpty() && r.artists.isEmpty() && r.playlists.isEmpty() && r.genres.isEmpty()) {
        Text("По запросу «$query» ничего не нашлось. Проверьте написание или попробуйте короче.", modifier = Modifier.padding(16.dp), color = Sonora.colors.textSecondary)
        return
    }
    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
        if (r.artists.isNotEmpty()) {
            item { SectionTitle("Артисты") }
            item { Shelf(r.artists, { it.id }) { a -> CardTile(a.artwork, a.name, "Артист", round = true, width = 112.dp) { open("artist/${a.id}") } } }
        }
        if (r.tracks.isNotEmpty()) {
            item { SectionTitle("Треки") }
            val ctx = PlayContext("tracks", null, "Поиск: $query")
            items(r.tracks.size) { i ->
                val t = r.tracks[i]
                TrackRow(t, t.id == currentId, app.actions(open, ctx), onPlay = { remember(); app.player.play(r.tracks, i, ctx) })
            }
        }
        if (r.releases.isNotEmpty()) {
            item { SectionTitle("Альбомы и синглы") }
            item { Shelf(r.releases, { it.id }) { rel -> CardTile(rel.artwork, rel.title, rel.artists.joinToString(", ") { it.name }) { open("album/${rel.id}") } } }
        }
        if (r.playlists.isNotEmpty()) {
            item { SectionTitle("Плейлисты") }
            item { Shelf(r.playlists, { it.id }) { p -> CardTile(p.artwork ?: p.mosaic.firstOrNull(), p.title, p.ownerName) { open("playlist/${p.id}") } } }
        }
        if (r.genres.isNotEmpty()) {
            item { SectionTitle("Жанры") }
            item { Shelf(r.genres, { it.id }) { g -> CardTile(g.artwork, g.name, null, width = 128.dp) { open("genre/${g.slug}") } } }
        }
    }
}
