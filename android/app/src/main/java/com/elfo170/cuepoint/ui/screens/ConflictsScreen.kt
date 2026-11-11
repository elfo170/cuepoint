package com.elfo170.cuepoint.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.data.ConflictView
import com.elfo170.cuepoint.data.Conflicts
import com.elfo170.cuepoint.ui.EmptyState
import kotlinx.coroutines.launch

private fun fmt(iso: String) = iso.replace('T', ' ').take(16)

/**
 * Conflitos (PRD §5.6): o mesmo dado mudou em dois aparelhos antes de sincronizar. Até o usuário
 * escolher, vale o valor mais recente em todos os aparelhos; a escolha vira uma operação que
 * domina as duas versões e é sincronizada. Espelho da página Conflitos da extensão.
 */
@Composable
fun ConflictsScreen() {
    val app = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val rows by app.db.dao().observeConflicts().collectAsStateWithLifecycle(emptyList())
    val peers by app.db.dao().observePeers().collectAsStateWithLifecycle(emptyList())
    // recalcula quando a tabela de conflitos muda (inclusive ao resolver)
    var conflicts by remember { mutableStateOf<List<ConflictView>?>(null) }
    LaunchedEffect(rows) { conflicts = Conflicts.load(app.store) }
    val names = remember(peers) {
        peers.associate { it.id to if (it.pairing_status == "self") "${it.device_name} (este celular)" else it.device_name }
    }
    var busy by remember { mutableStateOf(false) }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text("Conflitos", style = MaterialTheme.typography.headlineSmall)
            Text(
                "O mesmo dado mudou em dois aparelhos antes de sincronizar. Até você escolher, vale o mais recente.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        val list = conflicts ?: return@LazyColumn
        if (list.isEmpty()) item { EmptyState("Nenhum conflito. Tudo o que foi alterado nos aparelhos combinou sem divergência.") }
        items(list, key = { it.id }) { c ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${c.kind} · ${c.fieldLabel}", style = MaterialTheme.typography.labelMedium)
                    Text(c.subject, style = MaterialTheme.typography.titleMedium)
                    c.options.forEach { o ->
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = if (o.current) MaterialTheme.colorScheme.secondaryContainer
                                else MaterialTheme.colorScheme.surfaceVariant,
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(o.label, style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    o.origins.joinToString { names[it] ?: "aparelho ${it.take(8)}" } +
                                        " · ${fmt(o.at)}" + if (o.current) " · exibido agora" else "",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                OutlinedButton(
                                    enabled = !busy,
                                    onClick = {
                                        busy = true
                                        scope.launch {
                                            try {
                                                app.store.resolve(c.entityType, c.entityId, c.field, o.value)
                                            } finally {
                                                busy = false
                                            }
                                        }
                                    },
                                ) { Text("Manter este") }
                            }
                        }
                    }
                }
            }
        }
    }
}
