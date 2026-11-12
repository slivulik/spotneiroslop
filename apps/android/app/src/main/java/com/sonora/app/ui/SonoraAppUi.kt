package com.sonora.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.PlaylistPlay
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LibraryMusic
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.sonora.app.data.net.Track
import com.sonora.app.playback.PlayContext
import com.sonora.app.playback.PlayerUi
import com.sonora.app.ui.components.Cover
import com.sonora.app.ui.design.C
import com.sonora.app.ui.design.LocalMotion
import com.sonora.app.ui.design.S
import com.sonora.app.ui.design.T
import com.sonora.app.ui.design.muted
import com.sonora.app.ui.design.press
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
import com.sonora.app.ui.screens.WaveSettingsContent

/** Shared-element scopes for the cover that moves between the mini player and the full player. */
@OptIn(ExperimentalSharedTransitionApi::class)
class CoverMorph(val shared: SharedTransitionScope, val visibility: AnimatedVisibilityScope)

private data class Tab(val route: String, val label: String, val icon: ImageVector, val active: ImageVector)

private val TABS = listOf(
    Tab("home", "Главная", Icons.Outlined.Home, Icons.Filled.Home),
    Tab("search", "Поиск", Icons.Filled.Search, Icons.Filled.Search),
    Tab("library", "Медиатека", Icons.Outlined.LibraryMusic, Icons.Filled.LibraryMusic),
)

