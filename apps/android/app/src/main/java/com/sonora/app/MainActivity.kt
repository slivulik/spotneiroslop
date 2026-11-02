package com.sonora.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import com.sonora.app.ui.SonoraAppUi
import com.sonora.app.ui.screens.AppViewModel
import com.sonora.app.ui.theme.SonoraTheme
import dagger.hilt.android.AndroidEntryPoint

@UnstableApi
@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val app: AppViewModel by viewModels()
    private var deepLink by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Light status/navigation icons on the dark theme, dark icons on the light one.
        val dark = when (app.settings.initial.theme) {
            com.sonora.app.data.repo.ThemeMode.Dark -> true
            com.sonora.app.data.repo.ThemeMode.Light -> false
            com.sonora.app.data.repo.ThemeMode.System -> (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
        }
        val bars = if (dark) androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
        else androidx.activity.SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
        deepLink = intent?.dataString
        // The playback notification needs this on Android 13+.
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        setContent {
            val settings by app.settings.settings.collectAsStateWithLifecycle()
            SonoraTheme(settings.theme) {
                SonoraAppUi(app, deepLink) { deepLink = null }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        deepLink = intent.dataString
    }
}
