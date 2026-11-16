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
import com.elfo170.cuepoint.core.BackupException
import com.elfo170.cuepoint.core.BackupFile
import com.elfo170.cuepoint.ui.EmptyState
import com.elfo170.cuepoint.ui.Reject
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

private val LABELS = mapOf(
    "track" to "músicas", "research" to "pesquisas", "decision" to "decisões", "category" to "categorias",
    "track_category" to "classificações", "playlist" to "playlists", "playlist_track" to "itens de playlist",
)

private const val FOLDER_LOST = "A pasta de backup não está acessível. Escolha a pasta de novo."
const val BACKUP_INVALID = "Arquivo de backup inválido ou corrompido."
const val BACKUP_WRITE_FAILED = "Não foi possível gravar o backup."
const val BACKUP_OPEN_FAILED = "Não foi possível abrir o arquivo."

/**
 * Mensagem amigável para uma falha de backup/restauração. Mantém as mensagens que já são claras
 * (não é backup, versão não suportada, arquivo/pasta inacessível); as demais validações do núcleo
 * viram [BACKUP_INVALID] e as falhas de gravação viram [BACKUP_WRITE_FAILED]. Outros erros usam
 * o [fallback] da ação.
 */
fun backupErrorText(e: Throwable, fallback: String): String {
    val msg = e.message.orEmpty()
    return when {
        msg == "Não é um backup do CuePoint." || msg.startsWith("Versão de backup não suportada") ||
            msg == BACKUP_OPEN_FAILED || msg == FOLDER_LOST -> msg
        e is BackupException -> BACKUP_INVALID
        msg.startsWith("já existe um backup chamado") || msg.startsWith("não foi possível gravar") ||
            msg.startsWith("não foi possível renomear") -> BACKUP_WRITE_FAILED
        else -> fallback
    }
}

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

    fun act(fallback: String = "Não foi possível concluir. Tente de novo.", block: suspend () -> Unit) = scope.launch {
        error = null
        message = null
        runCatching { block() }.onFailure { error = backupErrorText(it, fallback) }
        refresh++
    }

    val pickFolder = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri: Uri? ->
        if (uri != null) act("Não foi possível usar esta pasta.") { manager.setTree(uri); message = "Pasta de backup definida." }
    }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) act(BACKUP_OPEN_FAILED) { pending = manager.read(uri) }
    }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Backup", style = MaterialTheme.typography.headlineSmall)
        Text(
            "O backup também pode ser restaurado no PC.",
            style = MaterialTheme.typography.bodySmall,
        )

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Pasta", style = MaterialTheme.typography.titleMedium)
                when {
                    folderLost -> Text("Pasta inacessível. Escolha de novo.", color = MaterialTheme.colorScheme.error)
                    folder != null -> Text("Pasta: $folder")
                    else -> Text("Escolha uma pasta para não perder os backups ao desinstalar o app.")
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
                            "Diário e a cada ${settings.everyChanges} alterações.",
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
                Text("Alterações não processadas: $changes", style = MaterialTheme.typography.bodySmall)
                Button(onClick = { act(BACKUP_WRITE_FAILED) { manager.run("manual"); message = "Backup gravado." } }, enabled = !running) {
                    Text(if (running) "Gravando…" else "Fazer backup agora")
                }
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Restaurar", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Escolha um arquivo de backup do CuePoint.",
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
                val kind = when (r.reason) { "manual" -> "manual"; "pre-restore" -> "segurança (antes de restaurar)"; else -> "automático" }
                Text("${formatIso(r.at)} · $kind · ${r.bytes / 1024} KB", style = MaterialTheme.typography.bodyMedium)
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
                    Text(b.counts().filter { (k, v) -> v > 0 && k in LABELS }.entries.joinToString(" · ") { (k, v) -> "$v ${LABELS.getValue(k)}" })
                    Text("A biblioteca atual será substituída (antes é feito um backup de segurança).", color = Reject)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    pending = null
                    act("Não foi possível restaurar o backup.") {
                        manager.restore(b)
                        message = "Backup restaurado."
                    }
                }) { Text("Restaurar", color = Reject) }
            },
            dismissButton = { TextButton(onClick = { pending = null }) { Text("Cancelar") } },
        )
    }
}
