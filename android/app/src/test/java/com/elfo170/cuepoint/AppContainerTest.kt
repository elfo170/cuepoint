package com.elfo170.cuepoint

import android.Manifest
import androidx.test.core.app.ApplicationProvider
import com.elfo170.cuepoint.data.TrackInput
import com.elfo170.cuepoint.media.CurationNotification
import com.elfo170.cuepoint.media.UrnResolver
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
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

    // ------------------------------------------------- issue #1: notificação dispensada

    private fun notificationShown(): Boolean {
        val manager = ApplicationProvider.getApplicationContext<android.content.Context>()
            .getSystemService(android.app.NotificationManager::class.java)
        return Shadows.shadowOf(manager).getNotification(CurationNotification.NOTIFICATION_ID) != null
    }

    /** A notificação é atualizada em segundo plano: espera o estado esperado (ou falha). */
    private suspend fun awaitShown(expected: Boolean) {
        withTimeout(5000) { while (notificationShown() != expected) delay(20) }
        delay(200) // dá tempo a atualizações atrasadas de mudarem o resultado
        assertEquals(expected, notificationShown())
    }

    private suspend fun playingContainer(): AppContainer {
        Shadows.shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>())
            .grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val app = container()
        val research = app.curation.createResearch("Latin Bass")
        app.curation.setActiveResearchId(research.id)
        app.setNowPlaying(TrackInput("Deep Groove", "Fixture Artist", urn = "soundcloud:tracks:1", source = AppContainer.MEDIA_SESSION_SOURCE))
        awaitShown(true)
        return app
    }

    @Test
    fun dismissedNotificationIsNotRepublishedUntilAppOpens() = runBlocking {
        val app = playingContainer()
        app.setNotificationDismissed(true)
        awaitShown(false)
        assertEquals("1", app.store.getMeta(AppContainer.KEY_NOTIF_DISMISSED))

        // reconexão do serviço de leitura, nova faixa e escrita no banco não a recriam
        app.refreshNotification()
        app.setNowPlaying(TrackInput("Next One", "Other", urn = "soundcloud:tracks:2", source = AppContainer.MEDIA_SESSION_SOURCE))
        app.curation.createResearch("Outra")
        awaitShown(false)

        // abrir o app reativa
        app.setNotificationDismissed(false)
        awaitShown(true)
        assertNull(app.store.getMeta(AppContainer.KEY_NOTIF_DISMISSED))
    }

    @Test
    fun endedSessionClearsMediaTrackButKeepsSharedTrack() = runBlocking {
        val app = playingContainer()
        app.clearMediaSessionTrack()
        assertNull(app.nowPlaying.value)
        awaitShown(false)

        val shared = TrackInput("Shared", "dj", urn = "soundcloud:tracks:9", source = "share")
        app.setNowPlaying(shared)
        app.clearMediaSessionTrack()
        assertEquals(shared, app.nowPlaying.value)
    }
}
