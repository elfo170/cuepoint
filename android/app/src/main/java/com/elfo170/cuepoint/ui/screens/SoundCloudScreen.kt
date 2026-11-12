package com.elfo170.cuepoint.ui.screens

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.core.SoundCloudProtocol
import com.elfo170.cuepoint.soundcloud.ScState
import com.elfo170.cuepoint.soundcloud.ScStatus
import com.elfo170.cuepoint.ui.ConfirmDialog
import kotlinx.coroutines.launch

/** O que preencher em soundcloud.com/you/apps (igual ao assistente da extensão). */
private val APP_FORM = listOf(
    "Nome do app" to "CuePoint",
    "Descrição" to "Uso pessoal: exporta as minhas playlists de curadoria do CuePoint.",
    "Site / privacidade" to "https://github.com/elfo170/cuepoint/blob/main/docs/PRIVACIDADE.md",
    "Endereço de retorno" to SoundCloudProtocol.REDIRECT_URI,
)
private const val SC_APPS_URL = "https://soundcloud.com/you/apps"

/** Selo exibido em tudo que depende da API do SoundCloud. */
@Composable
fun ArtistProBadge() {
    Text(
        "Requer Artist Pro",
        style = MaterialTheme.typography.labelMedium,
        color = Color(0xFFC2410C),
        fontWeight = FontWeight.SemiBold,
    )
}

internal fun openInBrowser(context: Context, url: String): Boolean = try {
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
} catch (_: ActivityNotFoundException) {
    false
}

/**
 * Configurações → Exportar para o SoundCloud (Sprint 16). Credenciais do app: recebidas do PC
 * (liberação de uso único) ou digitadas. Login próprio deste celular, com retorno local.
 */
@Composable
fun SoundCloudScreen() {
    val context = LocalContext.current
    val app = context.container
    val sc = app.soundCloud
    val status by sc.status.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf(false) }
    var pro by remember { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(Unit) { runCatching { sc.refresh() } }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Exportar para o SoundCloud", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            ArtistProBadge()
        }
        when {
            status.state != ScState.UNCONFIGURED && !editing -> Connection(status, onEdit = { editing = true })
            editing || pro == true -> Setup(onDone = { editing = false }, onCancel = if (editing) ({ editing = false }) else null)
            pro == false -> WithoutPro(onBack = { pro = null })
            else -> {
                Text(
                    "O CuePoint pode criar e atualizar playlists na sua conta do SoundCloud. Para isso, você registra " +
                        "o seu próprio app na API do SoundCloud, o que exige Artist Pro.",
                )
                Text("Você tem Artist Pro?", fontWeight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { pro = true }) { Text("Tenho Artist Pro") }
                    OutlinedButton(onClick = { pro = false }) { Text("Não tenho") }
                }
            }
        }
    }
}

@Composable
private fun WithoutPro(onBack: () -> Unit) {
    Text(
        "Para exportar direto para o SoundCloud, cada pessoa registra o próprio app na API do SoundCloud, " +
            "e o registro exige uma assinatura Artist Pro. Sem ela, o CuePoint não consegue criar playlists na sua conta.",
    )
    Text("Você continua podendo compartilhar qualquer playlist como lista de links, na página da playlist.")
    OutlinedButton(onClick = onBack) { Text("Voltar") }
}

