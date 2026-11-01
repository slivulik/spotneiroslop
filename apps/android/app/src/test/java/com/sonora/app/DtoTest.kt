package com.sonora.app

import com.sonora.app.data.net.Artwork
import com.sonora.app.data.net.Track
import com.sonora.app.ui.components.formatDuration
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DtoTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    @Test fun artworkPicksTheSmallestCoveringSizeAsWebp() {
        val art = Artwork("https://m/x/{size}.{format}", listOf(1200, 160, 600, 320))
        assertEquals("https://m/x/320.webp", art.url(300))
        assertEquals("https://m/x/1200.webp", art.url(5000))
    }

    @Test fun trackParsesTheApiShapeAndIgnoresUnknownFields() {
        val raw = """{"id":"t1","title":"Белые ночи","version":null,"duration_ms":50000,"disc_number":1,"track_number":3,
            "is_explicit":false,"artists":[{"id":"a1","name":"Северное сияние","slug":"s","role":"main"}],
            "release":{"id":"r1","title":"Северное сияние","slug":"s","type":"album","artwork":null},
            "audio":{"hires":false,"lossless":true},"has_lyrics":true,"lyrics_type":"line","has_canvas":false,"playable":true,"future_field":1}"""
        val t = json.decodeFromString(Track.serializer(), raw)
        assertEquals("Северное сияние", t.artistLine)
        assertTrue(t.audio.lossless)
        assertEquals("Белые ночи", t.fullTitle)
    }

    @Test fun durationsFormatLikeTheWebApp() {
        assertEquals("0:05", formatDuration(5_400))
        assertEquals("6:00", formatDuration(360_000))
        assertEquals("1:01:01", formatDuration(3_661_000))
    }
}
