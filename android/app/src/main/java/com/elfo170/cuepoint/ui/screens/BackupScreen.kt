package com.elfo170.cuepoint.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.elfo170.cuepoint.backup.BackupRecord
import com.elfo170.cuepoint.backup.BackupSettings
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.core.BackupFile
import com.elfo170.cuepoint.ui.EmptyState
import com.elfo170.cuepoint.ui.Reject
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

private val LABELS = mapOf(
    "track" to "músicas", "research" to "pesquisas", "decision" to "decisões", "category" to "categorias",
    "track_category" to "classificações", "playlist" to "playlists", "playlist_track" to "itens de playlist", "ops" to "operações",
)

private fun formatIso(iso: String): String = runCatching {
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date.from(java.time.Instant.parse(iso)))
}.getOrDefault(iso)

/** Backup e restauração (formato `cuepoint-backup` v1, o mesmo do Chrome). */
@Composable
fun BackupScreen() {
    val context = LocalContext.current
    val app = context.container
    val manager = app.backups
    val scope = rememberCoroutineScope()
    val running by manager.running.collectAsStateWithLifecycle()

    var settings by remember { mutableStateOf(BackupSettings()) }
    var history by remember { mutableStateOf(emptyList<BackupRecord>()) }
    var folder by remember { mutableStateOf<String?>(null) }
    var folderLost by remember { mutableStateOf(false) }
    var changes by remember { mutableIntStateOf(0) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<BackupFile?>(null) }
    var refresh by remember { mutableIntStateOf(0) }

    LaunchedEffect(refresh) {
        settings = manager.settings()
        history = manager.history()
        val tree = manager.treeUri()
        folderLost = tree != null && !manager.treeAccessible()
        folder = if (tree != null && !folderLost) manager.destination().label else null
        changes = manager.changesSinceLast()
    }

    fun act(block: suspend () -> Unit) = scope.launch {
        error = null
        message = null
        runCatching { block() }.onFailure { error = it.message ?: it.toString() }
        refresh++
    }

    val pickFolder = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri: Uri? ->
        if (uri != null) act { manager.setTree(uri); message = "Pasta de backup definida." }
    }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) act { pending = manager.read(uri) }
    }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Backup", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Arquivo único com toda a biblioteca, no mesmo formato do Chrome: um backup do PC pode ser restaurado aqui e vice-versa. Backups antigos nunca são apagados.",
            style = MaterialTheme.typography.bodySmall,
        )

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Pasta", style = MaterialTheme.typography.titleMedium)
                when {
                    folderLost -> Text("A pasta escolhida não está mais acessível. Escolha de novo; até lá, os backups vão para o armazenamento do app.", color = MaterialTheme.colorScheme.error)
                    folder != null -> Text("Gravando em: $folder")
                    else -> Text("Nenhuma pasta escolhida: os backups ficam no armazenamento do app e são apagados se o app for desinstalado.")
                }
                OutlinedButton(onClick = { pickFolder.launch(null) }) { Text(if (folder == null) "Escolher pasta" else "Trocar pasta") }
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Backup automático", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "Diário e a cada ${settings.everyChanges} alterações (só quando houve mudança).",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Switch(settings.enabled, { v ->
                        act {
                            val next = settings.copy(enabled = v)
                            manager.saveSettings(next)
                            app.backupScheduler.apply(next)
                        }
                    })
                }
                Text("Alterações desde o último backup: $changes", style = MaterialTheme.typography.bodySmall)
                Button(onClick = { act { val r = manager.run("manual"); message = "Backup gravado: ${r.filename}" } }, enabled = !running) {
                    Text(if (running) "Gravando…" else "Fazer backup agora")
                }
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Restaurar", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Escolha um arquivo cuepoint-backup (do celular ou do Chrome). Ele é conferido antes (checksum, formato e referências) e um backup de segurança é feito antes de substituir a biblioteca. Este aparelho mantém o próprio id e os pareamentos.",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedButton(onClick = { pickFile.launch(arrayOf("application/json", "application/octet-stream", "text/plain", "*/*")) }, enabled = !running) {
                    Text("Restaurar de um arquivo…")
                }
            }
        }

        message?.let { Text(it) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Text("Histórico", style = MaterialTheme.typography.titleMedium)
        if (history.isEmpty()) EmptyState("Nenhum backup feito ainda.")
        history.take(30).forEach { r ->
            Column(Modifier.padding(vertical = 4.dp)) {
                Text(r.filename, style = MaterialTheme.typography.bodyMedium)
                val kind = when (r.reason) { "manual" -> "manual"; "pre-restore" -> "segurança (antes de restaurar)"; else -> "automático" }
                Text("${formatIso(r.at)} · $kind · ${r.ops} operações · ${r.bytes / 1024} KB · ${r.destination}", style = MaterialTheme.typography.bodySmall)
            }
            HorizontalDivider()
        }
    }

    pending?.let { b ->
        AlertDialog(
            onDismissRequest = { pending = null },
            title = { Text("Restaurar este backup?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Criado em ${formatIso(b.createdAt)}.")
                    Text(b.counts().filterValues { it > 0 }.entries.joinToString(" · ") { (k, v) -> "$v ${LABELS[k] ?: k}" })
                    Text("A biblioteca atual deste celular será substituída por completo (um backup de segurança é feito antes).", color = Reject)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    pending = null
                    act {
                        val safety = manager.restore(b)
                        message = "Backup restaurado. Backup de segurança: ${safety.filename}"
                    }
                }) { Text("Restaurar", color = Reject) }
            },
            dismissButton = { TextButton(onClick = { pending = null }) { Text("Cancelar") } },
        )
    }
}