@UnstableApi
@OptIn(ExperimentalSharedTransitionApi::class, ExperimentalMaterial3Api::class)
@Composable
fun SonoraAppUi(app: AppViewModel, deepLink: String?, onDeepLinkHandled: () -> Unit) {
    val nav = rememberNavController()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current
    val player by app.player.state.collectAsStateWithLifecycle()
    val ids by app.library.ids.collectAsStateWithLifecycle()
    val signedIn by app.auth.signedIn.collectAsStateWithLifecycle()
    val me by app.auth.me.collectAsStateWithLifecycle()
    val menu by app.menu.collectAsStateWithLifecycle()
    val picking by app.picking.collectAsStateWithLifecycle()
    val playlists by app.playlists.collectAsStateWithLifecycle()
    val waveSheet by app.waveSheet.collectAsStateWithLifecycle()
    val waveSettings by app.waves.settings.collectAsStateWithLifecycle()
    val settings by app.settings.settings.collectAsStateWithLifecycle()
    var playerOpen by rememberSaveable { mutableStateOf(false) }

    val env = Env(
        currentId = player.track?.id,
        currentContext = player.context,
        playing = player.isPlaying,
        likedTracks = ids.tracks.toSet(),
        savedReleases = ids.releases.toSet(),
        followed = ids.artists.toSet(),
        savedPlaylists = ids.playlists.toSet(),
        signedIn = signedIn != null,
        userName = me?.displayName,
        email = me?.email,
        isAdmin = me?.role == "admin",
        playerOpen = playerOpen && player.track != null,
    )
    val actions = remember(app, nav) {
        object : Actions {
            override fun navigate(route: String) = nav.navigate(route) { launchSingleTop = true }
            override fun back() { nav.popBackStack() }
            override fun play(tracks: List<Track>, index: Int, ctx: PlayContext, shuffle: Boolean) = app.player.play(tracks, index, ctx, shuffle)
            override fun togglePlay() = app.player.toggle()
            override fun playWave() { app.playWave() }
            override fun openWaveSettings() = app.openWaveSettings()
            override fun toggleSaved(kind: String, id: String) { app.toggle(kind, id) }
            override fun openTrackMenu(track: Track, ctx: PlayContext) = app.openMenu(track, ctx)
            override fun share(path: String, title: String) = app.share(path, title)
            override fun say(message: String) = app.say(message)
        }
    }

    LaunchedEffect(Unit) { app.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(deepLink) {
        val link = deepLink ?: return@LaunchedEffect
        val parts = link.removePrefix("sonora://").trim('/').split('/')
        if (parts.size == 2 && parts[0] in setOf("album", "artist", "playlist", "genre", "mix")) actions.navigate("${parts[0]}/${parts[1]}")
        onDeepLinkHandled()
    }

    val hasTrack = player.track != null
    CompositionLocalProvider(
        LocalEnv provides env, LocalActions provides actions, LocalBottomInset provides if (hasTrack) 152.dp else 88.dp,
        LocalMotion provides settings.motion,
    ) {
        SharedTransitionLayout(Modifier.fillMaxSize().background(C.bg)) {
            Box(Modifier.fillMaxSize()) {
                Routes(nav, app)
                AnimatedContent(
                    targetState = playerOpen && hasTrack,
                    transitionSpec = { (fadeIn(tween(220)) + slideInVertically(tween(260)) { it / 6 }) togetherWith fadeOut(tween(180)) },
                    label = "player", modifier = Modifier.fillMaxSize(),
                ) { open ->
                    if (open) {
                        androidx.activity.compose.BackHandler { playerOpen = false }
                        FullPlayer(app, onClose = { playerOpen = false }, morph = CoverMorph(this@SharedTransitionLayout, this))
                    } else {
                        Box(Modifier.fillMaxSize()) {
                            Dock(Modifier.align(Alignment.BottomCenter)) {
                                AnimatedVisibility(hasTrack, enter = slideInVertically { it } + fadeIn(), exit = slideOutVertically { it } + fadeOut()) {
                                    MiniPlayer(player, CoverMorph(this@SharedTransitionLayout, this@AnimatedContent), { playerOpen = true })
                                }
                                BottomBar(nav, env.isAdmin) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(app.adminUrl())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                            }
                        }
                    }
                }
                SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = LocalBottomInset.current)) { data ->
                    Box(Modifier.padding(horizontal = S.page).fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(C.text).padding(horizontal = S.l, vertical = S.m)) {
                        Text(data.visuals.message, style = T.Label, color = C.bg)
                    }
                }
            }
        }

        menu?.let { (track, ctx) -> TrackSheet(track, ctx, app) }
        if (waveSheet) {
            ModalBottomSheet(
                onDismissRequest = app::closeWaveSettings,
                sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
                containerColor = C.surface,
            ) {
                WaveSettingsContent(waveSettings, app::setWaveSettings)
            }
        }
        if (picking != null) {
            ModalBottomSheet(onDismissRequest = app::closePicker, containerColor = C.surface) {
                Text("Добавить в плейлист", style = T.Title, color = C.text, modifier = Modifier.padding(horizontal = S.page, vertical = S.s))
                LazyColumn(Modifier.fillMaxWidth().padding(bottom = S.xxl)) {
                    item { SheetRow(Icons.Filled.Add, "Новый плейлист") { app.addToPlaylist(null) } }
                    items(playlists, key = { it.id }) { p ->
                        Row(Modifier.fillMaxWidth().height(64.dp).press({ app.addToPlaylist(p) }).padding(horizontal = S.page), verticalAlignment = Alignment.CenterVertically) {
                            Cover(p.artwork ?: p.mosaic.firstOrNull(), 48.dp, seed = p.id)
                            Spacer(Modifier.width(S.m))
                            Column {
                                Text(p.title, style = T.BodyMedium, color = C.text)
                                Text(com.sonora.app.ui.components.tracksWord(p.trackCount), style = T.Caption, color = C.text2)
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
private fun Routes(nav: NavHostController, app: AppViewModel) {
    val navigate: (String) -> Unit = { nav.navigate(it) { launchSingleTop = true } }
    NavHost(
        nav, startDestination = "home",
        enterTransition = { fadeIn(tween(220)) }, exitTransition = { fadeOut(tween(160)) },
        popEnterTransition = { fadeIn(tween(220)) }, popExitTransition = { fadeOut(tween(160)) },
    ) {
        composable("home") { HomeScreen(app) }
        composable("search") { SearchScreen() }
        composable("library") { LibraryScreen(app) }
        composable("settings") { SettingsScreen(app, navigate) }
        composable("login") { LoginScreen(app) { nav.popBackStack() } }
        composable("album/{id}") { AlbumScreen() }
        composable("artist/{id}") { ArtistScreen() }
        composable("playlist/{id}") { PlaylistScreen() }
        composable("mix/{key}") { MixScreen() }
        composable("genre/{slug}") { GenreScreen() }
    }
}

/** Mini player + bottom bar on one solid ground; a short fade above so scrolling content never shows through. */
@Composable
fun Dock(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val bg = C.bg
    Column(
        modifier.fillMaxWidth().drawBehind {
            val fade = 24.dp.toPx() / size.height
            drawRect(Brush.verticalGradient(0f to bg.copy(alpha = 0f), fade to bg.copy(alpha = 0.96f), 1f to bg))
        }.padding(top = 24.dp),
    ) { content() }
}

/** Full-width bar: icon over label, active in white. */
@Composable
fun BottomBar(nav: NavHostController?, admin: Boolean, selectedOverride: Int? = null, onAdmin: () -> Unit) {
    val back = nav?.currentBackStackEntryAsState()?.value
    val route = back?.destination?.route
    val selected = selectedOverride ?: TABS.indexOfFirst { it.route == route }
    val bg = C.bg
    Row(Modifier.fillMaxWidth().background(bg).padding(top = 4.dp).navigationBarsPadding().height(60.dp)) {
        TABS.forEachIndexed { i, tab ->
            BarItem(tab.label, if (i == selected) tab.active else tab.icon, i == selected, Modifier.weight(1f)) {
                nav?.navigate(tab.route) {
                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                    launchSingleTop = true
                    restoreState = true
                }
            }
        }
        if (admin) BarItem("Админ", Icons.Filled.AdminPanelSettings, false, Modifier.weight(1f), onAdmin)
    }
}

@Composable
private fun BarItem(label: String, icon: ImageVector, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val tint by animateColorAsState(if (active) C.text else C.text3, tween(150), label = "bar")
    Column(modifier.fillMaxHeight().press(onClick, role = Role.Tab, label = label), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(26.dp))
        Spacer(Modifier.height(2.dp))
        Text(label, style = T.Small, color = tint)
    }
}

/** 56-dp card in the cover's colour: art, title/artist, heart, play; thin progress line at the bottom. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun MiniPlayer(ui: PlayerUi, morph: CoverMorph?, onOpen: () -> Unit) {
    val env = LocalEnv.current
    val actions = LocalActions.current
    val track = ui.track ?: return
    val bg by animateColorAsState(muted(track.release.artwork?.palette?.dominant ?: track.release.artwork?.palette?.vibrant, C.surfaceHigh, 0.5f), tween(400), label = "mini")
    val progress = if (ui.durationMs > 0) (ui.positionMs.toFloat() / ui.durationMs).coerceIn(0f, 1f) else 0f
    val line = Color.White
    Box(
        Modifier.padding(horizontal = S.s).fillMaxWidth().height(56.dp).clip(RoundedCornerShape(8.dp)).background(bg)
            .drawBehind {
                val y = size.height - 1.dp.toPx()
                drawLine(line.copy(alpha = 0.25f), Offset(S.s.toPx(), y), Offset(size.width - S.s.toPx(), y), strokeWidth = 2.dp.toPx())
                drawLine(line, Offset(S.s.toPx(), y), Offset(S.s.toPx() + (size.width - 2 * S.s.toPx()) * progress, y), strokeWidth = 2.dp.toPx())
            }
            .press(onOpen, label = "Открыть плеер")
            .semantics { contentDescription = "Сейчас играет: ${track.fullTitle}, ${track.artistLine}" },
    ) {
        Row(Modifier.fillMaxSize().padding(start = S.s), verticalAlignment = Alignment.CenterVertically) {
            val shared = if (morph != null) with(morph.shared) { Modifier.sharedElement(rememberSharedContentState("now-playing-art"), morph.visibility) } else Modifier
            Cover(track.release.artwork, 40.dp, shape = RoundedCornerShape(4.dp), seed = track.release.id, modifier = shared)
            Column(Modifier.weight(1f).padding(horizontal = S.m)) {
                Text(track.fullTitle, style = T.LabelBold, color = Color.White, maxLines = 1, modifier = Modifier.basicMarquee())
                Text(track.artistLine, style = T.Caption, color = Color.White.copy(alpha = 0.7f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            val liked = track.id in env.likedTracks
            Box(Modifier.size(48.dp).press({ actions.toggleSaved("tracks", track.id) }, scale = true, label = if (liked) "Убрать из любимых" else "В любимые"), contentAlignment = Alignment.Center) {
                Icon(if (liked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, null, tint = if (liked) C.accent else Color.White, modifier = Modifier.size(24.dp))
            }
            Box(Modifier.size(48.dp).press(actions::togglePlay, scale = true, label = if (ui.isPlaying) "Пауза" else "Играть"), contentAlignment = Alignment.Center) {
                Icon(if (ui.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size(28.dp))
            }
        }
    }
}

/** Track actions as a bottom sheet with the track on top (Spotify / Яндекс Музыка). */
@UnstableApi
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TrackSheet(track: Track, ctx: PlayContext, app: AppViewModel) {
    val env = LocalEnv.current
    val actions = LocalActions.current
    val close = app::closeMenu
    ModalBottomSheet(onDismissRequest = close, containerColor = C.surface) {
        TrackSheetContent(track, env.likedTracks.contains(track.id)) { action ->
            close()
            when (action) {
                "like" -> actions.toggleSaved("tracks", track.id)
                "next" -> { app.player.playNext(track, ctx); app.say("Будет следующим") }
                "queue" -> { app.player.addToQueue(track, ctx); app.say("Добавлено в очередь") }
                "playlist" -> app.pickPlaylist(track)
                "album" -> actions.navigate("album/${track.release.id}")
                "share" -> actions.share("/track/${track.id}", "${track.fullTitle} — ${track.artistLine}")
                else -> if (action.startsWith("artist:")) actions.navigate("artist/${action.removePrefix("artist:")}")
            }
        }
    }
}

@Composable
fun TrackSheetContent(track: Track, liked: Boolean, onAction: (String) -> Unit) {
    Column(Modifier.padding(bottom = S.xl)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = S.page, vertical = S.s), verticalAlignment = Alignment.CenterVertically) {
            Cover(track.release.artwork, 56.dp, seed = track.release.id)
            Column(Modifier.weight(1f).padding(horizontal = S.m)) {
                Text(track.fullTitle, style = T.Title, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(track.artistLine, style = T.Caption, color = C.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Box(Modifier.padding(vertical = S.s).fillMaxWidth().height(1.dp).background(C.divider))
        SheetRow(if (liked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, if (liked) "Убрать из любимых" else "В любимые", if (liked) C.accent else null) { onAction("like") }
        if (track.playable) {
            SheetRow(Icons.AutoMirrored.Filled.PlaylistPlay, "Слушать следующим") { onAction("next") }
            SheetRow(Icons.AutoMirrored.Filled.QueueMusic, "Добавить в очередь") { onAction("queue") }
        }
        SheetRow(Icons.AutoMirrored.Filled.PlaylistAdd, "Добавить в плейлист") { onAction("playlist") }
        SheetRow(Icons.Filled.Album, "Перейти к альбому") { onAction("album") }
        track.artists.take(2).forEach { a -> SheetRow(Icons.Filled.Person, "Перейти к артисту: ${a.name}") { onAction("artist:${a.id}") } }
        SheetRow(Icons.Filled.IosShare, "Поделиться") { onAction("share") }
    }
}

@Composable
private fun SheetRow(icon: ImageVector, text: String, tint: Color? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(52.dp).press(onClick, label = text).padding(horizontal = S.page), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = tint ?: C.text2, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(S.l))
        Text(text, style = T.Body, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
