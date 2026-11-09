package com.elfo170.cuepoint.ui

import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

/** Ferramentas só do build debug: um "player" com MediaSession para testar sem o SoundCloud. */
object DebugTools {
    private var session: MediaSession? = null
    private var index = 0
    private val tracks = listOf(
        Triple("Deep Groove", "Fixture Artist", "soundcloud:tracks:111"),
        Triple("Next One", "Other", null),
        Triple("Latin Heat", "DJ Teste", "soundcloud:tracks:333"),
    )

    @Composable
    fun Section() {
        val context = LocalContext.current
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Depuração", style = MaterialTheme.typography.titleMedium)
            Text("Simula um player com MediaSession (ative \"Ler outros players\").", style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    val s = session ?: MediaSession(context.applicationContext, "CuePointDebugPlayer").also { session = it }
                    val (title, artist, id) = tracks[index++ % tracks.size]
                    s.setMetadata(
                        MediaMetadata.Builder()
                            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                            .apply { id?.let { putString(MediaMetadata.METADATA_KEY_MEDIA_ID, it) } }
                            .build(),
                    )
                    s.setPlaybackState(PlaybackState.Builder().setState(PlaybackState.STATE_PLAYING, 0, 1f).build())
                    s.isActive = true
                }) { Text("Tocar faixa de teste") }
                OutlinedButton(onClick = { session?.release(); session = null }) { Text("Parar") }
            }
        }
    }
}
