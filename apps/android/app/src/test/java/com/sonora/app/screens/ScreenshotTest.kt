package com.sonora.app.screens

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import com.sonora.app.data.repo.AppSettings
import com.sonora.app.data.repo.ThemeMode
import com.sonora.app.playback.PlayerUi
import com.sonora.app.ui.BottomBar
import com.sonora.app.ui.Dock
import com.sonora.app.ui.LocalBottomInset
import com.sonora.app.ui.LocalEnv
import com.sonora.app.ui.MiniPlayer
import com.sonora.app.ui.TrackSheetContent
import com.sonora.app.ui.design.C
import com.sonora.app.ui.screens.AlbumContent
import com.sonora.app.ui.screens.ArtistContent
import com.sonora.app.ui.screens.FullPlayerContent
import com.sonora.app.ui.screens.HomeContent
import com.sonora.app.ui.screens.LibraryContent
import com.sonora.app.ui.screens.LoginContent
import com.sonora.app.ui.screens.Panel
import com.sonora.app.ui.screens.PlayerCommands
import com.sonora.app.ui.screens.SearchContent
import com.sonora.app.ui.screens.SettingsCommands
import com.sonora.app.ui.screens.SettingsContent
import com.sonora.app.ui.theme.SonoraTheme
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders every main screen at phone size to PNG files in app/build/outputs/roborazzi.
 * CI publishes them to the `android-screenshots` branch so the design can be reviewed without a device.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w393dp-h851dp-xxhdpi", application = Application::class)
class ScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String, withDock: Boolean = true, ui: PlayerUi? = FakeData.playing, content: @Composable () -> Unit) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            SonoraTheme(ThemeMode.Dark) {
                CompositionLocalProvider(LocalEnv provides FakeData.env, LocalBottomInset provides if (withDock) 152.dp else 0.dp) {
                    Box(Modifier.fillMaxSize().background(C.bg)) {
                        content()
                        if (withDock) {
                            Dock(Modifier.align(Alignment.BottomCenter)) {
                                if (ui != null) MiniPlayer(ui, null) {}
                                BottomBar(null, admin = false, selectedOverride = 0) {}
                            }
                        }
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(800)
        compose.onRoot().captureRoboImage("build/outputs/roborazzi/$name.png")
    }

    private val noPlayer = object : PlayerCommands {
        override fun toggle() = Unit
        override fun next() = Unit
        override fun previous() = Unit
        override fun seekTo(ms: Long) = Unit
        override fun skipTo(index: Int) = Unit
        override fun removeAt(index: Int) = Unit
        override fun setShuffle(on: Boolean) = Unit
        override fun cycleRepeat() = Unit
    }

    private val noSettings = object : SettingsCommands {
        override fun theme(mode: ThemeMode) = Unit
        override fun quality(wifi: String?, cellular: String?) = Unit
        override fun normalization(mode: String) = Unit
        override fun equalizer(enabled: Boolean, preamp: Float, bands: List<Float>) = Unit
        override fun cache(mb: Int) = Unit
        override fun server(url: String) = Unit
        override fun logout() = Unit
        override fun login() = Unit
    }

    @Test fun home() = shot("01-home") { HomeContent(FakeData.home, hour = 21) }
    @Test fun album() = shot("02-album") { AlbumContent(FakeData.album) }
    @Test fun artist() = shot("03-artist") { ArtistContent(FakeData.artistPage) }
    @Test fun searchBrowse() = shot("04-search") { SearchContent(FakeData.searchBrowse, {}, {}, {}) }
    @Test fun searchResults() = shot("05-search-results") { SearchContent(FakeData.searchResult, {}, {}, {}) }
    @Test fun library() = shot("06-library") { LibraryContent(FakeData.library) {} }
    @Test fun player() = shot("07-player", withDock = false) { FullPlayerContent(FakeData.playing, FakeData.lyrics, true, noPlayer, {}) }
    @Test fun lyrics() = shot("08-lyrics", withDock = false) { FullPlayerContent(FakeData.playing, FakeData.lyrics, true, noPlayer, {}, initialPanel = Panel.Lyrics) }
    @Test fun trackMenu() = shot("09-track-menu", withDock = false) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) { Box(Modifier.background(C.surface)) { TrackSheetContent(FakeData.albumTracks[1], liked = false) {} } } }
    @Test fun login() = shot("10-login", withDock = false) { LoginContent { _, _, _, _, _ -> } }
    @Test fun settings() = shot("11-settings", ui = null) { SettingsContent(AppSettings(eqEnabled = true), noSettings) }
}
