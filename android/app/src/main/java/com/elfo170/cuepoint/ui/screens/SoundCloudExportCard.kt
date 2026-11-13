package com.elfo170.cuepoint.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.data.Playlist
import com.elfo170.cuepoint.data.PlaylistTrack
import com.elfo170.cuepoint.data.Track
import com.elfo170.cuepoint.soundcloud.DiffTrack
import com.elfo170.cuepoint.soundcloud.ExportTrack
import com.elfo170.cuepoint.soundcloud.ScDiff
import com.elfo170.cuepoint.soundcloud.ScExportResult
import com.elfo170.cuepoint.soundcloud.ScState
import com.elfo170.cuepoint.soundcloud.ScStatus
import com.elfo170.cuepoint.soundcloud.SkippedTrack
import com.elfo170.cuepoint.ui.ConfirmDialog
import kotlinx.coroutines.launch

/** Faixas da playlist na ordem do CuePoint, no formato que se exporta. */
fun exportTracks(items: List<Pair<PlaylistTrack, Track>>): List<ExportTrack> =
    items.map { (_, t) -> ExportTrack(t.urn, t.url, t.title, t.artist) }

private val WARNING = Color(0xFFB45309)

@Composable
private fun Tracks(title: String, tracks: List<DiffTrack>) {
    if (tracks.isEmpty()) return
    Text(title, fontWeight = FontWeight.SemiBold)
    tracks.forEach { Text("• ${it.title} — ${it.artist}", style = MaterialTheme.typography.bodySmall) }
}

@Composable
private fun Skipped(tracks: List<SkippedTrack>) {
    if (tracks.isEmpty()) return
    Text("Ficam de fora (${tracks.size}):", fontWeight = FontWeight.SemiBold, color = WARNING)
    tracks.forEach { Text("• ${it.title} — ${it.artist} (${it.reasonText})", style = MaterialTheme.typography.bodySmall, color = WARNING) }
}

/** Ações do painel de exportação (todas iniciadas por um toque). */
class ScExportActions(
    val onSettings: () -> Unit = {},
    val onSharing: (String) -> Unit = {},
    val onExport: (urn: String?) -> Unit = {},
    val onPreview: () -> Unit = {},
    val onCancelDiff: () -> Unit = {},
    val onUnlink: () -> Unit = {},
    val onOpen: (String) -> Unit = {},
)

/**
 * "Exportar para o SoundCloud" na página da playlist (Sprint 16.4), com paridade com a extensão.
 * Toda chamada à API parte de um toque. Guarda só o URN da playlist publicada
 * (`external_playlist_id`, sincronizado com o PC).
 */
@Composable
fun SoundCloudExportCard(playlist: Playlist, items: List<Pair<PlaylistTrack, Track>>, onSettings: () -> Unit) {
    val context = LocalContext.current
    val app = context.container
    val sc = app.soundCloud
    val status by sc.status.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var sharing by remember { mutableStateOf("private") }
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var diff by remember(playlist.externalPlaylistId) { mutableStateOf<ScDiff?>(null) }
    var result by remember { mutableStateOf<ScExportResult?>(null) }
    var unlinking by remember { mutableStateOf(false) }
    val linked = playlist.externalPlaylistId
    LaunchedEffect(Unit) { runCatching { sc.refresh() } }

    fun guard(label: String, block: suspend () -> Unit) {
        busy = label
        error = null
        scope.launch {
            try {
                block()
            } catch (e: Exception) {
                error = e.message
            } finally {
                busy = null
            }
        }
    }

    SoundCloudExportPanel(
        status = status,
        linked = linked,
        hasTracks = items.isNotEmpty(),
        sharing = sharing,
        diff = diff,
        result = result,
        busy = busy,
        error = error,
        actions = ScExportActions(
            onSettings = onSettings,
            onSharing = { sharing = it },
            onExport = { urn ->
                guard("Enviando…") {
                    val r = sc.export(urn, playlist.name, playlist.description, sharing, exportTracks(items))
                    if (r.urn != linked) app.curation.setExternalPlaylistId(playlist.id, r.urn)
                    diff = null
                    result = r
                }
            },
            onPreview = {
                val urn = linked
                if (urn != null) {
                    guard("Comparando com o SoundCloud…") {
                        result = null
                        diff = sc.diff(urn, exportTracks(items))
                    }
                }
            },
            onCancelDiff = { diff = null },
            onUnlink = { unlinking = true },
            onOpen = { openInBrowser(context, it) },
        ),
    )
    if (unlinking) {
        ConfirmDialog(
            "Desvincular do SoundCloud?",
            "A playlist continua no SoundCloud; o CuePoint só deixa de atualizá-la (vale também para o PC).",
            confirm = "Desvincular",
            onDismiss = { unlinking = false },
        ) {
            unlinking = false
            scope.launch {
                app.curation.setExternalPlaylistId(playlist.id, null)
                diff = null
                result = null
            }
        }
    }
}

