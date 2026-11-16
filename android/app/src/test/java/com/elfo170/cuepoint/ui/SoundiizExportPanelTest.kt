package com.elfo170.cuepoint.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.elfo170.cuepoint.core.SoundiizProtocol
import com.elfo170.cuepoint.ui.screens.SoundiizExportActions
import com.elfo170.cuepoint.ui.screens.SoundiizExportPanel
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.ZoneOffset

/** Cartão "SoundCloud sem Artist Pro (via Soundiiz)" no celular (Sprint 19): estados e ações. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = android.app.Application::class)
class SoundiizExportPanelTest {
    @get:Rule
    val compose = createComposeRule()

    private val share = "https://soundiiz.com/go/import-playlist/0123456789abcdef0123456789abcdef"
    private val events = mutableListOf<String>()
    private val actions = SoundiizExportActions(
        onExport = { events += "export" },
        onOpen = { events += "open:$it" },
    )

    private fun show(
        trackCount: Int = 3,
        busy: Boolean = false,
        error: String? = null,
        result: SoundiizProtocol.Result.Ok? = null,
    ) = compose.setContent {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            SoundiizExportPanel(trackCount, busy, error, result, actions, zone = ZoneOffset.UTC)
        }
    }

    private fun button() = compose.onNode(hasText("Abrir no Soundiiz") and hasClickAction())

    @Test
    fun warnsAboutMatchingAndExportsOnTap() {
        show()
        compose.onNodeWithText("Gratuito").assertExists()
        compose.onNodeWithText("A correspondência pode errar", substring = true).assertExists()
        button().assertIsEnabled().performScrollTo().performClick()
        assertEquals(listOf("export"), events)
    }

    @Test
    fun emptyPlaylistIsBlocked() {
        show(trackCount = 0)
        compose.onNodeWithText("Playlist vazia: adicione músicas para exportar.").assertExists()
        button().assertIsNotEnabled()
    }

    @Test
    fun moreThan200TracksIsBlockedWithWarning() {
        show(trackCount = 201)
        compose.onNodeWithText(
            "O Soundiiz aceita até 200 músicas por envio; esta playlist tem 201. Divida-a em playlists menores para exportar.",
        ).assertExists()
        button().assertIsNotEnabled()
    }

    @Test
    fun exactly200TracksIsAllowed() {
        show(trackCount = 200)
        button().assertIsEnabled()
    }

    @Test
    fun busyDisablesTheButton() {
        show(busy = true)
        compose.onNodeWithText("Enviando ao Soundiiz…").assertExists()
        button().assertIsNotEnabled()
    }

    @Test
    fun resultShowsValidityAndReopens() {
        show(trackCount = 3, result = SoundiizProtocol.Result.Ok(share, 2, 1782220923L))
        compose.onNodeWithText("Link criado com 2 música(s), válido até 23/06/2026 13:22.").assertExists()
        compose.onNodeWithText("O Soundiiz aceitou 2 de 3 músicas.").assertExists()
        compose.onNodeWithText("Abrir de novo").performScrollTo().performClick()
        assertEquals(listOf("open:$share"), events)
    }

    @Test
    fun errorIsShown() {
        show(error = "O Soundiiz recusou a playlist.")
        compose.onNodeWithText("O Soundiiz recusou a playlist.").assertExists()
    }
}
