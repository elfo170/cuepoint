package com.elfo170.cuepoint.ui

import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.elfo170.cuepoint.soundcloud.DiffTrack
import com.elfo170.cuepoint.soundcloud.ScDiff
import com.elfo170.cuepoint.soundcloud.ScExportResult
import com.elfo170.cuepoint.soundcloud.ScState
import com.elfo170.cuepoint.soundcloud.ScStatus
import com.elfo170.cuepoint.soundcloud.ScUser
import com.elfo170.cuepoint.soundcloud.SkippedTrack
import com.elfo170.cuepoint.ui.screens.ScExportActions
import com.elfo170.cuepoint.ui.screens.SoundCloudExportPanel
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Cartão "Exportar para o SoundCloud" da playlist no celular (Sprint 16.4): estados e ações. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = android.app.Application::class)
class SoundCloudExportPanelTest {
    @get:Rule
    val compose = createComposeRule()

    private val connected = ScStatus(ScState.CONNECTED, "app-••••id", ScUser("dj", null))
    private val linked = "soundcloud:playlists:7"
    private val events = mutableListOf<String>()
    private val actions = ScExportActions(
        onSettings = { events += "settings" },
        onSharing = { events += "sharing:$it" },
        onExport = { events += "export:$it" },
        onPreview = { events += "preview" },
        onCancelDiff = { events += "cancel" },
        onUnlink = { events += "unlink" },
        onOpen = { events += "open:$it" },
    )

    private fun show(
        status: ScStatus = connected,
        link: String? = null,
        hasTracks: Boolean = true,
        diff: ScDiff? = null,
        result: ScExportResult? = null,
        busy: String? = null,
    ) = compose.setContent {
        // como na tela da playlist: o cartão fica numa lista rolável
        Column(Modifier.verticalScroll(rememberScrollState())) {
            SoundCloudExportPanel(status, link, hasTracks, "private", diff, result, busy, null, actions)
        }
    }

    private fun tap(text: String) = compose.onNodeWithText(text).performScrollTo().performClick()

    private fun exportButton() = compose.onNode(hasText("Exportar para o SoundCloud") and hasClickAction())

    @Test
    fun withoutConfigurationPointsToSettings() {
        show(status = ScStatus(ScState.UNCONFIGURED))
        compose.onNodeWithText("Requer Artist Pro").assertExists()
        compose.onNodeWithText("Configurar exportação").performClick()
        assertEquals(listOf("settings"), events)
    }

    @Test
    fun reconnectAndNotConnectedAlsoPointToSettings() {
        show(status = ScStatus(ScState.RECONNECT, "app-••••id"))
        compose.onNodeWithText("O acesso ao SoundCloud caiu.").assertExists()
        compose.onNodeWithText("Abrir configuração do SoundCloud").performClick()
        assertEquals(listOf("settings"), events)
    }

    @Test
    fun unlinkedChoosesVisibilityAndExports() {
        show()
        compose.onNodeWithText("Pública").performClick()
        compose.onNodeWithText("Privada").assertExists()
        // o título e o botão têm o mesmo texto: só o botão é clicável
        exportButton().performClick()
        assertEquals(listOf("sharing:public", "export:null"), events)
    }

    @Test
    fun emptyPlaylistCannotBeExported() {
        show(hasTracks = false)
        exportButton().assertIsNotEnabled()
    }

    @Test
    fun linkedShowsDiffThenConfirms() {
        val diff = ScDiff(
            exists = true,
            add = listOf(DiffTrack("soundcloud:tracks:6", "Nova", "A")),
            remove = listOf(DiffTrack("soundcloud:tracks:3", "Velha", "B")),
            reordered = true,
            remoteCount = 5,
            skipped = listOf(SkippedTrack("Sem link", "D", "sem_link")),
        )
        show(link = linked, diff = diff)
        compose.onNodeWithText("Publicada no SoundCloud ($linked)").assertExists()
        compose.onNodeWithText("Entram (1):").assertExists()
        compose.onNodeWithText("• Nova — A").assertExists()
        compose.onNodeWithText("Saem (1):").assertExists()
        compose.onNodeWithText("A ordem muda para a do CuePoint.").assertExists()
        compose.onNodeWithText("• Sem link — D (sem link do SoundCloud)").assertExists()
        tap("Confirmar atualização")
        tap("Cancelar")
        tap("Atualizar no SoundCloud")
        tap("Desvincular")
        assertEquals(listOf("export:$linked", "cancel", "preview", "unlink"), events)
    }

    @Test
    fun deletedPlaylistOffersCreatingAnother() {
        show(link = linked, diff = ScDiff(false, emptyList(), emptyList(), false, 0, emptyList()))
        compose.onNodeWithText("Essa playlist não existe mais no SoundCloud (foi apagada ou é de outra conta).").assertExists()
        compose.onNodeWithText("Criar outra").performClick()
        assertEquals(listOf("export:null"), events)
    }

    @Test
    fun resultShowsCountWarningAndLink() {
        show(link = linked, result = ScExportResult(linked, "https://soundcloud.com/x/sets/7", 3, emptyList(), verified = false))
        compose.onNodeWithText("Pronto: 3 faixa(s) no SoundCloud.").assertExists()
        compose.onNodeWithText("A lista no SoundCloud ficou diferente da enviada; confira lá.").assertExists()
        compose.onNodeWithText("Abrir no SoundCloud").performClick()
        assertEquals(listOf("open:https://soundcloud.com/x/sets/7"), events)
    }

    @Test
    fun busyDisablesActions() {
        show(link = linked, busy = "Comparando com o SoundCloud…")
        compose.onNodeWithText("Comparando com o SoundCloud…").assertExists()
        compose.onNodeWithText("Atualizar no SoundCloud").assertIsNotEnabled()
    }
}
