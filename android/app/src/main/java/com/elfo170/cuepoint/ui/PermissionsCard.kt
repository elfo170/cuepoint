package com.elfo170.cuepoint.ui

import android.Manifest
import android.content.Intent
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
import com.elfo170.cuepoint.media.CurationNotification

/** Onboarding das permissões: acesso às notificações (ler o SoundCloud) e postar notificações. */
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
    val (listener, post) = remember(tick) {
        CurationNotification.listenerEnabled(context) to CurationNotification.canPost(context)
    }
    if (listener && post) return

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Configurar o CuePoint", style = MaterialTheme.typography.titleMedium)
            if (!listener) {
                Text(
                    "Libere o acesso às notificações para o CuePoint identificar a faixa que toca no SoundCloud.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Button(onClick = { context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }) {
                    Text("Liberar acesso às notificações")
                }
            }
            if (!post && Build.VERSION.SDK_INT >= 33) {
                Text("Permita notificações para classificar pela notificação e pela tela bloqueada.", style = MaterialTheme.typography.bodySmall)
                Button(onClick = { request.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Permitir notificações") }
            }
        }
    }
}
