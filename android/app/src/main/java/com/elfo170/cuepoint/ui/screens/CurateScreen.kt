package com.elfo170.cuepoint.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.core.Ids
import com.elfo170.cuepoint.data.TrackInput
import com.elfo170.cuepoint.media.SoundCloudLinks
import com.elfo170.cuepoint.ui.CategoryChips
import com.elfo170.cuepoint.ui.OpenInSoundCloudButton
import com.elfo170.cuepoint.ui.TrackArtwork
import com.elfo170.cuepoint.ui.DecisionButtons
import com.elfo170.cuepoint.ui.ProvisionalBadge
import com.elfo170.cuepoint.ui.ResearchPicker
import kotlinx.coroutines.launch

/**
 * Tela de curadoria: a faixa atual (da notificação do SoundCloud ou informada manualmente),
 * a pesquisa ativa, ✓/✗ e as categorias da faixa aprovada.
 */
@Composable
fun CurateScreen(extraTop: @Composable () -> Unit = {}) {
    val app = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val snapshot by app.snapshot.collectAsStateWithLifecycle()
    val activeId by app.activeResearchId.collectAsStateWithLifecycle(null)
    val nowPlaying by app.nowPlaying.collectAsStateWithLifecycle()
    val state by app.currentState.collectAsStateWithLifecycle()
    var error by remember { mutableStateOf<String?>(null) }
    var manual by remember { mutableStateOf(false) }

    val researches = snapshot.researches.filter { !it.archived }

    fun act(block: suspend () -> Unit) = scope.launch {
        error = runCatching { block() }.exceptionOrNull()?.message
    }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        extraTop()
        ResearchPicker(
            researches = researches,
            activeId = activeId,
            onSelect = { id -> act { app.curation.setActiveResearchId(id) } },
            onCreate = { name -> act { app.curation.setActiveResearchId(app.curation.createResearch(name).id) } },
        )

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val track = nowPlaying
                if (track == null) {
                    Text("Nenhuma faixa identificada", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Dê play no SoundCloud (com o acesso a notificações liberado) ou informe a faixa manualmente.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                } else {
                    // Capa e link: os da faixa atual ou, como reserva, os já gravados (ex.: vindos do Chrome).
                    val trackId = state?.trackId ?: track.urn?.let(Ids::trackIdFromUrn)
                    val stored = trackId?.let { id -> snapshot.tracks.firstOrNull { it.id == id } }
                    val url = track.url ?: stored?.url
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TrackArtwork(trackId, track.artworkUrl ?: stored?.artworkUrl, 72.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(track.title, style = MaterialTheme.typography.titleLarge)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(track.artist.ifBlank { "—" }, style = MaterialTheme.typography.bodyMedium)
                                if (state?.provisional != false && track.urn == null) {
                                    Spacer(Modifier.padding(4.dp))
                                    ProvisionalBadge()
                                }
                            }
                        }
                    }
                    if (SoundCloudLinks.canOpen(track.urn, url)) {
                        OpenInSoundCloudButton(track.urn, url, Modifier.fillMaxWidth())
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            when (state?.decision) { true -> "Aprovada"; false -> "Rejeitada"; null -> "Não avaliada" },
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.labelLarge,
                        )
                        DecisionButtons(
                            value = state?.decision,
                            enabled = activeId != null,
                            size = 56,
                            onChange = { value -> act { app.decideCurrent(value) } },
                        )
                    }
                    if (activeId == null) Text("Escolha uma pesquisa para classificar.", style = MaterialTheme.typography.bodySmall)
                    if (state?.decision == true) {
                        Text("Categorias", style = MaterialTheme.typography.labelLarge)
                        CategoryChips(snapshot.categories, state?.categoryIds.orEmpty()) { cid ->
                            val rid = activeId ?: return@CategoryChips
                            val tid = state?.trackId ?: return@CategoryChips
                            act {
                                app.curation.setTrackCategory(tid, rid, cid, cid !in state?.categoryIds.orEmpty())
                            }
                        }
                        NewCategoryField { name ->
                            val rid = activeId ?: return@NewCategoryField
                            val tid = state?.trackId ?: return@NewCategoryField
                            act {
                                val c = app.curation.createCategory(name)
                                app.curation.setTrackCategory(tid, rid, c.id, true)
                            }
                        }
                    }
                }
            }
        }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        if (manual) {
            ManualTrackForm(
                onCancel = { manual = false },
                onSubmit = { input ->
                    app.setManualTrack(input)
                    manual = false
                },
            )
        } else {
            OutlinedButton(onClick = { manual = true }, modifier = Modifier.fillMaxWidth()) {
                Text("Informar faixa manualmente")
            }
        }
    }
}

@Composable
fun NewCategoryField(onCreate: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(name, { name = it }, label = { Text("Nova categoria") }, singleLine = true, modifier = Modifier.weight(1f))
        IconButton(onClick = { onCreate(name.trim()); name = "" }, enabled = name.isNotBlank()) {
            Icon(Icons.Filled.Add, contentDescription = "Criar categoria")
        }
    }
}

/** Identificação manual (PRD §12.3/§12.4): título, artista e, opcionalmente, a URL do SoundCloud. */
@Composable
fun ManualTrackForm(onCancel: () -> Unit, onSubmit: (TrackInput) -> Unit, initial: TrackInput? = null) {
    var title by remember { mutableStateOf(initial?.title ?: "") }
    var artist by remember { mutableStateOf(initial?.artist ?: "") }
    var url by remember { mutableStateOf(initial?.url ?: "") }
    val normalized = com.elfo170.cuepoint.media.SoundCloudUrls.normalizeTrackUrl(url)
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Faixa manual", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(title, { title = it }, label = { Text("Título") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(artist, { artist = it }, label = { Text("Artista") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                url, { url = it }, label = { Text("URL no SoundCloud (opcional)") }, singleLine = true,
                isError = url.isNotBlank() && normalized == null, modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { onSubmit(TrackInput(title.trim(), artist.trim(), normalized, source = "manual")) },
                    enabled = title.isNotBlank() && (url.isBlank() || normalized != null),
                ) { Text("Usar esta faixa") }
                OutlinedButton(onClick = onCancel) { Text("Cancelar") }
            }
        }
    }
}
