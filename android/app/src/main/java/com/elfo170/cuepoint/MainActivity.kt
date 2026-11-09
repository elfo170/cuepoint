package com.elfo170.cuepoint

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.elfo170.cuepoint.media.MediaMetadataParser
import com.elfo170.cuepoint.ui.CuePointNav
import com.elfo170.cuepoint.ui.CuePointTheme
import com.elfo170.cuepoint.ui.PermissionsCard

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleShare(intent)
        setContent { CuePointTheme { CuePointNav(curateTop = { PermissionsCard() }) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    /** "Compartilhar → CuePoint" no app do SoundCloud define a faixa atual (PRD §12.4). */
    private fun handleShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val track = MediaMetadataParser.parseShare(
            intent.getStringExtra(Intent.EXTRA_TEXT),
            intent.getStringExtra(Intent.EXTRA_SUBJECT),
        ) ?: return
        container.setNowPlaying(track)
    }
}
