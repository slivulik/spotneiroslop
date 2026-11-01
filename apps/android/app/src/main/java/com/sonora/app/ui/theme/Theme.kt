package com.sonora.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.sonora.app.R
import com.sonora.app.core.designsystem.tokens.SonoraTokens
import com.sonora.app.data.repo.ThemeMode

val Unbounded = FontFamily(Font(R.font.unbounded_600, FontWeight.SemiBold), Font(R.font.unbounded_700, FontWeight.Bold))
val Onest = FontFamily(
    Font(R.font.onest_400, FontWeight.Normal),
    Font(R.font.onest_500, FontWeight.Medium),
    Font(R.font.onest_700, FontWeight.Bold),
)

/** Token colours Material doesn't name (tertiary text, glass, hairlines). */
@Immutable
data class SonoraColors(
    val textSecondary: Color,
    val textTertiary: Color,
    val borderSubtle: Color,
    val accentMuted: Color,
    val elevated: Color,
    val raised: Color,
    val isDark: Boolean,
)

val LocalSonoraColors = staticCompositionLocalOf {
    SonoraColors(Color.Gray, Color.Gray, Color.Gray, Color.Gray, Color.Black, Color.Black, true)
}

private val Dark: ColorScheme = with(SonoraTokens.Colors) {
    darkColorScheme(
        primary = AccentDefault, onPrimary = AccentOn, primaryContainer = AccentMuted, onPrimaryContainer = TextPrimary,
        secondary = AccentHover, onSecondary = AccentOn,
        background = BgBase, onBackground = TextPrimary,
        surface = BgBase, onSurface = TextPrimary, surfaceVariant = BgRaised, onSurfaceVariant = TextSecondary,
        surfaceContainer = BgElevated, surfaceContainerHigh = BgRaised, surfaceContainerHighest = BgOverlay,
        outline = BorderStrong, outlineVariant = BorderDefault,
    )
}

private val Light: ColorScheme = with(SonoraTokens.LightColors) {
    lightColorScheme(
        primary = AccentDefault, onPrimary = AccentOn, primaryContainer = AccentMuted, onPrimaryContainer = TextPrimary,
        secondary = AccentHover, onSecondary = AccentOn,
        background = BgBase, onBackground = TextPrimary,
        surface = BgBase, onSurface = TextPrimary, surfaceVariant = BgRaised, onSurfaceVariant = TextSecondary,
        surfaceContainer = BgElevated, surfaceContainerHigh = BgRaised, surfaceContainerHighest = BgOverlay,
        outline = BorderStrong, outlineVariant = BorderDefault,
    )
}

private fun type(): Typography {
    val base = Typography()
    fun TextStyle.display() = copy(fontFamily = Unbounded, fontWeight = FontWeight.Bold, letterSpacing = (-0.02).sp)
    fun TextStyle.text() = copy(fontFamily = Onest)
    return Typography(
        displayLarge = base.displayLarge.display(), displayMedium = base.displayMedium.display(), displaySmall = base.displaySmall.display(),
        headlineLarge = base.headlineLarge.display(), headlineMedium = base.headlineMedium.display(),
        headlineSmall = base.headlineSmall.copy(fontFamily = Unbounded, fontWeight = FontWeight.SemiBold),
        titleLarge = base.titleLarge.copy(fontFamily = Unbounded, fontWeight = FontWeight.SemiBold, fontSize = 20.sp),
        titleMedium = base.titleMedium.text().copy(fontWeight = FontWeight.Bold),
        titleSmall = base.titleSmall.text().copy(fontWeight = FontWeight.Bold),
        bodyLarge = base.bodyLarge.text(), bodyMedium = base.bodyMedium.text(), bodySmall = base.bodySmall.text(),
        labelLarge = base.labelLarge.text().copy(fontWeight = FontWeight.Bold), labelMedium = base.labelMedium.text(), labelSmall = base.labelSmall.text(),
    )
}

private val Types = type()

@Composable
fun SonoraTheme(mode: ThemeMode, content: @Composable () -> Unit) {
    val dark = when (mode) {
        ThemeMode.Dark -> true
        ThemeMode.Light -> false
        ThemeMode.System -> isSystemInDarkTheme()
    }
    val extra = if (dark) with(SonoraTokens.Colors) {
        SonoraColors(TextSecondary, TextTertiary, BorderSubtle, AccentMuted, BgElevated, BgRaised, true)
    } else with(SonoraTokens.LightColors) {
        SonoraColors(TextSecondary, TextTertiary, BorderSubtle, AccentMuted, BgElevated, BgRaised, false)
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalSonoraColors provides extra) {
        MaterialTheme(colorScheme = if (dark) Dark else Light, typography = Types, content = content)
    }
}

object Sonora {
    val colors: SonoraColors @Composable get() = LocalSonoraColors.current
}
