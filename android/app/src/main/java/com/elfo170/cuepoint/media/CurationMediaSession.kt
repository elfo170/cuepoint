package com.elfo170.cuepoint.media

import android.content.Context
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.os.Bundle
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.data.TrackInput
import kotlinx.coroutines.launch

/**
 * Sessão de mídia do próprio CuePoint. Ela existe só para que o sistema trate a notificação de
 * curadoria como um cartão de mídia (área própria, mantida na tela bloqueada), em vez de uma
 * notificação comum, que o HyperOS esconde da tela bloqueada quando chegam outras.
 *
 * Fica sempre PAUSED e sem ações de transporte: assim não vira a sessão "ativa" do sistema e não
 * captura os botões de mídia (fone, volume longo, Bluetooth), que continuam controlando o SoundCloud.
 */
object CurationMediaSession {
    private var session: MediaSessionCompat? = null

    /** Botão do cartão: id da ação, rótulo e ícone. */
    data class Button(val id: String, val label: String, val icon: Int)

    val token: MediaSessionCompat.Token get() = checkNotNull(session).sessionToken

    /**
     * O Android 13+ monta os botões do cartão de mídia a partir das ações da *sessão*
     * (PlaybackState), e não das ações da notificação — por isso os botões vão como ações
     * personalizadas da sessão.
     */
    fun update(context: Context, track: TrackInput, subtitle: String, buttons: List<Button>) {
        val app = context.applicationContext
        val s = session ?: MediaSessionCompat(app, "CuePointCuration").also {
            // sem FLAG_HANDLES_MEDIA_BUTTONS / TRANSPORT_CONTROLS: não recebe botões de mídia
            it.setFlags(0)
            it.setCallback(object : MediaSessionCompat.Callback() {
                override fun onCustomAction(action: String?, extras: Bundle?) {
                    val c = app.container
                    c.scope.launch {
                        when (action) {
                            CurationActionReceiver.ACTION_REJECT -> c.decideCurrent(false)
                            CurationActionReceiver.ACTION_APPROVE -> c.decideCurrent(true)
                            CurationActionReceiver.ACTION_CATEGORY_TOGGLE -> c.toggleCursorCategory()
                            CurationActionReceiver.ACTION_CATEGORY_PREV -> c.moveCategoryCursor(-1)
                            CurationActionReceiver.ACTION_CATEGORY_NEXT -> c.moveCategoryCursor(+1)
                        }
                    }
                }
            }, android.os.Handler(android.os.Looper.getMainLooper()))
            it.isActive = true
            session = it
        }
        // O cartão padrão comporta só 4 ações: prioridade ✗ ✓ etiqueta › (‹ fica por último)
        val order = listOf(
            CurationActionReceiver.ACTION_REJECT, CurationActionReceiver.ACTION_APPROVE,
            CurationActionReceiver.ACTION_CATEGORY_TOGGLE, CurationActionReceiver.ACTION_CATEGORY_NEXT,
            CurationActionReceiver.ACTION_CATEGORY_PREV,
        )
        val state = PlaybackStateCompat.Builder()
            .setActions(0)
            .setState(PlaybackStateCompat.STATE_PAUSED, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 0f)
        buttons.sortedBy { order.indexOf(it.id) }.forEach { state.addCustomAction(it.id, it.label, it.icon) }
        s.setPlaybackState(state.build())
        s.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, track.title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, subtitle)
                .build(),
        )
    }

    fun release() {
        session?.run {
            isActive = false
            release()
        }
        session = null
    }
}
