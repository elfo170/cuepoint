package com.elfo170.cuepoint.media

import android.content.ComponentName
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.service.notification.NotificationListenerService
import com.elfo170.cuepoint.container

/**
 * Lê a faixa atual da MediaSession do SoundCloud (PRD §12.3). É um NotificationListenerService:
 * o sistema o mantém ativo enquanto o acesso às notificações estiver liberado, sem precisar de
 * serviço em primeiro plano, e ele também publica a notificação de curadoria.
 */
class MediaListenerService : NotificationListenerService() {
    private var sessions: MediaSessionManager? = null
    private var controller: MediaController? = null

    private val callback = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) = publish()
        override fun onPlaybackStateChanged(state: PlaybackState?) = publish()
        override fun onSessionDestroyed() = attach(sessions?.getActiveSessions(component()).orEmpty())
    }

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { list -> attach(list.orEmpty()) }

    private fun component() = ComponentName(this, MediaListenerService::class.java)

    override fun onListenerConnected() {
        val manager = getSystemService(MediaSessionManager::class.java)
        sessions = manager
        manager.addOnActiveSessionsChangedListener(sessionsListener, component())
        attach(manager.getActiveSessions(component()))
        container.notificationsActive = true
        container.refreshNotification()
    }

    override fun onListenerDisconnected() {
        sessions?.removeOnActiveSessionsChangedListener(sessionsListener)
        controller?.unregisterCallback(callback)
        controller = null
        container.notificationsActive = false
    }

    private fun attach(list: List<MediaController>) {
        val acceptAny = container.acceptAnyPlayer
        val chosen = list.firstOrNull { it.packageName == MediaMetadataParser.SOUNDCLOUD_PACKAGE }
            ?: if (acceptAny) list.firstOrNull() else null
        if (chosen?.sessionToken == controller?.sessionToken) return
        controller?.unregisterCallback(callback)
        controller = chosen
        chosen?.registerCallback(callback)
        publish()
    }

    private fun publish() {
        val c = controller ?: return
        val m = c.metadata ?: return
        val track = MediaMetadataParser.parse(
            title = m.getString(MediaMetadata.METADATA_KEY_TITLE) ?: m.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE),
            artist = m.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: m.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE),
            mediaId = m.getString(MediaMetadata.METADATA_KEY_MEDIA_ID),
            mediaUri = m.getString(MediaMetadata.METADATA_KEY_MEDIA_URI),
            artworkUri = m.getString(MediaMetadata.METADATA_KEY_ART_URI) ?: m.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI),
            source = "mediasession",
        ) ?: return
        container.setNowPlaying(track)
    }
}
