package com.elfo170.cuepoint.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elfo170.cuepoint.core.SoundiizProtocol
import com.elfo170.cuepoint.data.Playlist
import com.elfo170.cuepoint.data.PlaylistTrack
import com.elfo170.cuepoint.data.Track
import com.elfo170.cuepoint.soundiiz.SoundiizClient
import com.elfo170.cuepoint.soundiiz.SoundiizTexts
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val WARNING = Color(0xFFB45309)
private val SUCCESS = Color(0xFF047857)

/** Selo da exportação que não depende de Artist Pro. */
@Composable
fun FreeBadge() {
    Text("Gratuito", style = MaterialTheme.typography.labelMedium, color = SUCCESS, fontWeight = FontWeight.SemiBold)
}

/** Faixas da playlist na ordem do CuePoint, no formato do Soundiiz. */
fun soundiizTracks(items: List<Pair<PlaylistTrack, Track>>): List<SoundiizProtocol.TrackInput> =
    items.map { (_, t) -> SoundiizProtocol.TrackInput(t.title, t.artist) }

class SoundiizExportActions(
    val onExport: () -> Unit = {},
    val onOpen: (String) -> Unit = {},
)

/**
 * "SoundCloud via Soundiiz" na página da playlist (Sprint 19), com paridade com
 * a extensão. Sempre visível, abaixo do cartão Artist Pro. Nada do Soundiiz é guardado.
 */
@Composable
fun SoundiizExportCard(playlist: Playlist, items: List<Pair<PlaylistTrack, Track>>) {
    val context = LocalContext.current
    val client = remember { SoundiizClient() }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<SoundiizProtocol.Result.Ok?>(null) }

    SoundiizExportPanel(
        trackCount = items.size,
        busy = busy,
        error = error,
        result = result,
        actions = SoundiizExportActions(
            onExport = {
                busy = true
                error = null
                result = null
                scope.launch {
                    try {
                        when (val r = client.export(playlist.name, playlist.description, soundiizTracks(items))) {
                            is SoundiizProtocol.Result.Ok -> {
                                result = r
                                openInBrowser(context, r.shareUrl) // o link fica no cartão
                            }
                            is SoundiizProtocol.Result.Error -> error = SoundiizTexts.error(r)
                        }
                    } finally {
                        busy = false
                    }
                }
            },
            onOpen = { openInBrowser(context, it) },
        ),
    )
}

private val EXPIRES = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm")

/** Conteúdo do cartão, sem estado próprio (testável sem o container do app). */
@Composable
fun SoundiizExportPanel(
    trackCount: Int,
    busy: Boolean,
    error: String?,
    result: SoundiizProtocol.Result.Ok?,
    actions: SoundiizExportActions,
    zone: ZoneId = ZoneId.systemDefault(),
) {
    val block = SoundiizProtocol.check(trackCount)
    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("SoundCloud via Soundiiz", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                FreeBadge()
            }
            Text(
                "O Soundiiz busca as músicas pelo nome e pode errar a versão. Revise antes de transferir.",
                style = MaterialTheme.typography.bodySmall,
            )
            block?.let { Text(SoundiizTexts.block(it), color = WARNING, style = MaterialTheme.typography.bodySmall) }
            Button(onClick = actions.onExport, enabled = !busy && block == null) { Text("Abrir no Soundiiz") }
            if (busy) Text("Enviando ao Soundiiz…", style = MaterialTheme.typography.bodySmall)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            result?.let { r ->
                val expires = EXPIRES.format(Instant.ofEpochSecond(r.expiresAt).atZone(zone))
                Text("Link criado com ${r.nbTracks} música(s), válido até $expires.", color = SUCCESS, fontWeight = FontWeight.SemiBold)
                if (r.nbTracks < trackCount) Text("O Soundiiz aceitou ${r.nbTracks} de $trackCount músicas.", color = WARNING)
                TextButton(onClick = { actions.onOpen(r.shareUrl) }) { Text("Abrir de novo") }
            }
        }
    }
}
