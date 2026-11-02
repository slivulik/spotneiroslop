package com.sonora.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.animateColorAsState
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.sonora.app.ui.components.Cover
import com.sonora.app.ui.components.TopBar
import com.sonora.app.ui.design.AccentPlayButton
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.HeartButton
import com.sonora.app.ui.design.LiveBackground
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.frosted
import com.sonora.app.ui.design.glass
import com.sonora.app.ui.design.pressable
import com.sonora.app.ui.screens.AlbumScreen
import com.sonora.app.ui.screens.AppViewModel
import com.sonora.app.ui.screens.ArtistScreen
import com.sonora.app.ui.screens.FullPlayer
import com.sonora.app.ui.screens.GenreScreen
import com.sonora.app.ui.screens.HomeScreen
import com.sonora.app.ui.screens.LibraryScreen
import com.sonora.app.ui.screens.LoginScreen
import com.sonora.app.ui.screens.MixScreen
import com.sonora.app.ui.screens.PlaylistScreen
import com.sonora.app.ui.screens.SearchScreen
import com.sonora.app.ui.screens.SettingsScreen
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource

/** Space the floating dock (mini player + nav pill) takes, so lists can scroll clear of it. */
val LocalBottomInset = compositionLocalOf { 110.dp }

/** Shared-element scopes for the cover that flies between the mini player and the full player. */
@OptIn(ExperimentalSharedTransitionApi::class)
class CoverMorph(val shared: SharedTransitionScope, val visibility: AnimatedVisibilityScope)

private data class NavTab(val route: String, val label: String, val icon: ImageVector)

private val TABS = listOf(
    NavTab("home", "Главная", Icons.Filled.Home),
    NavTab("search", "Поиск", Icons.Filled.Search),
    NavTab("library", "Медиатека", Icons.Filled.LibraryMusic),
)

/** The header every page starts with (same as the web TopBar). */
@UnstableApi
@Composable
fun AppTopBar(app: AppViewModel, navigate: (String) -> Unit) {
    val me by app.auth.me.collectAsStateWithLifecycle()
    val signedIn by app.auth.signedIn.collectAsStateWithLifecycle()
    TopBar(navigate, me?.displayName ?: me?.email, signedIn != null) { navigate(if (signedIn != null) "settings" else "login") }
}

