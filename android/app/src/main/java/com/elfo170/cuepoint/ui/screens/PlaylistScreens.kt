package com.elfo170.cuepoint.ui.screens

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.data.PlaylistTrack
import com.elfo170.cuepoint.data.Track
import com.elfo170.cuepoint.ui.ConfirmDialog
import com.elfo170.cuepoint.ui.EmptyState
import com.elfo170.cuepoint.ui.TrackLine
import kotlinx.coroutines.launch

@Composable
fun PlaylistsScreen(onOpen: (String) -> Unit) {
    val app = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val snapshot by app.snapshot.collectAsStateWithLifecycle()
    var creating by remember { mutableStateOf(false) }

    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Playlists", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                IconButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, contentDescription = "Criar playlist") }
            }
        }
        if (snapshot.playlists.isEmpty()) item { EmptyState("Nenhuma playlist ainda.") }
        itemsIndexed(snapshot.playlists, key = { _, p -> p.id }) { _, p ->
            val origin = listOfNotNull(
                p.researchId?.let { id -> snapshot.researches.firstOrNull { it.id == id }?.name },
                p.categoryId?.let { id -> snapshot.categories.firstOrNull { it.id == id }?.name },
            )
            Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).clickable { onOpen(p.id) }) {
                Column(Modifier.padding(16.dp)) {
                    Text(p.name, style = MaterialTheme.typography.titleMedium)
                    Text((listOf("${snapshot.playlistSize(p.id)} música(s)") + origin).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
    if (creating) {
        CreatePlaylistDialog(onDismiss = { creating = false }) { name, researchId, categoryId ->
            creating = false
            scope.launch { app.curation.createPlaylist(name, researchId, categoryId) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreatePlaylistDialog(onDismiss: () -> Unit, onCreate: (String, String?, String?) -> Unit) {
    val app = LocalContext.current.container
    val snapshot by app.snapshot.collectAsStateWithLifecycle()
    var name by remember { mutableStateOf("") }
    var researchId by remember { mutableStateOf<String?>(null) }
    var categoryId by remember { mutableStateOf<String?>(null) }

    @Composable
    fun Picker(label: String, none: String, options: List<Pair<String, String>>, value: String?, onChange: (String?) -> Unit) {
        var open by remember { mutableStateOf(false) }
        ExposedDropdownMenuBox(open, { open = it }) {
            OutlinedTextField(
                options.firstOrNull { it.first == value }?.second ?: none, {}, readOnly = true, label = { Text(label) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
                modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
            )
            ExposedDropdownMenu(open, { open = false }) {
                DropdownMenuItem(text = { Text(none) }, onClick = { open = false; onChange(null) })
                options.forEach { (id, n) -> DropdownMenuItem(text = { Text(n) }, onClick = { open = false; onChange(id) }) }
            }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Nova playlist") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Nome") }, singleLine = true)
                Picker("Origem: pesquisa", "Sem pesquisa (manual)", snapshot.researches.map { it.id to "Aprovadas em ${it.name}" }, researchId) { researchId = it }
                Picker("Origem: categoria", "Qualquer categoria", snapshot.categories.map { it.id to it.name }, categoryId) { categoryId = it }
            }
        },
        confirmButton = { TextButton(onClick = { onCreate(name.trim(), researchId, categoryId) }, enabled = name.isNotBlank()) { Text("Criar") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}

@Composable
fun PlaylistDetailScreen(playlistId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val app = context.container
    val scope = rememberCoroutineScope()
    val snapshot by app.snapshot.collectAsStateWithLifecycle()
    var items by remember { mutableStateOf<List<Pair<PlaylistTrack, Track>>>(emptyList()) }
    var adding by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    val playlist = snapshot.playlists.firstOrNull { it.id == playlistId }
    LaunchedEffect(snapshot) { items = app.curation.playlistItems(playlistId) }
    if (playlist == null) {
        EmptyState("Playlist não encontrada.")
        return
    }

    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(playlist.name, style = MaterialTheme.typography.headlineSmall)
                    Text("${items.size} música(s)", style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = { adding = true }) { Icon(Icons.Filled.Add, contentDescription = "Adicionar música") }
                if (playlist.researchId != null || playlist.categoryId != null) {
                    IconButton(onClick = {
                        scope.launch {
                            val n = app.curation.refreshPlaylistFromSource(playlistId)
                            notice = if (n > 0) "$n música(s) adicionada(s)." else "Nada novo na origem."
                        }
                    }) { Icon(Icons.Filled.Refresh, contentDescription = "Atualizar da origem") }
                }
                IconButton(onClick = {
                    val text = items.joinToString("\n") { (_, t) -> t.url ?: "${t.artist} - ${t.title}" }
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, playlist.name).putExtra(Intent.EXTRA_TEXT, text), "Exportar playlist"))
                }) { Icon(Icons.Filled.Share, contentDescription = "Exportar") }
                IconButton(onClick = { deleting = true }) { Icon(Icons.Filled.Delete, contentDescription = "Excluir playlist") }
            }
            notice?.let { Text(it, modifier = Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall) }
        }
        if (items.isEmpty()) item { EmptyState("Playlist vazia.") }
        itemsIndexed(items, key = { _, it -> it.first.id }) { index, (item, track) ->
            Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${index + 1}", modifier = Modifier.padding(end = 8.dp), style = MaterialTheme.typography.labelMedium)
                TrackLine(track, Modifier.weight(1f))
                IconButton(onClick = { scope.launch { app.curation.movePlaylistItem(playlistId, item.id, index - 1) } }, enabled = index > 0) {
                    Icon(Icons.Filled.ArrowUpward, contentDescription = "Subir")
                }
                IconButton(onClick = { scope.launch { app.curation.movePlaylistItem(playlistId, item.id, index + 1) } }, enabled = index < items.size - 1) {
                    Icon(Icons.Filled.ArrowDownward, contentDescription = "Descer")
                }
                IconButton(onClick = { scope.launch { app.curation.removePlaylistItem(item.id) } }) {
                    Icon(Icons.Filled.Close, contentDescription = "Remover da playlist")
                }
            }
            HorizontalDivider()
        }
    }
    if (adding) {
        var query by remember { mutableStateOf("") }
        val inList = items.map { it.second.id }.toSet()
        val candidates = snapshot.allTracks(query).map { it.track }.filter { it.id !in inList }.take(20)
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text("Adicionar música") },
            text = {
                Column {
                    OutlinedTextField(query, { query = it }, label = { Text("Buscar") }, singleLine = true)
                    candidates.forEach { t ->
                        TrackLine(t, openable = false, modifier = Modifier.fillMaxWidth().clickable {
                            adding = false
                            scope.launch { app.curation.addToPlaylist(playlistId, t.id) }
                        }.padding(vertical = 6.dp))
                    }
                }
            },
            confirmButton = { TextButton(onClick = { adding = false }) { Text("Fechar") } },
        )
    }
    if (deleting) {
        ConfirmDialog("Excluir playlist?", "As músicas continuam na biblioteca.", onDismiss = { deleting = false }) {
            deleting = false
            scope.launch { app.curation.deletePlaylist(playlistId); onBack() }
        }
    }
}
