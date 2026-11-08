package com.elfo170.cuepoint

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.elfo170.cuepoint.ui.CuePointNav
import com.elfo170.cuepoint.ui.CuePointTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { CuePointTheme { CuePointNav() } }
    }
}
