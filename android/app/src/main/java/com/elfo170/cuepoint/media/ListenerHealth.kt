package com.elfo170.cuepoint.media

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.PowerManager
import android.service.notification.NotificationListenerService

/**
 * Mantém o serviço de leitura da faixa conectado. O acesso às notificações pode estar liberado
 * e o serviço ainda assim ficar desconectado — por exemplo, quando o sistema (principalmente
 * HyperOS/MIUI, com a economia de bateria) encerra o processo e não o reconecta sozinho.
 */
object ListenerHealth {
    private fun component(context: Context) = ComponentName(context, MediaListenerService::class.java)

    /** Pede ao sistema que reconecte o serviço (API oficial; só tem efeito se o acesso estiver liberado). */
    fun requestReconnect(context: Context) {
        if (!CurationNotification.listenerEnabled(context)) return
        runCatching { NotificationListenerService.requestRebind(component(context)) }
    }

    /**
     * Alternativa mais forte, usada quando o pedido simples não basta: desliga e religa o
     * componente, o que obriga o sistema a ligá-lo de novo. Não encerra o app.
     */
    fun forceRebind(context: Context) {
        if (!CurationNotification.listenerEnabled(context)) return
        val pm = context.packageManager
        val c = component(context)
        runCatching {
            pm.setComponentEnabledSetting(c, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
            pm.setComponentEnabledSetting(c, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
        }
        requestReconnect(context)
    }

    /** O app está fora da economia de bateria (não será encerrado em segundo plano). */
    fun ignoringBatteryOptimizations(context: Context): Boolean =
        context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) == true
}
