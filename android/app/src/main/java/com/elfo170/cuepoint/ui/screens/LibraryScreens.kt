package com.elfo170.cuepoint.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material.icons.outlined.Label
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
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
import com.elfo170.cuepoint.data.Snapshot
import com.elfo170.cuepoint.ui.Approve
import com.elfo170.cuepoint.ui.CategoryChips
import com.elfo170.cuepoint.ui.ConfirmDialog
import com.elfo170.cuepoint.ui.DecisionButtons
import com.elfo170.cuepoint.ui.EmptyState
import com.elfo170.cuepoint.ui.Reject
import com.elfo170.cuepoint.ui.TextDialog
import com.elfo170.cuepoint.ui.TrackLine
import kotlinx.coroutines.launch

@Composable
private fun SearchField(value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value, onChange, label = { Text("Buscar por título ou artista") }, singleLine = true,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

// ------------------------------------------------------------------ Pesquisas

@Composable
fun ResearchesScreen(onOpen: (String) -> Unit) {
    val app = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val snapshot by app.snapshot.collectAsStateWithLifecycle()
    var creating by remember { mutableStateOf(false) }
    var showArchived by remember { mutableStateOf(false) }
    val summaries = snapshot.summaries(showArchived)

    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Pesquisas", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                IconButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, contentDescription = "Criar pesquisa") }
            }
            if (snapshot.researches.any { it.archived }) {
                Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(showArchived, { showArchived = it })
                    Text("Mostrar arquivadas")
                }
            }
        }
        if (summaries.isEmpty()) item { EmptyState("Nenhuma pesquisa ainda. Crie a primeira pelo +.") }
        items(summaries, key = { it.research.id }) { s ->
            Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).clickable { onOpen(s.research.id) }) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(s.research.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        if (s.research.archived) Icon(Icons.Filled.Archive, contentDescription = "Arquivada")
                    }
                    if (s.research.description.isNotBlank()) Text(s.research.description, style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(top = 8.dp)) {
                        Text("${s.approved} aprovadas", color = Approve)
                        Text("${s.rejected} rejeitadas", color = Reject)
                        Text("${s.pending} sem categoria")
                    }
                }
            }
        }
    }
    if (creating) {
        TextDialog("Nova pesquisa", label = "Nome", confirm = "Criar", onDismiss = { creating = false }) {
            creating = false
            scope.launch { app.curation.createResearch(it) }
        }
    }
}

@Composable
fun ResearchDetailScreen(researchId: String, onBack: () -> Unit) {
    val app = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val snapshot by app.snapshot.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf(Snapshot.Tab.APPROVED) }
    var filter by remember { mutableStateOf(setOf<String>()) }
    var search by remember { mutableStateOf("") }
    var renaming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var editingTrack by remember { mutableStateOf<String?>(null) }
    val research = snapshot.researches.firstOrNull { it.id == researchId }
    if (research == null) {
        EmptyState("Pesquisa não encontrada.")
        return
    }
    val rows = snapshot.researchTracks(researchId, tab, if (tab == Snapshot.Tab.PENDING) emptySet() else filter, search)
    val categoryName = snapshot.categories.associate { it.id to it.name }

    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(research.name, style = MaterialTheme.typography.headlineSmall)
                    if (research.description.isNotBlank()) Text(research.description, style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = { renaming = true }) { Icon(Icons.Filled.Edit, contentDescription = "Renomear") }
                IconButton(onClick = { scope.launch { app.curation.updateResearch(researchId, archived = !research.archived) } }) {
                    Icon(if (research.archived) Icons.Filled.Unarchive else Icons.Filled.Archive, contentDescription = if (research.archived) "Desarquivar" else "Arquivar")
                }
                IconButton(onClick = { deleting = true }) { Icon(Icons.Filled.Delete, contentDescription = "Excluir pesquisa") }
            }
            TabRow(selectedTabIndex = tab.ordinal) {
                listOf("Aprovadas", "Rejeitadas", "Sem categoria").forEachIndexed { i, label ->
                    val t = Snapshot.Tab.entries[i]
                    Tab(selected = tab == t, onClick = { tab = t }, text = { Text("$label (${snapshot.researchTracks(researchId, t).size})") })
                }
            }
            SearchField(search) { search = it }
            if (tab != Snapshot.Tab.PENDING && snapshot.categories.isNotEmpty()) {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    CategoryChips(snapshot.categories, filter) { c -> filter = if (c in filter) filter - c else filter + c }
                }
            }
        }
        if (rows.isEmpty()) item { EmptyState("Nenhuma música nesta visão.") }
        items(rows, key = { it.track.id }) { row ->
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TrackLine(row.track, Modifier.weight(1f))
                    if (row.decision.decision) {
                        IconButton(onClick = { editingTrack = if (editingTrack == row.track.id) null else row.track.id }) {
                            Icon(Icons.Outlined.Label, contentDescription = "Classificar")
                        }
                    }
                    DecisionButtons(row.decision.decision, size = 36, onChange = { v ->
                        scope.launch { app.curation.setDecision(row.track.id, researchId, v) }
                    })
                }
                if (row.categoryIds.isNotEmpty()) {
                    Text(row.categoryIds.mapNotNull(categoryName::get).joinToString(" · "), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 52.dp))
                }
                if (editingTrack == row.track.id) {
                    Column(Modifier.padding(start = 52.dp, top = 4.dp)) {
                        CategoryChips(snapshot.categories, row.categoryIds) { c ->
                            scope.launch { app.curation.setTrackCategory(row.track.id, researchId, c, c !in row.categoryIds) }
                        }
                    }
                }
            }
            HorizontalDivider()
        }
    }
    if (renaming) {
        TextDialog("Renomear pesquisa", initial = research.name, label = "Nome", onDismiss = { renaming = false }) {
            renaming = false
            scope.launch { app.curation.updateResearch(researchId, name = it) }
        }
    }
    if (deleting) {
        ConfirmDialog("Excluir pesquisa?", "As decisões desta pesquisa deixam de aparecer. A exclusão é propagada aos outros aparelhos.", onDismiss = { deleting = false }) {
            deleting = false
            scope.launch { app.curation.deleteResearch(researchId); onBack() }
        }
    }
}