/** Conteúdo do cartão, sem estado próprio (testável sem o container do app). */
@Composable
fun SoundCloudExportPanel(
    status: ScStatus,
    linked: String?,
    hasTracks: Boolean,
    sharing: String,
    diff: ScDiff?,
    result: ScExportResult?,
    busy: String?,
    error: String?,
    actions: ScExportActions,
) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Exportar para o SoundCloud", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                ArtistProBadge()
            }
            when {
                status.state == ScState.UNCONFIGURED -> {
                    Text(
                        "Para criar esta playlist na sua conta do SoundCloud, configure a exportação (exige Artist Pro). " +
                            "Sem isso, use o botão de compartilhar a lista de links.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    OutlinedButton(onClick = actions.onSettings) { Text("Configurar exportação") }
                }
                status.state != ScState.CONNECTED -> {
                    Text(
                        if (status.state == ScState.RECONNECT) "O acesso ao SoundCloud caiu." else "Falta entrar com a sua conta.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    OutlinedButton(onClick = actions.onSettings) { Text("Abrir configuração do SoundCloud") }
                }
                linked == null -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        listOf("private" to "Privada", "public" to "Pública").forEach { (value, label) ->
                            Row(
                                Modifier.selectable(sharing == value, role = Role.RadioButton, onClick = { actions.onSharing(value) })
                                    .padding(end = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                RadioButton(sharing == value, onClick = null)
                                Text(label)
                            }
                        }
                    }
                    Button(onClick = { actions.onExport(null) }, enabled = busy == null && hasTracks) { Text("Exportar para o SoundCloud") }
                }
                else -> {
                    Text("Publicada no SoundCloud ($linked)", style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = actions.onPreview, enabled = busy == null) { Text("Atualizar no SoundCloud") }
                        OutlinedButton(onClick = actions.onUnlink, enabled = busy == null) { Text("Desvincular") }
                    }
                    diff?.let { d ->
                        when {
                            !d.exists -> {
                                Text("Essa playlist não existe mais no SoundCloud (foi apagada ou é de outra conta).", color = WARNING)
                                Button(onClick = { actions.onExport(null) }, enabled = busy == null) { Text("Criar outra") }
                            }
                            d.unchanged -> Text("Nada a mudar: o SoundCloud já tem esta lista, na mesma ordem.")
                            else -> {
                                Text("No SoundCloud hoje: ${d.remoteCount} faixa(s).", style = MaterialTheme.typography.bodySmall)
                                Tracks("Entram (${d.add.size}):", d.add)
                                Tracks("Saem (${d.remove.size}):", d.remove)
                                if (d.reordered) Text("A ordem muda para a do CuePoint.")
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(onClick = { actions.onExport(linked) }, enabled = busy == null) { Text("Confirmar atualização") }
                                    TextButton(onClick = actions.onCancelDiff) { Text("Cancelar") }
                                }
                            }
                        }
                        Skipped(d.skipped)
                    }
                }
            }
            result?.let { r ->
                Text("Pronto: ${r.trackCount} faixa(s) no SoundCloud.", fontWeight = FontWeight.SemiBold)
                if (!r.verified) Text("A lista no SoundCloud ficou diferente da enviada; confira lá.", color = WARNING)
                r.permalinkUrl?.let { url -> TextButton(onClick = { actions.onOpen(url) }) { Text("Abrir no SoundCloud") } }
                Skipped(r.skipped)
            }
            busy?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}
