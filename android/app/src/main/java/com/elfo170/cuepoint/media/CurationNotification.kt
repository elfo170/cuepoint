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
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.elfo170.cuepoint.MainActivity
import com.elfo170.cuepoint.R
import com.elfo170.cuepoint.data.Category
import com.elfo170.cuepoint.data.TrackInput
import com.elfo170.cuepoint.data.TrackState
import com.elfo170.cuepoint.ui.CategoryPickerActivity

/**
 * Notificação persistente de curadoria (PRD §12.2): mostra a faixa atual, a pesquisa ativa e o
 * estado da decisão, com as ações ✓ / ✗ / Categorias — inclusive na tela bloqueada.
 */
object CurationNotification {
    /**
     * Importância normal e sem som: aparece na tela bloqueada (canais de importância baixa são
     * escondidos de lá). A importância de um canal existente não muda pelo app, por isso o id novo.
     */
    const val CHANNEL_ID = "curation_v5"
    const val NOTIFICATION_ID = 1001



    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        // canais antigos (versões anteriores do app)
        listOf("curation", "curation_lockscreen", "curation_p2", "curation_v3", "curation_v4").forEach { manager.deleteNotificationChannel(it) }
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Curadoria", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    // Som inaudível (silêncio): o canal conta como "com alerta" e não é escondido da tela
                    // bloqueada quando chegam outras notificações; nada toca nem vibra.
                    setSound(
                        android.net.Uri.parse("android.resource://${context.packageName}/${R.raw.silence}"),
                        android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
                    )
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

    /**
     * Cartão de mídia de curadoria: ✗ / ✓ sempre visíveis (PRD §9.3) e, depois de aprovar,
     * ‹ etiqueta › para percorrer as categorias nos dois sentidos e marcar/desmarcar — tudo em
     * ícones e funcionando com a tela bloqueada (cada botão é um broadcast, sem abrir telas).
     *
     * @param category categoria sob o cursor (null se não houver categorias)
     */
    fun show(
        context: Context,
        track: TrackInput,
        researchName: String?,
        state: TrackState?,
        category: Category? = null,
    ) {
        if (!canPost(context)) return
        ensureChannel(context)
        val approved = state?.decision == true
        val rejected = state?.decision == false
        val decision = when (state?.decision) {
            true -> "✓ Aprovada"
            false -> "✗ Rejeitada"
            null -> "Não avaliada"
        }
        val marked = category != null && category.id in state?.categoryIds.orEmpty()
        val categoryText = if (approved && category != null) " · ${category.name}${if (marked) " ✓" else ""}" else ""
        val sub = listOfNotNull(track.artist.ifBlank { null }, researchName ?: "escolha uma pesquisa no app").joinToString(" · ")
        val line = "$sub — $decision$categoryText"
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_cuepoint)
            .setContentTitle(track.title)
            .setContentText(line)
            .setSubText(if (track.urn == null) "provisória" else null)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        val compact = mutableListOf<Int>()
        val buttons = mutableListOf<CurationMediaSession.Button>()
        fun add(icon: Int, label: String, act: String, code: Int) {
            builder.addAction(icon, label, action(context, act, code))
            buttons += CurationMediaSession.Button(act, label, icon)
        }
        if (researchName != null) {
            add(
                if (rejected) R.drawable.ic_media_x_on else R.drawable.ic_media_x,
                context.getString(R.string.action_reject), CurationActionReceiver.ACTION_REJECT, 10,
            )
            add(
                if (approved) R.drawable.ic_media_check_on else R.drawable.ic_media_check,
                context.getString(R.string.action_approve), CurationActionReceiver.ACTION_APPROVE, 11,
            )
            compact += listOf(0, 1)
            if (approved && category != null) {
                add(R.drawable.ic_media_prev, context.getString(R.string.action_category_prev), CurationActionReceiver.ACTION_CATEGORY_PREV, 12)
                add(
                    if (marked) R.drawable.ic_media_tag_on else R.drawable.ic_media_tag_off,
                    context.getString(R.string.action_category_toggle), CurationActionReceiver.ACTION_CATEGORY_TOGGLE, 13,
                )
                add(R.drawable.ic_media_next, context.getString(R.string.action_category_next), CurationActionReceiver.ACTION_CATEGORY_NEXT, 14)
                compact += 3
            }
        }
        CurationMediaSession.update(context, track, line, buttons)
        builder.setStyle(
            MediaStyle()
                .setMediaSession(CurationMediaSession.token)
                .setShowActionsInCompactView(*compact.toIntArray()),
        )
        try {
            val notification = builder.build()
            // Em primeiro plano o sistema mantém a notificação fixa e a trata como serviço ativo.
            val service = MediaListenerService.instance
            if (service != null) {
                if (Build.VERSION.SDK_INT >= 34) {
                    service.startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
                } else {
                    service.startForeground(NOTIFICATION_ID, notification)
                }
            } else {
                NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
            }
        } catch (_: RuntimeException) {
            // permissão revogada entre a checagem e o envio
        }
    }

    fun cancel(context: Context) {
        MediaListenerService.instance?.stopForeground(android.app.Service.STOP_FOREGROUND_REMOVE)
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        CurationMediaSession.release()
    }
}
