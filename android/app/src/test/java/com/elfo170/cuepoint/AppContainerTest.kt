package com.elfo170.cuepoint

import androidx.test.core.app.ApplicationProvider
import com.elfo170.cuepoint.data.TrackInput
import com.elfo170.cuepoint.media.UrnResolver
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AppContainerTest {
    private val page = """<meta property="twitter:app:url:googleplay" content="soundcloud://sounds:555"><meta property="og:title" content="Título Real">"""

    private val opened = mutableListOf<AppContainer>()

    @org.junit.After
    fun tearDown() = opened.forEach { it.close() }

    private fun container() = AppContainer(ApplicationProvider.getApplicationContext(), inMemory = true, resolver = UrnResolver { page }).also { opened += it }

    @Test
    fun notificationActionDecidesCurrentTrackInActiveResearch() = runBlocking {
        val app = container()
        val research = app.curation.createResearch("Latin Bass")
        app.curation.setActiveResearchId(research.id)
        app.setNowPlaying(TrackInput("Deep Groove", "Fixture Artist", urn = "soundcloud:tracks:1"))
        app.decideCurrent(true)
        assertEquals(true, app.currentState.value?.decision)
        app.decideCurrent(false)
        assertEquals(false, app.currentState.value?.decision)
        app.decideCurrent(null)
        assertEquals(null, app.currentState.value?.decision)
    }

    @Test
    fun sharedUrlIsResolvedToUrnAndRealMetadata() = runBlocking {
        val app = container()
        app.setNowPlaying(TrackInput("slug", "dj", url = "https://soundcloud.com/dj/slug", source = "share"))
        val resolved = withTimeout(5000) { app.nowPlaying.filter { it?.urn != null }.first() }!!
        assertEquals("soundcloud:tracks:555", resolved.urn)
        assertEquals("Título Real", resolved.title)
    }
}
