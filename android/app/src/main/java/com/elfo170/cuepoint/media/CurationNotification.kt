package com.elfo170.cuepoint.media

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.elfo170.cuepoint.MainActivity
import com.elfo170.cuepoint.R
import com.elfo170.cuepoint.data.TrackInput
import com.elfo170.cuepoint.data.TrackState
import com.elfo170.cuepoint.ui.CategoryPickerActivity

/**
 * Notificação persistente de curadoria (PRD §12.2): mostra a faixa atual, a pesquisa ativa e o
 * estado da decisão, com as ações ✓ / ✗ / Categorias — inclusive na tela bloqueada.
 */
object CurationNotification {
    /** Importância padrão (sem som/vibração): canais silenciosos não aparecem na tela bloqueada. */
    const val CHANNEL_ID = "curation_lockscreen"
    const val NOTIFICATION_ID = 1001

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        // canais antigos: o silencioso original e os das tentativas de notificação abandonadas
        listOf("curation", "curation_p2", "curation_v3", "curation_v4", "curation_v5").forEach { manager.deleteNotificationChannel(it) }
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Curadoria", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    setSound(null, null)
                    enableVibration(false)
                    description = "Aprovar ou rejeitar a faixa que está tocando"
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                    setShowBadge(false)
                },
            )
        }
    }

    fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Acesso às notificações (necessário para ler a MediaSession do SoundCloud). */
    fun listenerEnabled(context: Context): Boolean {
        val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
        val me = ComponentName(context, MediaListenerService::class.java)
        return flat.split(':').any { ComponentName.unflattenFromString(it) == me }
    }

    private fun action(context: Context, action: String, code: Int): PendingIntent =
        PendingIntent.getBroadcast(
            context, code,
            Intent(context, CurationActionReceiver::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    fun show(context: Context, track: TrackInput, researchName: String?, state: TrackState?) {
        if (!canPost(context)) return
        ensureChannel(context)
        val decision = when (state?.decision) {
            true -> "✓ Aprovada"
            false -> "✗ Rejeitada"
            null -> "Não avaliada"
        }
        val sub = listOfNotNull(track.artist.ifBlank { null }, researchName ?: "escolha uma pesquisa no app").joinToString(" · ")
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val categories = PendingIntent.getActivity(
            context, 1, Intent(context, CategoryPickerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_cuepoint)
            .setContentTitle(track.title)
            .setContentText("$sub — $decision")
            .setSubText(if (track.urn == null) "provisória" else null)
            .setContentIntent(open)
            // No Android 14+ o usuário pode dispensar notificações contínuas: o app precisa saber
            // para não republicá-la (issue #1). Só dispara na dispensa do usuário, não no cancel().
            .setDeleteIntent(action(context, CurationActionReceiver.ACTION_DISMISSED, 12))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        if (researchName != null) {
            builder.addAction(R.drawable.ic_close, "Rejeitar", action(context, CurationActionReceiver.ACTION_REJECT, 10))
            builder.addAction(R.drawable.ic_check, "Aprovar", action(context, CurationActionReceiver.ACTION_APPROVE, 11))
            if (state?.decision == true) builder.addAction(R.drawable.ic_label, "Categorias", categories)
            builder.setStyle(androidx.media.app.NotificationCompat.MediaStyle().setShowActionsInCompactView(0, 1))
        }
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build())
        } catch (_: SecurityException) {
            // permissão revogada entre a checagem e o envio
        }
    }

    fun cancel(context: Context) = NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
}
