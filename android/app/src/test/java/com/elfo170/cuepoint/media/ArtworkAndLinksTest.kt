package com.elfo170.cuepoint.media

import android.app.Application
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ArtworkAndLinksTest {
    @get:Rule val tmp = TemporaryFolder()

    // ------------------------------------------------------------- links

    @Test
    fun urnBecomesSoundCloudAppLink() {
        assertEquals("soundcloud://sounds:123", SoundCloudLinks.appUri("soundcloud:tracks:123"))
        assertNull(SoundCloudLinks.appUri(null))
        assertNull(SoundCloudLinks.appUri("soundcloud:playlists:5"))
        assertNull(SoundCloudLinks.appUri("soundcloud:tracks:abc"))
    }

    @Test
    fun linkCandidatesPreferAppThenWeb() {
        assertEquals(
            listOf("soundcloud://sounds:7", "https://soundcloud.com/dj/faixa"),
            SoundCloudLinks.candidates("soundcloud:tracks:7", "https://m.soundcloud.com/dj/faixa?si=x"),
        )
        assertEquals(listOf("https://soundcloud.com/dj/faixa"), SoundCloudLinks.candidates(null, "https://soundcloud.com/dj/faixa"))
        assertEquals(emptyList<String>(), SoundCloudLinks.candidates(null, "https://example.com/x/y"))
        assertFalse(SoundCloudLinks.canOpen(null, null))
    }

    @Test
    fun openStartsSoundCloudAppIntent() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        // Robolectric não resolve atividades: startActivity é registrado sem ActivityNotFoundException
        assertTrue(SoundCloudLinks.open(app, "soundcloud:tracks:42", null))
        val started = shadowOf(app).nextStartedActivity
        assertEquals(Intent.ACTION_VIEW, started.action)
        assertEquals("soundcloud://sounds:42", started.dataString)
        assertFalse(SoundCloudLinks.open(app, null, null))
    }

    // ------------------------------------------------------------- fonte da capa

    @Test
    fun sessionArtworkWinsOverWebUrl() {
        assertEquals(ArtworkSource.Session, ArtworkCache.chooseSource(true, "https://i1.sndcdn.com/a.jpg"))
        assertEquals(ArtworkSource.Web("https://i1.sndcdn.com/a.jpg"), ArtworkCache.chooseSource(false, "https://i1.sndcdn.com/a.jpg"))
        assertEquals(ArtworkSource.None, ArtworkCache.chooseSource(false, null))
        assertEquals(ArtworkSource.None, ArtworkCache.chooseSource(false, "content://x"))
    }

    @Test
    fun scalingKeepsAspectAndNeverEnlarges() {
        assertEquals(256 to 256, ArtworkCache.scaledSize(1000, 1000, 256))
        assertEquals(256 to 128, ArtworkCache.scaledSize(800, 400, 256))
        assertEquals(100 to 50, ArtworkCache.scaledSize(100, 50, 256))
        assertEquals(1, ArtworkCache.sampleSize(300, 300, 256))
        assertEquals(2, ArtworkCache.sampleSize(600, 600, 256))
        assertEquals(4, ArtworkCache.sampleSize(1200, 1000, 256))
    }

    // ------------------------------------------------------------- cache

    private fun bitmap(w: Int, h: Int) = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }

    private fun jpeg(w: Int, h: Int) = ByteArrayOutputStream().also { bitmap(w, h).compress(Bitmap.CompressFormat.JPEG, 90, it) }.toByteArray()

    @Test
    fun sessionArtworkIsReducedCachedAndNotRewritten() = runBlocking {
        val cache = ArtworkCache(tmp.root, download = { error("não deve baixar") })
        val id = "0190f1c2-aaaa-5bbb-8ccc-000000000001"
        assertFalse(cache.hasSession(id))
        assertTrue(cache.saveSession(id, bitmap(1024, 1024)))
        assertTrue(cache.sessionFile(id).isFile)
        assertEquals(1, cache.version.value)
        assertFalse("segunda gravação é ignorada", cache.saveSession(id, bitmap(64, 64)))
        assertEquals(1, cache.version.value)

        // um cache novo (ex.: app reaberto) lê do arquivo, já reduzido
        val loaded = ArtworkCache(tmp.root, download = { error("não deve baixar") }).load(id, "https://i1.sndcdn.com/x.jpg")
        assertNotNull(loaded)
        assertEquals(256, loaded!!.width)
        assertEquals(256, loaded.height)
    }

    @Test
    fun webArtworkIsDownloadedOnceAndFailuresAreRemembered() = runBlocking {
        var downloads = 0
        val cache = ArtworkCache(tmp.root, download = { url -> downloads++; if (url.contains("ok")) jpeg(500, 500) else null })
        val first = cache.load("sem-capa-local", "https://i1.sndcdn.com/ok-t500x500.jpg")
        assertNotNull(first)
        assertTrue(first!!.width <= 256)
        assertTrue(cache.webFile("https://i1.sndcdn.com/ok-t500x500.jpg").isFile)
        assertNotNull(cache.load("sem-capa-local", "https://i1.sndcdn.com/ok-t500x500.jpg"))
        // outro cache (app reaberto) usa o arquivo, sem baixar de novo
        assertNotNull(ArtworkCache(tmp.root, download = { downloads++; null }).load(null, "https://i1.sndcdn.com/ok-t500x500.jpg"))
        assertEquals(1, downloads)

        assertNull(cache.load(null, "https://i1.sndcdn.com/quebrada.jpg"))
        assertNull(cache.load(null, "https://i1.sndcdn.com/quebrada.jpg"))
        assertEquals(2, downloads)
        assertNull(cache.load(null, null))
    }
}
