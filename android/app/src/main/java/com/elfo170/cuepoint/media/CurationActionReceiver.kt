package com.elfo170.cuepoint.media

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.elfo170.cuepoint.container
import kotlinx.coroutines.launch

/**
 * Ações ✓ / ✗ da notificação: registram a decisão sem abrir o app (funciona bloqueado).
 * Também recebe a dispensa da notificação pelo usuário, que a mantém oculta até o app ser aberto.
 */
class CurationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != ACTION_APPROVE && action != ACTION_REJECT && action != ACTION_DISMISSED) return
        val pending = goAsync()
        val app = context.container
        app.scope.launch {
            try {
                when (action) {
                    ACTION_APPROVE -> app.decideCurrent(true)
                    ACTION_REJECT -> app.decideCurrent(false)
                    ACTION_DISMISSED -> app.setNotificationDismissed(true)
                }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_APPROVE = "com.elfo170.cuepoint.APPROVE"
        const val ACTION_REJECT = "com.elfo170.cuepoint.REJECT"
        const val ACTION_DISMISSED = "com.elfo170.cuepoint.DISMISSED"
    }
}
