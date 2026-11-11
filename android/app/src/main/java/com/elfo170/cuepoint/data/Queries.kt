package com.elfo170.cuepoint.data

import com.elfo170.cuepoint.core.EntityType
import com.elfo170.cuepoint.core.Merge
import java.text.Collator
import java.util.Locale

/** Dados vivos da biblioteca — espelho de data/queries.ts da extensão. */
data class Snapshot(
    val tracks: List<Track>,
    val researches: List<Research>,
    val decisions: List<Decision>,
    val categories: List<Category>,
    val trackCategories: List<TrackCategory>,
    val playlists: List<Playlist>,
    val playlistTracks: List<PlaylistTrack>,
) {
    companion object {
        private val collator = Collator.getInstance(Locale.forLanguageTag("pt-BR")).apply { strength = Collator.PRIMARY }

        val EMPTY = Snapshot(emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList())

        fun of(rows: List<EntityRow>): Snapshot {
            val byType = rows.filter { !it.deleted }.groupBy { it.type }
            fun <T> list(type: EntityType, f: (kotlinx.serialization.json.JsonObject) -> T) =
                byType[type.key].orEmpty().map { f(Merge.parseObject(it.json)) }
            return Snapshot(
                tracks = list(EntityType.TRACK, Track::of).filter { it.mergedInto == null },
                researches = list(EntityType.RESEARCH, Research::of).sortedWith(compareBy(collator) { it.name }),
                decisions = list(EntityType.DECISION, Decision::of),
                categories = list(EntityType.CATEGORY, Category::of).sortedWith(compareBy(collator) { it.name }),
                trackCategories = list(EntityType.TRACK_CATEGORY, TrackCategory::of),
                playlists = list(EntityType.PLAYLIST, Playlist::of).sortedWith(compareBy(collator) { it.name }),
                playlistTracks = list(EntityType.PLAYLIST_TRACK, PlaylistTrack::of),
            )
        }
    }

    private val liveCategories by lazy { categories.map { it.id }.toSet() }
    private val trackById by lazy { tracks.associateBy { it.id } }

    fun categoriesOf(trackId: String, researchId: String): List<String> =
        trackCategories.filter { it.trackId == trackId && it.researchId == researchId && it.categoryId in liveCategories }.map { it.categoryId }

    data class Summary(val research: Research, val approved: Int, val rejected: Int, val pending: Int)

    fun summaries(includeArchived: Boolean): List<Summary> = researches.filter { includeArchived || !it.archived }.map { r ->
        val ds = decisions.filter { it.researchId == r.id && it.trackId in trackById }
        val approved = ds.filter { it.decision }
        Summary(r, approved.size, ds.size - approved.size, approved.count { categoriesOf(it.trackId, r.id).isEmpty() })
    }

    enum class Tab { APPROVED, REJECTED, PENDING }

    data class Row(val track: Track, val decision: Decision, val categoryIds: List<String>)

    private fun matches(t: Track, search: String): Boolean {
        val q = search.trim().lowercase(Locale.forLanguageTag("pt-BR"))
        return q.isEmpty() || "${t.title} ${t.artist}".lowercase(Locale.forLanguageTag("pt-BR")).contains(q)
    }

    fun researchTracks(researchId: String, tab: Tab, filter: Set<String> = emptySet(), search: String = ""): List<Row> =
        decisions.filter { it.researchId == researchId }.mapNotNull { d ->
            val t = trackById[d.trackId] ?: return@mapNotNull null
            val cats = categoriesOf(t.id, researchId)
            val keep = when (tab) {
                Tab.APPROVED -> d.decision
                Tab.REJECTED -> !d.decision
                Tab.PENDING -> d.decision && cats.isEmpty()
            } && cats.containsAll(filter) && matches(t, search)
            if (keep) Row(t, d, cats) else null
        }.sortedByDescending { it.decision.updatedAt }

    data class TrackRow(val track: Track, val decisions: Map<String, Boolean>)

    fun allTracks(search: String = "", filter: Set<String> = emptySet()): List<TrackRow> {
        val byTrack = decisions.groupBy { it.trackId }
        val catsByTrack = trackCategories.groupBy { it.trackId }.mapValues { (_, l) -> l.map { it.categoryId }.toSet() }
        return tracks.filter { matches(it, search) && (catsByTrack[it.id] ?: emptySet()).containsAll(filter) }
            .map { t -> TrackRow(t, byTrack[t.id].orEmpty().associate { it.researchId to it.decision }) }
            .sortedByDescending { it.track.updatedAt }
    }

    fun categoryUses(categoryId: String) = trackCategories.count { it.categoryId == categoryId }

    /**
     * Categorias vivas com o mesmo nome (sem espaços nas pontas, sem diferenciar maiúsculas) —
     * típico de categorias criadas em aparelhos diferentes. Em cada grupo, a primeira é o destino
     * da junção: a mais antiga (desempate pelo id), para que todos os aparelhos escolham a mesma.
     * Mesma regra de `categoryDuplicates` na extensão.
     */
    fun categoryDuplicates(): List<List<Category>> =
        categories.groupBy { it.name.trim().lowercase(Locale.forLanguageTag("pt-BR")) }.values
            .filter { it.size > 1 }
            .map { g -> g.sortedWith(compareBy<Category>({ it.createdAt }, { it.id })) }

    fun playlistSize(playlistId: String) = playlistTracks.count { it.playlistId == playlistId }
}