@UnstableApi
@OptIn(ExperimentalSharedTransitionApi::class, ExperimentalMaterial3Api::class)
@Composable
fun SonoraAppUi(app: AppViewModel, deepLink: String?, onDeepLinkHandled: () -> Unit) {
    val nav = rememberNavController()
    val haze = remember { HazeState() }
    val snackbar = remember { SnackbarHostState() }
    val player by app.player.state.collectAsStateWithLifecycle()
    var playerOpen by rememberSaveable { mutableStateOf(false) }
    val picking by app.picking.collectAsStateWithLifecycle()
    val playlists by app.playlists.collectAsStateWithLifecycle()
    val navigate: (String) -> Unit = { route ->
        val target = if (route == "home") "home" else route
        nav.navigate(target) { launchSingleTop = true }
    }

    LaunchedEffect(Unit) { app.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(deepLink) {
        // sonora://album/{id}, sonora://artist/{id}, sonora://playlist/{id}
        val link = deepLink ?: return@LaunchedEffect
        val parts = link.removePrefix("sonora://").trim('/').split('/')
        if (parts.size == 2 && parts[0] in setOf("album", "artist", "playlist", "genre", "mix")) navigate("${parts[0]}/${parts[1]}")
        onDeepLinkHandled()
    }

    val hasTrack = player.track != null
    val bottomInset by animateDpAsState(if (hasTrack) 168.dp else 104.dp, spring(stiffness = 300f), label = "inset")

    CompositionLocalProvider(LocalBottomInset provides bottomInset) {
        SharedTransitionLayout(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize().hazeSource(haze)) {
                    LiveBackground(player.track?.release?.artwork?.palette)
                    Routes(nav, app, navigate)
                }
                AnimatedContent(
                    targetState = playerOpen && hasTrack,
                    transitionSpec = { fadeIn(tween(280)) togetherWith fadeOut(tween(220)) },
                    label = "player",
                    modifier = Modifier.fillMaxSize(),
                ) { open ->
                    if (open) {
                        androidx.activity.compose.BackHandler { playerOpen = false }
                        FullPlayer(app, navigate, onClose = { playerOpen = false }, morph = CoverMorph(this@SharedTransitionLayout, this))
                    } else {
                        Box(Modifier.fillMaxSize()) {
                            Column(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(start = 12.dp, end = 12.dp, bottom = 10.dp)) {
                                AnimatedVisibility(hasTrack, enter = slideInVertically { it } + fadeIn(), exit = slideOutVertically { it } + fadeOut()) {
                                    MiniPlayer(app, haze, CoverMorph(this@SharedTransitionLayout, this@AnimatedContent)) { playerOpen = true }
                                }
                                Spacer(Modifier.height(8.dp))
                                NavPill(nav, app, haze)
                            }
                        }
                    }
                }
                SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = bottomInset)) { data ->
                    Box(Modifier.padding(horizontal = 16.dp).glass(CircleShape, strong = true).padding(horizontal = 20.dp, vertical = 12.dp)) {
                        Text(data.visuals.message, style = T.Body, color = C.text)
                    }
                }
            }
        }
    }

    if (picking != null) {
        ModalBottomSheet(onDismissRequest = app::closePicker, containerColor = C.elevated) {
            Text("Добавить в плейлист", style = T.Title3, color = C.text, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            LazyColumn(Modifier.fillMaxWidth().padding(bottom = 32.dp)) {
                item {
                    Row(Modifier.fillMaxWidth().pressable({ app.addToPlaylist(null) }).padding(horizontal = 24.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).background(C.accentMuted), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Add, null, tint = C.accent) }
                        Spacer(Modifier.width(14.dp))
                        Text("Новый плейлист", style = T.BodyBold, color = C.text)
                    }
                }
                items(playlists, key = { it.id }) { p ->
                    Row(Modifier.fillMaxWidth().pressable({ app.addToPlaylist(p) }).padding(horizontal = 24.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Cover(p.artwork ?: p.mosaic.firstOrNull(), 44.dp, seed = p.id)
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text(p.title, style = T.BodyBold, color = C.text)
                            Text("${p.trackCount} треков", style = T.Caption, color = C.text2)
                        }
                    }
                }
            }
        }
    }
}

@UnstableApi
@Composable
private fun Routes(nav: NavHostController, app: AppViewModel, navigate: (String) -> Unit) {
    NavHost(
        nav,
        startDestination = "home",
        enterTransition = { fadeIn(tween(260)) + slideInVertically(spring(dampingRatio = 0.9f, stiffness = 380f)) { it / 20 } },
        exitTransition = { fadeOut(tween(180)) },
        popEnterTransition = { fadeIn(tween(260)) },
        popExitTransition = { fadeOut(tween(180)) + slideOutVertically(tween(220)) { it / 24 } },
    ) {
        composable("home") { HomeScreen(app, navigate) }
        composable("search") { SearchScreen(app, navigate) }
        composable("library") { LibraryScreen(app, navigate) }
        composable("settings") { SettingsScreen(app, navigate) }
        composable("login") { LoginScreen(app, navigate) { nav.popBackStack() } }
        composable("album/{id}") { AlbumScreen(app, navigate) }
        composable("artist/{id}") { ArtistScreen(app, navigate) }
        composable("playlist/{id}") { PlaylistScreen(app, navigate) }
        composable("mix/{key}") { MixScreen(app, navigate) }
        composable("genre/{slug}") { GenreScreen(app, navigate) }
    }
}

