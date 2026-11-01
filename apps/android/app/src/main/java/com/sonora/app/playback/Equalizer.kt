package com.sonora.app.playback

import android.media.audiofx.Equalizer
import android.util.Log
import kotlin.math.abs
import kotlin.math.ln

/**
 * Maps the account's 10-band EQ (31 Hz … 16 kHz, the same bands as the web player) onto the device
 * equalizer, whose band count and centres vary by phone: each device band takes the nearest web band.
 */
class EqualizerController {
    private var eq: Equalizer? = null
    private var sessionId = 0

    fun attach(audioSessionId: Int) {
        if (audioSessionId == sessionId && eq != null) return
        release()
        sessionId = audioSessionId
        eq = runCatching { Equalizer(0, audioSessionId) }.onFailure { Log.w("Sonora", "Equalizer unavailable", it) }.getOrNull()
    }

    fun apply(enabled: Boolean, bandsDb: List<Float>) {
        val e = eq ?: return
        runCatching {
            if (!enabled) {
                e.enabled = false
                return
            }
            val (min, max) = e.bandLevelRange.let { it[0].toInt() to it[1].toInt() }
            for (band in 0 until e.numberOfBands) {
                val hz = e.getCenterFreq(band.toShort()) / 1000.0
                val nearest = BANDS_HZ.indices.minBy { abs(ln(BANDS_HZ[it] / hz)) }
                val level = (bandsDb.getOrElse(nearest) { 0f } * 100).toInt().coerceIn(min, max)
                e.setBandLevel(band.toShort(), level.toShort())
            }
            e.enabled = true
        }.onFailure { Log.w("Sonora", "Equalizer apply failed", it) }
    }

    fun release() {
        eq?.release()
        eq = null
    }

    companion object {
        val BANDS_HZ = doubleArrayOf(31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0)
    }
}
