package com.elfo170.cuepoint.media

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.elfo170.cuepoint.container
import kotlinx.coroutines.launch

/** Botões do cartão de curadoria: decisão e categorias, sem abrir o app (funciona bloqueado). */
class CurationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.container
        val pending = goAsync()
        app.scope.launch {
            try {
                when (intent.action) {
                    ACTION_APPROVE -> app.decideCurrent(true)
                    ACTION_REJECT -> app.decideCurrent(false)
                    ACTION_CATEGORY_NEXT -> app.moveCategoryCursor(+1)
                    ACTION_CATEGORY_PREV -> app.moveCategoryCursor(-1)
                    ACTION_CATEGORY_TOGGLE -> app.toggleCursorCategory()
                }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_APPROVE = "com.elfo170.cuepoint.APPROVE"
        const val ACTION_REJECT = "com.elfo170.cuepoint.REJECT"
        const val ACTION_CATEGORY_NEXT = "com.elfo170.cuepoint.CATEGORY_NEXT"
        const val ACTION_CATEGORY_PREV = "com.elfo170.cuepoint.CATEGORY_PREV"
        const val ACTION_CATEGORY_TOGGLE = "com.elfo170.cuepoint.CATEGORY_TOGGLE"
    }
}
