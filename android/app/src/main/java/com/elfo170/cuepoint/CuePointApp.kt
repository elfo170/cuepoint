package com.elfo170.cuepoint

import android.app.Application
import android.content.Context
import com.elfo170.cuepoint.data.CuePointDatabase
import com.elfo170.cuepoint.data.Curation
import com.elfo170.cuepoint.data.Snapshot
import com.elfo170.cuepoint.data.Store
import com.elfo170.cuepoint.data.TrackInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/** Injeção de dependências manual (um container por processo). */
class AppContainer(context: Context, inMemory: Boolean = false) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val db = CuePointDatabase.create(context, inMemory)
    val store = Store(db)
    val curation = Curation(store)

    /** Biblioteca reativa: recalculada a cada escrita no banco. */
    val snapshot: StateFlow<Snapshot> = db.dao().observeAll()
        .map(Snapshot::of)
        .stateIn(scope, SharingStarted.Eagerly, Snapshot.EMPTY)

    val activeResearchId: Flow<String?> = db.dao().observeMeta("activeResearchId").map { it?.takeIf(String::isNotEmpty) }

    private val _nowPlaying = MutableStateFlow<TrackInput?>(null)

    /** Faixa atual: vinda da MediaSession do SoundCloud, de um compartilhamento ou manual. */
    val nowPlaying: StateFlow<TrackInput?> = _nowPlaying

    fun setNowPlaying(track: TrackInput?) {
        _nowPlaying.value = track
    }

    fun setManualTrack(track: TrackInput) = setNowPlaying(track)
}

class CuePointApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

val Context.container: AppContainer get() = (applicationContext as CuePointApp).container
