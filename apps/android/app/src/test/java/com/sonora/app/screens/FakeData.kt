package com.sonora.app.screens

import com.sonora.app.data.net.ArtistRef
import com.sonora.app.data.net.Artist
import com.sonora.app.data.net.ArtistStats
import com.sonora.app.data.net.ArtistSummary
import com.sonora.app.data.net.AudioBadges
import com.sonora.app.data.net.Genre
import com.sonora.app.data.net.HistoryEntry
import com.sonora.app.data.net.Home
import com.sonora.app.data.net.HomeBlock
import com.sonora.app.data.net.Lyrics
import com.sonora.app.data.net.LyricsLine
import com.sonora.app.data.net.MixSummary
import com.sonora.app.data.net.PlaylistSummary
import com.sonora.app.data.net.Release
import com.sonora.app.data.net.ReleaseRef
import com.sonora.app.data.net.ReleaseSummary
import com.sonora.app.data.net.SearchResult
import com.sonora.app.data.net.Track
import com.sonora.app.data.net.WeeklyPlays
import com.sonora.app.playback.PlayContext
import com.sonora.app.playback.PlayerUi
import com.sonora.app.ui.Env
import com.sonora.app.ui.screens.ArtistPage
import com.sonora.app.ui.screens.HomeData
import com.sonora.app.ui.screens.LibraryData
import com.sonora.app.ui.screens.SearchUi

/** Realistic Russian catalogue for screenshot tests (no network, no artwork files). */
object FakeData {
    private val aurora = ArtistRef("a1", "Аврора Север", "aurora")
    private val shore = ArtistRef("a2", "Ночной берег", "shore")
    private val sonora = ArtistRef("a3", "Сонора Тест", "sonora")
    private val icebreaker = ArtistRef("a4", "Ледокол", "ice", "featured")

    private val northern = ReleaseRef("r1", "Северное сияние", "northern", "album")
    private val tides = ReleaseRef("r2", "Приливы", "tides", "album")
    private val road = ReleaseRef("r3", "Долгая дорога", "road", "single")

    private fun t(id: String, title: String, n: Int, ms: Long, artists: List<ArtistRef>, release: ReleaseRef, hires: Boolean = false, explicit: Boolean = false) =
        Track(id, title, null, ms, 1, n, explicit, artists, release, AudioBadges(hires, true), hasLyrics = true, lyricsType = "line")

    val albumTracks = listOf(
        t("t1", "Северное сияние", 1, 214_000, listOf(aurora), northern, hires = true),
        t("t2", "Полярная ночь", 2, 187_000, listOf(aurora, icebreaker), northern, hires = true),
        t("t3", "Белые ночи", 3, 243_000, listOf(aurora), northern, hires = true),
        t("t4", "Ветер с моря", 4, 201_000, listOf(aurora), northern, hires = true, explicit = true),
        t("t5", "Маяк", 5, 176_000, listOf(aurora), northern, hires = true),
        t("t6", "Снег над заливом", 6, 259_000, listOf(aurora), northern, hires = true),
    )
    val mixed = listOf(
        albumTracks[0],
        t("t7", "Приливы", 1, 232_000, listOf(shore), tides),
        t("t8", "Долгая дорога", 1, 360_000, listOf(sonora), road),
        albumTracks[3],
        t("t9", "Тихий порт", 3, 198_000, listOf(shore), tides),
        albumTracks[1],
    )

    private fun summary(r: ReleaseRef, artist: ArtistRef, date: String, n: Int) = ReleaseSummary(r.id, r.title, r.type, null, listOf(artist), date, n)

