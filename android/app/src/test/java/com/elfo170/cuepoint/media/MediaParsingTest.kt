package com.elfo170.cuepoint.media

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MediaParsingTest {
    @Test
    fun parsesMediaSessionMetadata() {
        val t = MediaMetadataParser.parse(" Deep Groove ", "Artist", mediaId = "soundcloud:tracks:123")!!
        assertEquals("Deep Groove", t.title)
        assertEquals("soundcloud:tracks:123", t.urn)
        assertNull(MediaMetadataParser.parse("", "x"))
        assertNull(MediaMetadataParser.parse("Song", "Band", mediaId = "12345")!!.urn) // número solto não é confiável
        assertEquals("soundcloud:tracks:9", MediaMetadataParser.parse("S", "B", mediaUri = "soundcloud://sounds:9")!!.urn)
        assertEquals(
            "https://soundcloud.com/a/b",
            MediaMetadataParser.parse("S", "B", mediaUri = "https://m.soundcloud.com/a/b?si=x")!!.url,
        )
    }

    @Test
    fun parsesSharedText() {
        val pt = MediaMetadataParser.parseShare("Ouça Deep Groove de Fixture Artist no #SoundCloud https://on.soundcloud.com/x https://soundcloud.com/fixture-artist/deep-groove?si=abc", null)!!
        assertEquals("https://soundcloud.com/fixture-artist/deep-groove", pt.url)
        assertEquals("Deep Groove", pt.title)
        assertEquals("Fixture Artist", pt.artist)
        val bare = MediaMetadataParser.parseShare("https://soundcloud.com/some-dj/latin-heat", null)!!
        assertEquals("latin heat", bare.title)
        assertNull(MediaMetadataParser.parseShare("https://example.com/x/y", null))
    }

    @Test
    fun soundCloudUrls() {
        assertNull(SoundCloudUrls.normalizeTrackUrl("https://soundcloud.com/a/sets/b"))
        assertNull(SoundCloudUrls.normalizeTrackUrl("https://soundcloud.com/discover/x"))
        assertEquals("soundcloud:tracks:42", SoundCloudUrls.extractUrnFromHtml("""<meta property="al:ios:url" content="soundcloud://sounds:42">"""))
    }

    @Test
    fun resolverReadsUrnAndMetadataAndCaches() = runTest {
        var calls = 0
        val html = """<meta property="og:title" content="Deep Groove"><meta property="twitter:audio:artist_name" content="Fixture Artist"><meta property="twitter:app:url:googleplay" content="soundcloud://sounds:111">"""
        val r = UrnResolver { calls++; html }
        val page = r.resolve("https://soundcloud.com/a/b")!!
        assertEquals("soundcloud:tracks:111", page.urn)
        assertEquals("Deep Groove", page.title)
        assertEquals("Fixture Artist", page.artist)
        r.resolve("https://soundcloud.com/a/b")
        assertEquals(1, calls)
        assertNull(UrnResolver { error("offline") }.resolve("https://soundcloud.com/a/c"))
    }
}