/** Receber do PC (principal) ou digitar o código e a senha do app (alternativa). */
@Composable
private fun Setup(onDone: () -> Unit, onCancel: (() -> Unit)?) {
    val context = LocalContext.current
    val app = context.container
    val scope = rememberCoroutineScope()
    val peers by app.db.dao().observePeers().collectAsStateWithLifecycle(emptyList())
    val pcs = peers.filter { it.pairing_status == "paired" && it.cert_fp != null }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var manual by remember { mutableStateOf(false) }
    var clientId by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }

    fun run(block: suspend () -> Unit) {
        busy = true
        error = null
        scope.launch {
            try {
                block()
                onDone()
            } catch (e: Exception) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Receber do PC", style = MaterialTheme.typography.titleMedium)
            Text(
                "No PC, abra Configurações → Exportar para o SoundCloud → Usar no celular e toque em " +
                    "Enviar para este celular. Depois, em até 10 minutos:",
                style = MaterialTheme.typography.bodySmall,
            )
            if (pcs.isEmpty()) {
                Text("Nenhum PC pareado. Pareie em Configurações → Dispositivos e sincronização.", style = MaterialTheme.typography.bodySmall)
            }
            pcs.forEach { pc ->
                Button(onClick = { run { app.soundCloud.receiveFromPc(pc.id) } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (busy) "Recebendo…" else "Receber de ${pc.device_name}")
                }
            }
            Text(
                "O código e a senha chegam pela conexão cifrada do pareamento e ficam só neste celular, cifrados pelo Android. " +
                    "Nunca vão pela sincronização.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }

    if (!manual) {
        TextButton(onClick = { manual = true }) { Text("Digitar código e senha do app") }
    } else {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Digitar código e senha", style = MaterialTheme.typography.titleMedium)
                Text("1. Abra a página de apps do SoundCloud com a sua conta Artist Pro e registre um app novo.", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { openInBrowser(context, SC_APPS_URL) }) { Text("Abrir soundcloud.com/you/apps") }
                Text("2. Preencha o cadastro com estes valores:", style = MaterialTheme.typography.bodySmall)
                APP_FORM.forEach { (label, value) -> CopyRow(label, value) }
                Text("3. Cole o Client ID e o Client Secret que o SoundCloud mostrar:", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(
                    clientId, { clientId = it }, label = { Text("Código do app (Client ID)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    secret, { secret = it }, label = { Text("Senha do app (Client Secret)") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { run { app.soundCloud.configure(clientId, secret); secret = "" } },
                    enabled = !busy && clientId.isNotBlank() && secret.isNotBlank(),
                ) { Text(if (busy) "Conferindo…" else "Salvar e conferir") }
            }
        }
    }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    onCancel?.let { OutlinedButton(onClick = it) { Text("Cancelar") } }
}

@Composable
private fun CopyRow(label: String, value: String) {
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.labelSmall)
            Text(value, style = MaterialTheme.typography.bodySmall)
        }
        TextButton(onClick = {
            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText(label, value))
            copied = true
        }) { Text(if (copied) "Copiado" else "Copiar") }
    }
}

/** Conectado / entrar / reconectar, mais Desconectar e Remover credenciais. */
@Composable
private fun Connection(status: ScStatus, onEdit: () -> Unit) {
    val context = LocalContext.current
    val sc = context.container.soundCloud
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var forgetting by remember { mutableStateOf(false) }

    fun run(block: suspend () -> Unit) {
        busy = true
        error = null
        scope.launch {
            try {
                block()
            } catch (e: Exception) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }

    if (status.state == ScState.CONNECTED) {
        Text("Conectado como @${status.user?.username ?: "…"}", fontWeight = FontWeight.SemiBold)
        OutlinedButton(onClick = { run { sc.logout() } }, enabled = !busy) { Text("Desconectar") }
    } else {
        val reconnect = status.state == ScState.RECONNECT
        if (reconnect) {
            Text(
                "O acesso ao SoundCloud caiu (senha do app trocada, Artist Pro vencido ou autorização revogada). " +
                    "Entre de novo; se continuar falhando, receba ou digite as credenciais outra vez.",
                color = Color(0xFFB45309),
            )
        }
        if (status.loginPending) {
            Text("Aguardando você autorizar o CuePoint no navegador… Depois, toque em Voltar ao CuePoint.")
            TextButton(onClick = { run { sc.logout() } }) { Text("Cancelar login") }
        } else {
            Button(onClick = {
                run {
                    val url = sc.login()
                    if (!openInBrowser(context, url)) {
                        sc.logout()
                        error = "Nenhum navegador encontrado para entrar no SoundCloud."
                    }
                }
            }, enabled = !busy) { Text(if (reconnect) "Reconectar" else "Entrar com SoundCloud") }
        }
    }
    (error ?: status.lastError)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    HorizontalDivider()
    Text("App: ${status.clientId ?: ""}", style = MaterialTheme.typography.bodySmall)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = onEdit, enabled = !busy) { Text("Trocar credenciais") }
        OutlinedButton(onClick = { forgetting = true }, enabled = !busy) { Text("Remover credenciais") }
    }
    if (forgetting) {
        ConfirmDialog(
            "Remover credenciais?",
            "Desconecta este celular do SoundCloud e apaga o código e a senha do app daqui. O PC não é afetado.",
            confirm = "Remover",
            onDismiss = { forgetting = false },
        ) {
            forgetting = false
            run { sc.forget() }
        }
    }
}
