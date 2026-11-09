package com.elfo170.cuepoint.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
import com.elfo170.cuepoint.sync.SyncEngine
import com.elfo170.cuepoint.ui.ConfirmDialog
import com.elfo170.cuepoint.ui.EmptyState
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.launch

private fun fmt(iso: String?) = iso?.replace('T', ' ')?.take(16) ?: "—"

/** Pareamento com o PC e estado da sincronização (PRD §4, §5). */
@Composable
fun DevicesScreen() {
    val app = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val peers by app.db.dao().observePeers().collectAsStateWithLifecycle(emptyList())
    val results by app.sync.lastResult.collectAsStateWithLifecycle()
    val pendingUri by app.pendingPairUri.collectAsStateWithLifecycle()
    var pasting by remember { mutableStateOf(false) }
    var pairing by remember { mutableStateOf<SyncEngine.PairingResult?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var revoking by remember { mutableStateOf<String?>(null) }

    fun pair(uri: String) {
        busy = true
        error = null
        scope.launch {
            runCatching { app.syncEngine.pair(uri) }
                .onSuccess { pairing = it }
                .onFailure { error = it.message }
            busy = false
        }
    }
    LaunchedEffect(pendingUri) {
        pendingUri?.let {
            app.pendingPairUri.value = null
            pair(it)
        }
    }
    val scan = androidx.activity.compose.rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let(::pair)
    }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Dispositivos", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Sincronização direta pela rede Wi-Fi local, sem servidor externo. No PC, abra a biblioteca do CuePoint → Dispositivos → Adicionar dispositivo.",
            style = MaterialTheme.typography.bodySmall,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                scan.launch(
                    ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Aponte para o QR do CuePoint no PC").setBeepEnabled(false).setOrientationLocked(false),
                )
            }, enabled = !busy) {
                Icon(Icons.Filled.QrCodeScanner, contentDescription = null)
                Text("  Parear com PC")
            }
            OutlinedButton(onClick = { pasting = true }, enabled = !busy) { Text("Colar código") }
        }
        if (busy) Text("Pareando…")
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        if (peers.none { it.pairing_status != "revoked" }) EmptyState("Nenhum aparelho pareado.")
        peers.filter { it.pairing_status != "revoked" }.forEach { peer ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Computer, contentDescription = null)
                        Text("  ${peer.device_name}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    }
                    Text("Última sincronização: ${fmt(peer.last_sync_at)}", style = MaterialTheme.typography.bodySmall)
                    results[peer.id]?.let { r ->
                        val msg = when (r.status) {
                            "ok" -> "Sincronizado: ${r.received} recebida(s), ${r.sent} enviada(s)"
                            "approval_required" -> "Aguardando aprovação no PC (Biblioteca → Dispositivos → Permitir)"
                            "pending_confirmation" -> "Confirme o pareamento no PC"
                            "revoked" -> "Este aparelho foi revogado no PC"
                            "skipped" -> "Sem endereço conhecido do PC"
                            else -> "Falhou: ${r.error ?: "erro"} (o PC está ligado e na mesma rede?)"
                        }
                        Text(msg, style = MaterialTheme.typography.bodySmall, color = if (r.status == "ok") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Sincronizar automaticamente", modifier = Modifier.weight(1f))
                        Switch(peer.sync_policy == "auto", { auto -> scope.launch { app.syncEngine.setPolicy(peer.id, if (auto) "auto" else "ask") } })
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { scope.launch { app.sync.syncNow(peer.id) } }) {
                            Icon(Icons.Filled.Sync, contentDescription = null)
                            Text("  Sincronizar agora")
                        }
                        TextButton(onClick = { revoking = peer.id }) { Text("Revogar") }
                    }
                }
            }
        }
    }

    if (pasting) {
        var text by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { pasting = false },
            title = { Text("Código de pareamento") },
            text = { OutlinedTextField(text, { text = it }, label = { Text("cuepoint://pair?…") }) },
            confirmButton = { TextButton(onClick = { pasting = false; pair(text.trim()) }, enabled = text.isNotBlank()) { Text("Parear") } },
            dismissButton = { TextButton(onClick = { pasting = false }) { Text("Cancelar") } },
        )
    }
    pairing?.let { p ->
        AlertDialog(
            onDismissRequest = { pairing = null },
            title = { Text("Pareado com ${p.name}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Confira se o PC mostra o mesmo código e toque em \"Confirmar pareamento\" lá:")
                    Text(p.code, style = MaterialTheme.typography.displaySmall)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    pairing = null
                    scope.launch { app.sync.syncNow(p.peerId) }
                }) { Text("Já confirmei no PC") }
            },
        )
    }
    revoking?.let { id ->
        ConfirmDialog("Revogar aparelho?", "As sincronizações com ele param e as credenciais são invalidadas.", confirm = "Revogar", onDismiss = { revoking = null }) {
            revoking = null
            scope.launch { app.syncEngine.revoke(id) }
        }
    }
}
