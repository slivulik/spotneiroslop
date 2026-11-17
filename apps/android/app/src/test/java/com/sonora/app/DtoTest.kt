package com.sonora.app

import com.sonora.app.data.net.Artwork
import com.sonora.app.data.net.DeviceIn
import com.sonora.app.data.net.LoginIn
import com.sonora.app.di.AppModule
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import com.sonora.app.data.net.Track
import com.sonora.app.data.net.WaveFeedbackIn
import com.sonora.app.data.net.WaveSessionOut
import com.sonora.app.data.net.WaveSettings
import com.sonora.app.data.net.WaveStartIn
import com.sonora.app.ui.components.formatDuration
import com.sonora.app.ui.screens.summary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DtoTest {
    private val json = AppModule.json()

    /** Regression: the server requires device.platform; a dropped default made every login fail (422). */
    @Test fun loginRequestCarriesThePlatform() {
        val body = json.encodeToString(LoginIn.serializer(), LoginIn("a@b.c", "pw", DeviceIn(name = "Sonora на Pixel")))
        val device = json.parseToJsonElement(body).jsonObject["device"]!!.jsonObject
        assertEquals("android", device["platform"]!!.jsonPrimitive.content)
        assertTrue("device_id" !in device) // unknown on first login: omitted, not null
    }

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

    /** Wave 2.0 contract: snake_case names, «Любое» (null) omitted rather than sent as null. */
    @Test fun waveStartBodyUsesTheContractNames() {
        val body = json.encodeToString(WaveStartIn.serializer(), WaveStartIn(WaveSettings(mood = "calm"), seedTrack = "t1"))
        val o = json.parseToJsonElement(body).jsonObject
        val settings = o["settings"]!!.jsonObject
        assertEquals("calm", settings["mood"]!!.jsonPrimitive.content)
        assertTrue("character" !in settings)
        assertEquals("t1", o["seed_track"]!!.jsonPrimitive.content)
        assertTrue("seed_artist" !in o)
        assertEquals("20", o["limit"]!!.jsonPrimitive.content)
    }

    @Test fun waveSessionAndTrackLicenseParse() {
        val raw = """{"session_id":"s1","settings":{"character":"discover","mood":null,"language":null},
            "tracks":[{"id":"t1","title":"Приливы","duration_ms":50000,"release":{"id":"r1","title":"Приливы"},
            "license":{"code":"CC BY-SA 4.0","url":"https://creativecommons.org/licenses/by-sa/4.0/","source":"jamendo","source_url":null,"attribution":"Ночной берег"}}]}"""
        val session = json.decodeFromString(WaveSessionOut.serializer(), raw)
        assertEquals("s1", session.sessionId)
        assertEquals(WaveSettings(character = "discover"), session.settings)
        assertEquals("CC BY-SA 4.0", session.tracks.single().license?.code)
        assertEquals("jamendo", session.tracks.single().license?.source)
    }

    @Test fun waveFeedbackOmitsUnknownPlayedTime() {
        assertEquals("""{"track_id":"t1","action":"liked"}""", json.encodeToString(WaveFeedbackIn.serializer(), WaveFeedbackIn("t1", "liked")))
        assertEquals(
            """{"track_id":"t1","action":"skipped","played_ms":12000}""",
            json.encodeToString(WaveFeedbackIn.serializer(), WaveFeedbackIn("t1", "skipped", 12_000)),
        )
    }

    @Test fun waveSettingsSummaryUsesRussianLabels() {
        assertEquals("Под ваш вкус", WaveSettings().summary())
        assertEquals("Незнакомое · Спокойное", WaveSettings(character = "discover", mood = "calm").summary())
        assertEquals("Без слов", WaveSettings(language = "instrumental").summary())
    }

    @Test fun durationsFormatLikeTheWebApp() {
        assertEquals("0:05", formatDuration(5_400))
        assertEquals("6:00", formatDuration(360_000))
        assertEquals("1:01:01", formatDuration(3_661_000))
    }
}
