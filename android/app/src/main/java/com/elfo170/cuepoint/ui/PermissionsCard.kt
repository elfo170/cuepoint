package com.elfo170.cuepoint.ui

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.media.CurationNotification
import com.elfo170.cuepoint.media.ListenerHealth

private fun Intent.startSafely(context: android.content.Context, fallback: Intent? = null) {
    runCatching { context.startActivity(this) }.onFailure { fallback?.let { f -> runCatching { context.startActivity(f) } } }
}

/**
 * Onboarding e saúde do app: acesso às notificações (ler o SoundCloud), permissão de
 * notificações, serviço de leitura conectado e economia de bateria (que pode encerrar o app).
 */
@Composable
fun PermissionsCard() {
    val context = LocalContext.current
    var tick by remember { mutableIntStateOf(0) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) tick++ }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { tick++ }
    val connected by context.container.listenerConnected.collectAsStateWithLifecycle()
    val listener = remember(tick, connected) { CurationNotification.listenerEnabled(context) }
    val post = remember(tick) { CurationNotification.canPost(context) }
    val battery = remember(tick) { ListenerHealth.ignoringBatteryOptimizations(context) }
    val xiaomi = Build.MANUFACTURER.equals("xiaomi", true) || Build.MANUFACTURER.equals("redmi", true) || Build.MANUFACTURER.equals("poco", true)
    val disconnected = listener && !connected
    if (listener && post && !disconnected && battery) return

    val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Configurar o CuePoint", style = MaterialTheme.typography.titleMedium)
            if (!listener) {
                Text(
                    "Libere o acesso às notificações para o CuePoint identificar a faixa que toca no SoundCloud.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Button(onClick = { Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).startSafely(context) }) {
                    Text("Liberar acesso às notificações")
                }
            } else if (disconnected) {
                Text(
                    "O acesso está liberado, mas a leitura da faixa está desconectada — o sistema encerrou o serviço do CuePoint. " +
                        "Toque em Reconectar. Para não voltar a acontecer, tire o app da economia de bateria (abaixo).",
                    style = MaterialTheme.typography.bodySmall,
                )
                Button(onClick = {
                    ListenerHealth.requestReconnect(context)
                    ListenerHealth.forceRebind(context)
                }) { Text("Reconectar leitura da faixa") }
            }
            if (!battery) {
                Text(
                    "Economia de bateria: o sistema pode encerrar o CuePoint em segundo plano e parar a leitura das faixas.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Button(onClick = {
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
                        .startSafely(context, fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                }) { Text("Permitir em segundo plano") }
                if (xiaomi) {
                    Text(
                        "Xiaomi/Redmi/POCO: também ative \"Início automático\" e deixe a economia de bateria do app em \"Sem restrições\".",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    OutlinedButton(onClick = {
                        Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"))
                            .startSafely(context, fallback = details)
                    }) { Text("Abrir início automático") }
                }
            }
            if (!post && Build.VERSION.SDK_INT >= 33) {
                Text("Permita notificações para classificar pela notificação e pela tela bloqueada.", style = MaterialTheme.typography.bodySmall)
                Button(onClick = { request.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Permitir notificações") }
            }
        }
    }
}
