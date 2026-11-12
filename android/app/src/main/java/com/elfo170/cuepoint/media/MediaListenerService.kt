package com.elfo170.cuepoint.media

import android.content.ComponentName
import android.graphics.Bitmap
import android.util.Log
import com.elfo170.cuepoint.core.Ids
import kotlinx.coroutines.launch
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
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
        Log.d(ArtworkCache.TAG, "serviço de leitura conectado")
        val manager = getSystemService(MediaSessionManager::class.java)
        sessions = manager
        manager.addOnActiveSessionsChangedListener(sessionsListener, component())
        attach(manager.getActiveSessions(component()))
        container.setListenerConnected(true)
        container.refreshNotification()
    }

    override fun onListenerDisconnected() {
        Log.d(ArtworkCache.TAG, "serviço de leitura desconectado")
        sessions?.removeOnActiveSessionsChangedListener(sessionsListener)
        controller?.unregisterCallback(callback)
        controller = null
        container.setListenerConnected(false)
        // Se o acesso continua liberado, pede ao sistema para reconectar (evita ficar "mudo").
        ListenerHealth.requestReconnect(this)
    }

    private fun attach(list: List<MediaController>) {
        val acceptAny = container.acceptAnyPlayer
        // nunca lê uma sessão de mídia do próprio CuePoint
        val others = list.filter { it.packageName != packageName }
        val chosen = others.firstOrNull { it.packageName == MediaMetadataParser.SOUNDCLOUD_PACKAGE }
            ?: if (acceptAny) others.firstOrNull() else null
        if (chosen != null && chosen.sessionToken == controller?.sessionToken) return
        if (chosen != null || controller != null) {
            Log.d(ArtworkCache.TAG, "sessão escolhida: ${chosen?.packageName ?: "nenhuma"} estado=${chosen?.playbackState?.state}")
        }
        controller?.unregisterCallback(callback)
        controller = chosen
        chosen?.registerCallback(callback)
        publish()
    }

    /** O player publicou ou removeu a própria notificação: reavalia se a sessão ainda vale. */
    override fun onNotificationPosted(sbn: StatusBarNotification?) = onPlayerNotificationChanged(sbn)

    override fun onNotificationRemoved(sbn: StatusBarNotification?) = onPlayerNotificationChanged(sbn)

    private fun onPlayerNotificationChanged(sbn: StatusBarNotification?) {
        val c = controller ?: return
        if (sbn?.packageName == c.packageName) publish()
    }

    /** O player tem alguma notificação na tela (na dúvida, considera que sim). */
    private fun playerHasNotification(pkg: String): Boolean =
        runCatching { activeNotifications.orEmpty().any { it.packageName == pkg } }.getOrDefault(true)

    /**
     * A sessão acabou: sem sessão, estado parado/erro ou pausada sem a notificação do player.
     * O último caso cobre o HyperOS, que mantém a sessão pausada do SoundCloud depois de ele ser
     * tirado dos recentes, mas remove a notificação dele.
     */
    private fun sessionEnded(c: MediaController?): Boolean {
        if (c == null) return true
        val state = c.playbackState?.state ?: return false // estado ainda desconhecido: aguarda o callback
        if (state in ENDED_STATES) return true
        return state == PlaybackState.STATE_PAUSED && !playerHasNotification(c.packageName)
    }

    private fun publish() {
        val c = controller
        // Sessão encerrada: esquece a faixa para não republicá-la depois (issue #1).
        if (c == null || sessionEnded(c)) {
            if (c != null && container.nowPlaying.value != null) {
                Log.d(ArtworkCache.TAG, "sessão de ${c.packageName} encerrada (estado=${c.playbackState?.state}): faixa esquecida")
            }
            container.clearMediaSessionTrack()
            return
        }
        val m = c.metadata ?: return
        val track = MediaMetadataParser.parse(
            title = m.getString(MediaMetadata.METADATA_KEY_TITLE) ?: m.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE),
            artist = m.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: m.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE),
            mediaId = m.getString(MediaMetadata.METADATA_KEY_MEDIA_ID),
            mediaUri = m.getString(MediaMetadata.METADATA_KEY_MEDIA_URI),
            artworkUri = m.getString(MediaMetadata.METADATA_KEY_ART_URI) ?: m.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI),
            source = com.elfo170.cuepoint.AppContainer.MEDIA_SESSION_SOURCE,
        ) ?: return
        container.setNowPlaying(track)
        saveSessionArtwork(m, track.urn)
    }

    private var loggedTrack: String? = null

    /**
     * A sessão do SoundCloud não traz endereço de capa, mas costuma trazer a imagem pronta
     * (ART / ALBUM_ART / DISPLAY_ICON). Ela é reduzida e guardada no cache local, pelo id da faixa.
     */
    private fun saveSessionArtwork(m: MediaMetadata, urn: String?) {
        val key = urn ?: m.getString(MediaMetadata.METADATA_KEY_TITLE)
        val art = ARTWORK_KEYS.firstNotNullOfOrNull { k -> m.getBitmap(k)?.let { k to it } }
        if (key != loggedTrack) {
            loggedTrack = key
            Log.d(ArtworkCache.TAG, "metadados (${controller?.packageName}): chaves=${m.keySet().sorted()} capa=${art?.let { "${it.first} ${it.second.width}x${it.second.height}" } ?: "nenhuma"}")
        }
        if (urn == null || art == null) return
        val trackId = Ids.trackIdFromUrn(urn)
        if (container.artwork.hasSession(trackId)) return
        // copia antes de sair da thread do callback: o bitmap pertence à sessão e pode ser reciclado
        val copy = runCatching { art.second.copy(Bitmap.Config.ARGB_8888, false) }.getOrNull() ?: return
        container.scope.launch { container.artwork.saveSession(trackId, copy) }
    }

    private companion object {
        /** Estados em que a sessão não tem mais faixa em curso (pausado vale enquanto o player tiver notificação). */
        val ENDED_STATES = setOf(PlaybackState.STATE_NONE, PlaybackState.STATE_STOPPED, PlaybackState.STATE_ERROR)

        val ARTWORK_KEYS = listOf(
            MediaMetadata.METADATA_KEY_ART,
            MediaMetadata.METADATA_KEY_ALBUM_ART,
            MediaMetadata.METADATA_KEY_DISPLAY_ICON,
        )
    }
}