    val releases = listOf(
        summary(northern, aurora, "2025-03-14", 6),
        summary(tides, shore, "2024-11-01", 9),
        summary(road, sonora, "2026-01-01", 1),
        ReleaseSummary("r4", "Мираж", "single", null, listOf(sonora), "2026-01-20", 1),
        ReleaseSummary("r5", "Дюна", "ep", null, listOf(sonora), "2025-08-09", 4),
    )
    val artists = listOf(
        ArtistSummary("a1", "Аврора Север", null, true),
        ArtistSummary("a2", "Ночной берег", null),
        ArtistSummary("a3", "Сонора Тест", null),
        ArtistSummary("a4", "Ледокол", null),
    )
    val playlists = listOf(
        PlaylistSummary("p1", "Утро без спешки", "Спокойное начало дня", null, emptyList(), null, 24, "editorial"),
        PlaylistSummary("p2", "В дорогу", null, null, emptyList(), null, 41, "editorial"),
        PlaylistSummary("p3", "Мой плейлист", null, null, emptyList(), null, 12, "user"),
    )
    val genres = listOf(
        Genre("g1", "indie", "Инди", "#3E6BE6"), Genre("g2", "electronic", "Электроника", "#8A3FD1"),
        Genre("g3", "rock", "Рок", "#C2410C"), Genre("g4", "ambient", "Эмбиент", "#0F766E"),
        Genre("g5", "pop", "Поп", "#DB2777"), Genre("g6", "jazz", "Джаз", "#A16207"),
    )

    val home = HomeData(
        home = Home(
            listOf(
                HomeBlock("b1", "releases", "shelf", "Новые релизы", releases = releases),
                HomeBlock("b2", "tracks", "list", "Популярное сейчас", tracks = mixed),
                HomeBlock("b3", "playlists", "shelf", "Подборки Sonora", playlists = playlists.take(2)),
                HomeBlock("b4", "genres", "shelf", "Жанры", genres = genres),
            ),
        ),
        recent = mixed,
        mixes = listOf(MixSummary("discover", "Открытия", "Новое для вас", emptyList(), 30), MixSummary("genre:indie", "Микс: Инди", "Инди и похожее", emptyList(), 30)),
        artists = artists,
        playlists = playlists.filter { it.type == "user" },
    )

    val album = Release(
        "r1", "Северное сияние", "album", "2025-03-14", "Sonora Records", null, listOf(aurora), emptyList(),
        albumTracks.sumOf { it.durationMs }, albumTracks.size, albumTracks,
    )

    val artistPage = ArtistPage(
        Artist("a1", "Аврора Север", "Аврора Север — электронный проект из Мурманска. Холодные синтезаторы, живые барабаны и голос, записанный в старом маяке на берегу Баренцева моря.", null, 12480, true),
        top = albumTracks, releases = releases.take(2) + releases.drop(3), similar = artists.drop(1),
        stats = ArtistStats(12480, 3120, 48210, "2023-05-01", emptyList(), (1..12).map { WeeklyPlays("2026-08-${it.toString().padStart(2, '0')}", listOf(4, 6, 5, 9, 12, 10, 14, 18, 16, 21, 25, 22)[it - 1]) }),
    )

    val library = LibraryData(
        playlists = playlists.filter { it.type == "user" },
        tracks = mixed, releases = releases.take(2), artists = artists.take(2),
        history = mixed.map { HistoryEntry(it, "2026-11-01T20:00:00Z") },
    )

    val searchResult = SearchUi(
        query = "сия",
        result = SearchResult(tracks = listOf(albumTracks[0], albumTracks[2]), releases = releases.take(1), artists = artists.take(1), genres = emptyList()),
    )
    val searchBrowse = SearchUi(history = listOf("Аврора Север", "белые ночи", "инди"), genres = genres)

    val ctx = PlayContext("release", "r1", "Северное сияние")
    val playing = PlayerUi(
        track = albumTracks[2], context = ctx, isPlaying = true, positionMs = 83_000, durationMs = 243_000,
        queue = albumTracks, index = 2,
    )
    val lyrics = Lyrics(
        "line",
        listOf(
            LyricsLine(60_000, 66_000, "Над заливом белые ночи"), LyricsLine(66_000, 72_000, "Город спит, а мы не спим"),
            LyricsLine(72_000, 80_000, "Свет не гаснет до рассвета"), LyricsLine(80_000, 88_000, "Это лето — только с ним"),
            LyricsLine(88_000, 94_000, "Тени тают на граните"), LyricsLine(94_000, 100_000, "Ветер пишет по воде"),
        ),
    )

    val env = Env(
        currentId = "t3", currentContext = ctx, playing = true, likedTracks = setOf("t1", "t3", "t8"), savedReleases = setOf("r1"),
        followed = setOf("a1"), signedIn = true, userName = "Admin", email = "admin@sonora.example",
    )
}
