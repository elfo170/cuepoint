package com.elfo170.cuepoint.media

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.elfo170.cuepoint.container
import kotlinx.coroutines.launch

/** Ações ✓ / ✗ da notificação: registram a decisão sem abrir o app (funciona bloqueado). */
class CurationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val value = when (intent.action) {
            ACTION_APPROVE -> true
            ACTION_REJECT -> false
            else -> return
        }
        val pending = goAsync()
        val app = context.container
        app.scope.launch {
            try {
                app.decideCurrent(value)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_APPROVE = "com.elfo170.cuepoint.APPROVE"
        const val ACTION_REJECT = "com.elfo170.cuepoint.REJECT"
    }
}
