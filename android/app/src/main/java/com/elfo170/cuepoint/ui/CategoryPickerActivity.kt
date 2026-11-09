package com.elfo170.cuepoint.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.ui.screens.NewCategoryField
import kotlinx.coroutines.launch

/**
 * Seletor rápido de categorias aberto pela notificação. Aparece sobre a tela bloqueada
 * (PRD §12.5) para classificar sem desbloquear o celular.
 */
class CategoryPickerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        val app = container
        setContent {
            CuePointTheme {
                val scope = rememberCoroutineScope()
                val snapshot by app.snapshot.collectAsStateWithLifecycle()
                val track by app.nowPlaying.collectAsStateWithLifecycle()
                val state by app.currentState.collectAsStateWithLifecycle()
                val researchId by app.activeResearchId.collectAsStateWithLifecycle(null)
                Surface(shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Categorias", style = MaterialTheme.typography.titleLarge)
                        Text(track?.title ?: "Nenhuma faixa", style = MaterialTheme.typography.bodyMedium)
                        val trackId = state?.trackId
                        val rid = researchId
                        if (trackId == null || rid == null || state?.decision != true) {
                            Text("Aprove a faixa para classificá-la.", style = MaterialTheme.typography.bodySmall)
                        } else {
                            val selected = state?.categoryIds.orEmpty()
                            CategoryChips(snapshot.categories, selected) { cid ->
                                scope.launch { app.curation.setTrackCategory(trackId, rid, cid, cid !in selected) }
                            }
                            NewCategoryField { name ->
                                scope.launch {
                                    val c = app.curation.createCategory(name)
                                    app.curation.setTrackCategory(trackId, rid, c.id, true)
                                }
                            }
                        }
                        TextButton(onClick = { finish() }, modifier = Modifier.align(Alignment.End)) { Text("Fechar") }
                    }
                }
            }
        }
    }
}