// ------------------------------------------------------------------ Músicas

@Composable
fun TracksScreen() {
    val app = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val snapshot by app.snapshot.collectAsStateWithLifecycle()
    var search by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(setOf<String>()) }
    var expanded by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<String?>(null) }
    val researches = snapshot.researches.filter { !it.archived }
    val rows = snapshot.allTracks(search, filter)

    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Text("Músicas (${snapshot.tracks.size})", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(16.dp))
            SearchField(search) { search = it }
            if (snapshot.categories.isNotEmpty()) {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    CategoryChips(snapshot.categories, filter) { c -> filter = if (c in filter) filter - c else filter + c }
                }
            }
        }
        if (rows.isEmpty()) item { EmptyState("Nenhuma música. As faixas entram na biblioteca ao serem avaliadas.") }
        items(rows, key = { it.track.id }) { row ->
            Column(Modifier.fillMaxWidth().clickable { expanded = if (expanded == row.track.id) null else row.track.id }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                TrackLine(row.track)
                val summary = researches.mapNotNull { r -> row.decisions[r.id]?.let { "${if (it) "✓" else "✗"} ${r.name}" } }
                if (summary.isNotEmpty()) Text(summary.joinToString("   "), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 52.dp, top = 2.dp))
                if (expanded == row.track.id) {
                    researches.forEach { r ->
                        Row(Modifier.padding(start = 52.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(r.name, modifier = Modifier.weight(1f))
                            DecisionButtons(row.decisions[r.id], size = 36, onChange = { v -> scope.launch { app.curation.setDecision(row.track.id, r.id, v) } })
                        }
                    }
                    Row(Modifier.padding(start = 40.dp)) {
                        IconButton(onClick = { deleting = row.track.id }) { Icon(Icons.Filled.Delete, contentDescription = "Excluir música") }
                    }
                }
            }
            HorizontalDivider()
        }
    }
    deleting?.let { id ->
        ConfirmDialog("Excluir música?", "Ela some da biblioteca e de todas as pesquisas.", onDismiss = { deleting = null }) {
            deleting = null
            scope.launch { app.curation.deleteTrack(id) }
        }
    }
}

// ------------------------------------------------------------------ Categorias

@Composable
fun CategoriesScreen() {
    val app = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val snapshot by app.snapshot.collectAsStateWithLifecycle()
    var creating by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<String?>(null) }

    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Categorias", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                IconButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, contentDescription = "Criar categoria") }
            }
        }
        val duplicates = snapshot.categoryDuplicates()
        if (duplicates.isNotEmpty()) item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Categorias com o mesmo nome", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Provavelmente criadas em aparelhos diferentes. Juntar move todas as classificações " +
                            "para a mais antiga e exclui as outras.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    duplicates.forEach { g ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "${g.first().name} (${g.size} categorias, ${g.sumOf { snapshot.categoryUses(it.id) }} classificação(ões))",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedButton(onClick = {
                                scope.launch { app.curation.mergeCategories(g.first().id, g.drop(1).map { it.id }) }
                            }) { Text("Juntar") }
                        }
                    }
                }
            }
        }
        if (snapshot.categories.isEmpty()) item { EmptyState("Nenhuma categoria ainda.") }
        items(snapshot.categories, key = { it.id }) { c ->
            ListItem(
                headlineContent = { Text(c.name) },
                supportingContent = { Text("${snapshot.categoryUses(c.id)} classificação(ões)") },
                trailingContent = {
                    Row {
                        IconButton(onClick = { renaming = c.id }) { Icon(Icons.Filled.Edit, contentDescription = "Renomear ${c.name}") }
                        IconButton(onClick = { deleting = c.id }) { Icon(Icons.Filled.Delete, contentDescription = "Excluir ${c.name}") }
                    }
                },
            )
        }
    }
    if (creating) {
        TextDialog("Nova categoria", label = "Nome", confirm = "Criar", onDismiss = { creating = false }) {
            creating = false
            scope.launch { app.curation.createCategory(it) }
        }
    }
    renaming?.let { id ->
        val c = snapshot.categories.firstOrNull { it.id == id }
        TextDialog("Renomear categoria", initial = c?.name ?: "", label = "Nome", onDismiss = { renaming = null }) {
            renaming = null
            scope.launch { app.curation.updateCategory(id, it, c?.description ?: "") }
        }
    }
    deleting?.let { id ->
        ConfirmDialog("Excluir categoria?", "As classificações com esta categoria também serão removidas.", onDismiss = { deleting = null }) {
            deleting = null
            scope.launch { app.curation.deleteCategory(id) }
        }
    }
}