/** Floating glass pill with a sliding accent-muted indicator (MobileTabBar.tsx, layoutId="tab-active"). */
@UnstableApi
@Composable
private fun NavPill(nav: NavHostController, app: AppViewModel, haze: HazeState) {
    val back by nav.currentBackStackEntryAsState()
    val me by app.auth.me.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val route = back?.destination?.route
    val selected = TABS.indexOfFirst { it.route == route }.takeIf { it >= 0 }
        ?: when {
            route == null -> 0
            route.startsWith("search") -> 1
            else -> -1
        }
    val admin = me?.role == "admin"
    val count = TABS.size + if (admin) 1 else 0
    BoxWithConstraints(Modifier.fillMaxWidth().height(64.dp).frosted(haze, CircleShape)) {
        val itemWidth: Dp = maxWidth / count
        val x by animateDpAsState(itemWidth * selected.coerceAtLeast(0), spring(dampingRatio = 0.75f, stiffness = 420f), label = "tab")
        if (selected >= 0) {
            Box(Modifier.offset(x = x).width(itemWidth).fillMaxHeight().padding(5.dp).clip(CircleShape).background(C.accentMuted))
        }
        Row(Modifier.fillMaxSize()) {
            TABS.forEachIndexed { i, tab ->
                NavItem(tab.label, tab.icon, i == selected, Modifier.weight(1f)) {
                    nav.navigate(tab.route) {
                        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                }
            }
            if (admin) {
                NavItem("Админ", Icons.Filled.AdminPanelSettings, false, Modifier.weight(1f)) {
                    // The admin panel is the web one; open it in the browser on the same server.
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(app.adminUrl())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }
        }
    }
}

@Composable
private fun NavItem(label: String, icon: ImageVector, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val tint by animateColorAsState(if (active) C.text else C.text2, label = "navTint")
    val iconTint by animateColorAsState(if (active) C.accent else C.text2, label = "navIcon")
    Column(
        modifier.fillMaxHeight().pressable(onClick, scaleTo = 0.9f, role = Role.Tab, label = label),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(24.dp))
        Text(label, style = T.Micro.copy(fontSize = 11.sp, letterSpacing = 0.sp), color = tint, maxLines = 1)
    }
}

/** `.player-surface` dock: cover, marquee title, heart, accent play, next, thin progress line. */
@UnstableApi
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun MiniPlayer(app: AppViewModel, haze: HazeState, morph: CoverMorph, onOpen: () -> Unit) {
    val ui by app.player.state.collectAsStateWithLifecycle()
    val ids by app.library.ids.collectAsStateWithLifecycle()
    val track = ui.track ?: return
    val accent = C.accent
    val progress = if (ui.durationMs > 0) (ui.positionMs.toFloat() / ui.durationMs).coerceIn(0f, 1f) else 0f
    Box(
        Modifier.fillMaxWidth().frosted(haze, RoundedCornerShape(16.dp))
            .drawBehind { drawLine(accent, Offset(0f, size.height - 1.dp.toPx()), Offset(size.width * progress, size.height - 1.dp.toPx()), strokeWidth = 2.dp.toPx()) }
            .pressable(onOpen, scaleTo = 0.985f, label = "Открыть плеер")
            .semantics { contentDescription = "Сейчас играет: ${track.fullTitle}" },
    ) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            with(morph.shared) {
                Cover(
                    track.release.artwork, 44.dp, shape = RoundedCornerShape(8.dp), seed = track.release.id,
                    modifier = Modifier.sharedElement(rememberSharedContentState("now-playing-art"), morph.visibility),
                )
            }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(track.fullTitle, style = T.BodyBold, color = C.text, maxLines = 1, modifier = Modifier.basicMarquee())
                Text(track.artistLine, style = T.Caption, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            HeartButton(track.id in ids.tracks, { app.toggle("tracks", track.id) }, size = 20.dp)
            AccentPlayButton(ui.isPlaying, { app.player.toggle() }, size = 44.dp)
            Box(Modifier.size(40.dp).pressable({ app.player.next() }, scaleTo = 0.85f, label = "Следующий"), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.SkipNext, contentDescription = "Следующий", tint = C.text, modifier = Modifier.size(26.dp))
            }
        }
    }
}
