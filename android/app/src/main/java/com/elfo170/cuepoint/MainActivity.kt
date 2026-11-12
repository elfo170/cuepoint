package com.elfo170.cuepoint

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import com.elfo170.cuepoint.media.CurationNotification
import com.elfo170.cuepoint.media.ListenerHealth
import com.elfo170.cuepoint.media.MediaMetadataParser
import com.elfo170.cuepoint.ui.CuePointNav
import com.elfo170.cuepoint.ui.CuePointTheme
import com.elfo170.cuepoint.ui.PermissionsCard
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleShare(intent)
        setContent { CuePointTheme { CuePointNav(curateTop = { PermissionsCard() }) } }
    }

    override fun onStart() {
        super.onStart()
        // Abrir o app reativa a notificação de curadoria dispensada (issue #1).
        lifecycleScope.launch { container.setNotificationDismissed(false) }
        reconnectListener()
    }

    /**
     * Ao abrir o app, garante que o serviço de leitura da faixa está conectado: pede a
     * reconexão e, se ainda estiver desconectado depois de alguns segundos, força o religamento.
     */
    private fun reconnectListener() {
        if (!CurationNotification.listenerEnabled(this) || container.listenerConnected.value) return
        ListenerHealth.requestReconnect(this)
        lifecycleScope.launch {
            delay(3000)
            if (!container.listenerConnected.value) ListenerHealth.forceRebind(this@MainActivity)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    /** "Compartilhar → CuePoint" no app do SoundCloud define a faixa atual (PRD §12.4). */
    private fun handleShare(intent: Intent?) {
        // Link de pareamento (cuepoint://pair?...) aberto pelo QR ou pela câmera
        intent?.data?.takeIf { it.scheme == "cuepoint" && it.host == "pair" }?.let { container.pendingPairUri.value = it.toString() }
        // Volta da página de retorno do login do SoundCloud (cuepoint://soundcloud)
        if (intent?.data?.let { it.scheme == "cuepoint" && it.host == "soundcloud" } == true) container.pendingSoundCloud.value = true
        if (intent?.action != Intent.ACTION_SEND) return
        val track = MediaMetadataParser.parseShare(
            intent.getStringExtra(Intent.EXTRA_TEXT),
            intent.getStringExtra(Intent.EXTRA_SUBJECT),
        ) ?: return
        container.setNowPlaying(track)
    }
}
