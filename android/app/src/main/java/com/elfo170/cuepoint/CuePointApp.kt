package com.elfo170.cuepoint

import android.app.Application
import android.content.Context
import com.elfo170.cuepoint.data.CuePointDatabase
import com.elfo170.cuepoint.data.Curation
import com.elfo170.cuepoint.data.Snapshot
import com.elfo170.cuepoint.data.Store
import com.elfo170.cuepoint.data.TrackInput
import com.elfo170.cuepoint.data.TrackState
import com.elfo170.cuepoint.media.CurationNotification
import com.elfo170.cuepoint.media.UrnResolver
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Injeção de dependências manual (um container por processo). */
class AppContainer(
    private val context: Context,
    inMemory: Boolean = false,
    private val resolver: UrnResolver = UrnResolver(),
) {
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

    private val _currentState = MutableStateFlow<TrackState?>(null)

    /** Estado (decisão/categorias) da faixa atual na pesquisa ativa. */
    val currentState: StateFlow<TrackState?> = _currentState

    /** O serviço de leitura de notificações está conectado. */
    @Volatile var notificationsActive = false

    /** Também lê outros players além do SoundCloud (para testes / variantes do app). */
    @Volatile var acceptAnyPlayer: Boolean = false
        private set

    suspend fun setAcceptAnyPlayer(value: Boolean) {
        store.setMeta("media.anyPlayer", if (value) "1" else "0")
        acceptAnyPlayer = value
    }

    private val notifyMutex = Mutex()

    init {
        scope.launch { acceptAnyPlayer = store.getMeta("media.anyPlayer") == "1" }
        // Recalcula o estado e a notificação quando a faixa, a pesquisa ou os dados mudam.
        scope.launch {
            combine(nowPlaying, activeResearchId, snapshot) { t, r, _ -> t to r }.collect { (track, researchId) ->
                _currentState.value = track?.let { runCatching { curation.getTrackState(it, researchId) }.getOrNull() }
                refreshNotification()
            }
        }
    }

    fun setNowPlaying(track: TrackInput?) {
        val previous = _nowPlaying.value
        // Mantém o URN já resolvido se for a mesma faixa
        val merged = if (track != null && previous != null && track.urn == null && track.title == previous.title &&
            track.artist == previous.artist && (track.url == null || track.url == previous.url)
        ) track.copy(urn = previous.urn, url = track.url ?: previous.url) else track
        if (merged == previous) return
        _nowPlaying.value = merged
        val url = merged?.url
        if (merged != null && merged.urn == null && url != null) {
            scope.launch {
                val page = resolver.resolve(url) ?: return@launch
                val current = _nowPlaying.value
                if (current?.url == url && current.urn == null && page.urn != null) {
                    _nowPlaying.value = current.copy(
                        urn = page.urn,
                        artworkUrl = current.artworkUrl ?: page.artworkUrl,
                        title = if (current.source == "share") page.title ?: current.title else current.title,
                        artist = if (current.source == "share") page.artist ?: current.artist else current.artist,
                    )
                }
            }
        }
    }

    fun setManualTrack(track: TrackInput) = setNowPlaying(track)

    /** Registra a decisão da faixa atual na pesquisa ativa (notificação, widget ou tela). */
    suspend fun decideCurrent(value: Boolean?) {
        val track = _nowPlaying.value ?: return
        val researchId = curation.getActiveResearchId() ?: return
        val t = curation.ensureTrack(track)
        curation.setDecision(t.id, researchId, value)
        _currentState.value = curation.getTrackState(track, researchId)
        refreshNotification()
    }

    fun refreshNotification() {
        scope.launch {
            notifyMutex.withLock {
                val track = _nowPlaying.value
                if (track == null) {
                    CurationNotification.cancel(context)
                    return@withLock
                }
                val researchId = curation.getActiveResearchId()
                val name = researchId?.let { id -> snapshot.value.researches.firstOrNull { it.id == id }?.name }
                CurationNotification.show(context, track, name, _currentState.value)
            }
        }
    }
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
