package com.sonora.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.sonora.app.ui.screens.AlbumScreen
import com.sonora.app.ui.screens.AppViewModel
import com.sonora.app.ui.screens.ArtistScreen
import com.sonora.app.ui.screens.FullPlayer
import com.sonora.app.ui.screens.GenreScreen
import com.sonora.app.ui.screens.HomeScreen
import com.sonora.app.ui.screens.LibraryScreen
import com.sonora.app.ui.screens.LoginScreen
import com.sonora.app.ui.screens.MiniPlayer
import com.sonora.app.ui.screens.MixScreen
import com.sonora.app.ui.screens.PlaylistScreen
import com.sonora.app.ui.screens.SearchScreen
import com.sonora.app.ui.screens.SettingsScreen

private data class Tab(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)
private val TABS = listOf(
    Tab("home", "Главная", Icons.Filled.Home),
    Tab("search", "Поиск", Icons.Filled.Search),
    Tab("library", "Медиатека", Icons.Filled.LibraryMusic),
)

@UnstableApi
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun SonoraAppUi(app: AppViewModel, deepLink: String?, onDeepLinkHandled: () -> Unit) {
    val nav = rememberNavController()
    val snackbar = remember { SnackbarHostState() }
    var playerOpen by rememberSaveable { mutableStateOf(false) }
    val picking by app.picking.collectAsStateWithLifecycle()
    val playlists by app.playlists.collectAsStateWithLifecycle()
    val backStack by nav.currentBackStackEntryAsState()
    val navigate: (String) -> Unit = { nav.navigate(it) { launchSingleTop = true } }

    LaunchedEffect(Unit) { app.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(deepLink) {
        // sonora://album/{id}, sonora://artist/{id}, sonora://playlist/{id}, sonora://track/{id}
        val link = deepLink ?: return@LaunchedEffect
        val parts = link.removePrefix("sonora://").trim('/').split('/')
        if (parts.size == 2 && parts[0] in setOf("album", "artist", "playlist", "genre", "mix")) navigate("${parts[0]}/${parts[1]}")
        onDeepLinkHandled()
    }

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                Column {
                    MiniPlayer(app) { playerOpen = true }
                    NavigationBar {
                        TABS.forEach { tab ->
                            NavigationBarItem(
                                selected = backStack?.destination?.hierarchy()?.any { it == tab.route } == true,
                                onClick = {
                                    nav.navigate(tab.route) {
                                        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { Icon(tab.icon, contentDescription = null) },
                                label = { Text(tab.label) },
                            )
                        }
                    }
                }
            },
        ) { padding ->
            NavHost(nav, startDestination = "home", modifier = Modifier.padding(padding)) {
                composable("home") { HomeScreen(app, navigate) }
                composable("search") { SearchScreen(app, navigate) }
                composable("library") { LibraryScreen(app, navigate) }
                composable("settings") { SettingsScreen(app, navigate) }
                composable("login") { LoginScreen(app) { nav.popBackStack() } }
                composable("album/{id}") { AlbumScreen(app, navigate) }
                composable("artist/{id}") { ArtistScreen(app, navigate) }
                composable("playlist/{id}") { PlaylistScreen(app, navigate) }
                composable("mix/{key}") { MixScreen(app, navigate) }
                composable("genre/{slug}") { GenreScreen(app, navigate) }
            }
        }
        AnimatedVisibility(
            visible = playerOpen,
            enter = slideInVertically { it },
            exit = slideOutVertically { it },
            modifier = Modifier.zIndex(1f),
        ) {
            androidx.activity.compose.BackHandler { playerOpen = false }
            androidx.compose.material3.Surface(Modifier.fillMaxSize()) {
                FullPlayer(app, navigate, onClose = { playerOpen = false })
            }
        }
    }

    if (picking != null) {
        ModalBottomSheet(onDismissRequest = app::closePicker) {
            Text("Добавить в плейлист", modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            LazyColumn(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
                item {
                    ListItem(
                        headlineContent = { Text("Новый плейлист") },
                        leadingContent = { Icon(Icons.Filled.Add, contentDescription = null) },
                        modifier = Modifier.clickable { app.addToPlaylist(null) },
                    )
                }
                items(playlists, key = { it.id }) { p ->
                    ListItem(headlineContent = { Text(p.title) }, supportingContent = { Text("${p.trackCount} треков") }, modifier = Modifier.clickable { app.addToPlaylist(p) })
                }
            }
        }
    }
}

private fun androidx.navigation.NavDestination.hierarchy(): Sequence<String?> =
    generateSequence(this) { it.parent }.map { it.route }
