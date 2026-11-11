package com.elfo170.cuepoint.data

import com.elfo170.cuepoint.core.EntityType
import com.elfo170.cuepoint.core.Fractional
import com.elfo170.cuepoint.core.Hlc
import com.elfo170.cuepoint.core.Ids
import com.elfo170.cuepoint.core.Merge
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.text.Collator
import java.util.Locale

private fun p(v: String?): JsonElement = v?.let(::JsonPrimitive) ?: JsonNull
private fun p(v: Boolean): JsonElement = JsonPrimitive(v)

/** Operações de curadoria (PRD §6.2, §7, §8) — espelho de data/curation.ts da extensão. */
class Curation(val store: Store) {
    private val dao = store.db.dao()
    private val collator = Collator.getInstance(Locale.forLanguageTag("pt-BR")).apply { strength = Collator.PRIMARY }

    private fun now() = Hlc.isoOf(System.currentTimeMillis())

    // ---------- Pesquisas ----------

    suspend fun listResearches(includeArchived: Boolean = false): List<Research> =
        store.all(EntityType.RESEARCH).map(Research::of)
            .filter { !it.deleted && (includeArchived || !it.archived) }
            .sortedWith(compareBy(collator) { it.name })

    suspend fun createResearch(name: String, description: String = ""): Research {
        val id = store.init()
        return Research.of(
            store.put(EntityType.RESEARCH, Ids.newId(), mapOf(
                "user_id" to p(id.userId), "name" to p(name.trim()), "description" to p(description.trim()), "archived" to p(false),
            )),
        )
    }

    suspend fun updateResearch(id: String, name: String? = null, description: String? = null, archived: Boolean? = null) {
        val changes = buildMap<String, JsonElement> {
            name?.let { put("name", p(it.trim())) }
            description?.let { put("description", p(it.trim())) }
            archived?.let { put("archived", p(it)) }
        }
        store.put(EntityType.RESEARCH, id, changes)
    }

    suspend fun deleteResearch(id: String) {
        store.remove(EntityType.RESEARCH, id)
        if (getActiveResearchId() == id) setActiveResearchId(null)
    }

    suspend fun getActiveResearchId(): String? {
        val id = store.getMeta("activeResearchId")?.takeIf { it.isNotEmpty() } ?: return null
        val r = store.get(EntityType.RESEARCH, id)?.let(Research::of)
        return if (r != null && !r.deleted && !r.archived) id else null
    }

    suspend fun setActiveResearchId(id: String?) = store.setMeta("activeResearchId", id ?: "")

    // ---------- Categorias ----------

    suspend fun listCategories(): List<Category> =
        store.all(EntityType.CATEGORY).map(Category::of).filter { !it.deleted }.sortedWith(compareBy(collator) { it.name })

    /** Reutiliza categoria de mesmo nome (sem diferenciar maiúsculas/acentos de caixa). */
    suspend fun createCategory(name: String, description: String = ""): Category {
        val id = store.init()
        val clean = name.trim()
        listCategories().firstOrNull { it.name.equals(clean, ignoreCase = true) }?.let { return it }
        return Category.of(
            store.put(EntityType.CATEGORY, Ids.newId(), mapOf("user_id" to p(id.userId), "name" to p(clean), "description" to p(description.trim()))),
        )
    }

    suspend fun updateCategory(id: String, name: String, description: String) {
        store.put(EntityType.CATEGORY, id, mapOf("name" to p(name.trim()), "description" to p(description.trim())))
    }

    suspend fun deleteCategory(id: String) {
        val links = dao.byCategory(EntityType.TRACK_CATEGORY.key, id).filter { !it.deleted }
        store.write { tx ->
            for (l in links) tx.put(EntityType.TRACK_CATEGORY, l.id, mapOf("deleted_at" to p(now())), "delete")
            tx.put(EntityType.CATEGORY, id, mapOf("deleted_at" to p(now())), "delete")
        }
    }

    // ---------- Faixas ----------

    suspend fun findTrack(input: TrackInput): Track? {
        input.urn?.let { urn ->
            store.get(EntityType.TRACK, Ids.trackIdFromUrn(urn))?.let(Track::of)?.takeIf { !it.deleted }?.let { return it }
        }
        return findProvisional(input)
    }

    private suspend fun findProvisional(input: TrackInput): Track? {
        val candidates = if (input.url != null) dao.tracksByUrl(input.url).map { Track.of(Merge.parseObject(it.json)) }
        else store.all(EntityType.TRACK).map(Track::of).filter { it.url == null && it.title == input.title && it.artist == input.artist }
        return candidates.firstOrNull { !it.deleted && it.urn == null && it.mergedInto == null }
    }

    /** Garante a faixa (URN → id determinístico; sem URN → provisória) e associa provisórias. */
    suspend fun ensureTrack(input: TrackInput): Track {
        store.init()
        if (input.urn != null) {
            val id = Ids.trackIdFromUrn(input.urn)
            val provisional = findProvisional(input)
            val existing = store.get(EntityType.TRACK, id)?.let(Track::of)?.takeIf { !it.deleted }
            val track = existing?.let { refreshMetadata(it, input) } ?: Track.of(
                store.put(EntityType.TRACK, id, mapOf(
                    "soundcloud_urn" to p(input.urn), "soundcloud_url" to p(input.url), "title" to p(input.title),
                    "artist" to p(input.artist), "artwork_url" to p(input.artworkUrl), "metadata_source" to p(input.source),
                    "merged_into" to JsonNull,
                )),
            )
            if (provisional != null) mergeTracks(provisional.id, track.id)
            return track
        }
        findProvisional(input)?.let { return refreshMetadata(it, input) }
        return Track.of(
            store.put(EntityType.TRACK, Ids.newId(), mapOf(
                "soundcloud_urn" to JsonNull, "soundcloud_url" to p(input.url), "title" to p(input.title),
                "artist" to p(input.artist), "artwork_url" to p(input.artworkUrl), "metadata_source" to p(input.source),
                "merged_into" to JsonNull,
            )),
        )
    }

    private suspend fun refreshMetadata(track: Track, input: TrackInput): Track {
        val changes = buildMap<String, JsonElement> {
            if (input.title.isNotBlank() && input.title != track.title) put("title", p(input.title))
            if (input.artist.isNotBlank() && input.artist != track.artist) put("artist", p(input.artist))
            if (input.artworkUrl != null && input.artworkUrl != track.artworkUrl) put("artwork_url", p(input.artworkUrl))
            if (input.url != null && input.url != track.url) put("soundcloud_url", p(input.url))
        }
        if (changes.isEmpty()) return track
        return Track.of(store.put(EntityType.TRACK, track.id, changes))
    }

    /**
     * Associa faixa provisória à definitiva (PRD §8.2). Se a definitiva já tem outra decisão na
     * mesma pesquisa, a da provisória entra como escrita concorrente: valores diferentes viram
     * conflito (nada é descartado em silêncio).
     */
    suspend fun mergeTracks(fromId: String, intoId: String) {
        if (fromId == intoId) return
        val decisions = dao.byTrack(EntityType.DECISION.key, fromId).filter { !it.deleted }.map { Decision.of(Merge.parseObject(it.json)) }
        val links = dao.byTrack(EntityType.TRACK_CATEGORY.key, fromId).filter { !it.deleted }.map { TrackCategory.of(Merge.parseObject(it.json)) }
        val items = dao.byTrack(EntityType.PLAYLIST_TRACK.key, fromId).filter { !it.deleted }.map { PlaylistTrack.of(Merge.parseObject(it.json)) }
        val identity = store.init()
        store.write { tx ->
            for (d in decisions) {
                val target = Ids.decisionId(intoId, d.researchId)
                val exists = tx.get(EntityType.DECISION, target)?.let(Merge::isAlive) == true
                tx.put(
                    EntityType.DECISION, target,
                    mapOf(
                        "user_id" to p(identity.userId), "track_id" to p(intoId), "research_id" to p(d.researchId),
                        "decision" to p(d.decision), "device_source" to p(identity.deviceId),
                    ),
                    concurrent = exists,
                )
                tx.put(EntityType.DECISION, d.id, mapOf("deleted_at" to p(now())), "delete")
            }
            for (l in links) {
                tx.put(EntityType.TRACK_CATEGORY, Ids.trackCategoryId(intoId, l.researchId, l.categoryId), mapOf(
                    "track_id" to p(intoId), "research_id" to p(l.researchId), "category_id" to p(l.categoryId),
                ))
                tx.put(EntityType.TRACK_CATEGORY, l.id, mapOf("deleted_at" to p(now())), "delete")
            }
            for (item in items) {
                val target = Ids.playlistTrackId(item.playlistId, intoId)
                if (tx.get(EntityType.PLAYLIST_TRACK, target)?.let(Merge::isAlive) != true) {
                    tx.put(EntityType.PLAYLIST_TRACK, target, mapOf(
                        "playlist_id" to p(item.playlistId), "track_id" to p(intoId), "position" to p(item.position),
                    ))
                }
                tx.put(EntityType.PLAYLIST_TRACK, item.id, mapOf("deleted_at" to p(now())), "delete")
            }
            tx.put(EntityType.TRACK, fromId, mapOf("merged_into" to p(intoId)))
        }
    }

    /**
     * Associa faixas provisórias às definitivas que chegaram de outro aparelho (rodar depois de
     * receber operações). Casa pela mesma URL ou, sem URL, por título e artista idênticos — a mesma
     * regra da identificação local; casamentos ambíguos (duas definitivas) ficam de fora.
     * Espelho de `reconcileProvisional` na extensão. Retorna quantas provisórias foram associadas.
     */
    suspend fun reconcileProvisional(): Int {
        store.init()
        val tracks = store.all(EntityType.TRACK).map(Track::of).filter { !it.deleted }
        val definitive = tracks.filter { it.urn != null && it.mergedInto == null }
        fun index(key: (Track) -> String?): Map<String, Track?> {
            val map = mutableMapOf<String, Track?>()
            for (t in definitive) {
                val k = key(t) ?: continue
                map[k] = if (map.containsKey(k)) null else t // null = ambíguo
            }
            return map
        }
        val byUrl = index { it.url }
        val byName = index { "${it.title}\u0000${it.artist}" }
        var merged = 0
        for (p in tracks.filter { it.urn == null && it.mergedInto == null }) {
            val target = if (p.url != null) byUrl[p.url] else byName["${p.title}\u0000${p.artist}"]
            if (target == null) continue
            mergeTracks(p.id, target.id)
            merged += 1
        }
        return merged
    }

    /**
     * Junta categorias com o mesmo nome (criadas em aparelhos diferentes) na de destino:
     * classificações e playlists passam para ela, e as demais são excluídas.
     * Espelho de `mergeCategories` na extensão.
     */
    suspend fun mergeCategories(intoId: String, fromIds: List<String>) {
        val sources = fromIds.filter { it != intoId }
        if (sources.isEmpty()) return
        store.write { tx ->
            for (fromId in sources) {
                val links = dao.byCategory(EntityType.TRACK_CATEGORY.key, fromId).filter { !it.deleted }
                    .map { TrackCategory.of(Merge.parseObject(it.json)) }
                for (l in links) {
                    val target = Ids.trackCategoryId(l.trackId, l.researchId, intoId)
                    if (tx.get(EntityType.TRACK_CATEGORY, target)?.let(Merge::isAlive) != true) {
                        tx.put(EntityType.TRACK_CATEGORY, target, mapOf(
                            "track_id" to p(l.trackId), "research_id" to p(l.researchId), "category_id" to p(intoId),
                        ))
                    }
                    tx.put(EntityType.TRACK_CATEGORY, l.id, mapOf("deleted_at" to p(now())), "delete")
                }
                for (row in dao.byCategory(EntityType.PLAYLIST.key, fromId).filter { !it.deleted }) {
                    tx.put(EntityType.PLAYLIST, row.id, mapOf("category_id" to p(intoId)))
                }
                tx.put(EntityType.CATEGORY, fromId, mapOf("deleted_at" to p(now())), "delete")
            }
        }
    }

    // ---------- Decisões e classificações ----------

    suspend fun decisionState(trackId: String, researchId: String): Pair<Boolean?, List<String>> {
        val d = store.get(EntityType.DECISION, Ids.decisionId(trackId, researchId))?.let(Decision::of)?.takeIf { !it.deleted }
        val cats = dao.byTrack(EntityType.TRACK_CATEGORY.key, trackId)
            .filter { !it.deleted && it.research_id == researchId }.mapNotNull { it.category_id }
        return d?.decision to cats
    }

    suspend fun getTrackState(input: TrackInput, researchId: String?): TrackState {
        var track = findTrack(input)
        if (track != null && track.urn == null && input.urn != null) track = ensureTrack(input)
        if (track == null) return TrackState(null, input.urn == null, null, emptyList())
        val (decision, cats) = researchId?.let { decisionState(track.id, it) } ?: (null to emptyList())
        return TrackState(track.id, track.provisional, decision, cats)
    }

    suspend fun decide(trackId: String, researchId: String, value: Boolean) {
        val id = store.init()
        store.put(EntityType.DECISION, Ids.decisionId(trackId, researchId), mapOf(
            "user_id" to p(id.userId), "track_id" to p(trackId), "research_id" to p(researchId),
            "decision" to p(value), "device_source" to p(id.deviceId),
        ))
    }

    suspend fun setDecision(trackId: String, researchId: String, value: Boolean?) {
        if (value == null) clearDecision(trackId, researchId) else decide(trackId, researchId, value)
    }

    suspend fun clearDecision(trackId: String, researchId: String) {
        val id = Ids.decisionId(trackId, researchId)
        if (store.get(EntityType.DECISION, id)?.let(Merge::isAlive) == true) store.remove(EntityType.DECISION, id)
    }

    suspend fun setTrackCategory(trackId: String, researchId: String, categoryId: String, on: Boolean) {
        val id = Ids.trackCategoryId(trackId, researchId, categoryId)
        val alive = store.get(EntityType.TRACK_CATEGORY, id)?.let(Merge::isAlive) == true
        if (on && !alive) {
            store.put(EntityType.TRACK_CATEGORY, id, mapOf("track_id" to p(trackId), "research_id" to p(researchId), "category_id" to p(categoryId)))
        } else if (!on && alive) store.remove(EntityType.TRACK_CATEGORY, id)
    }

    suspend fun deleteTrack(id: String) = store.remove(EntityType.TRACK, id)

    // ---------- Playlists ----------

    suspend fun playlistItems(playlistId: String): List<Pair<PlaylistTrack, Track>> {
        val items = dao.byPlaylist(EntityType.PLAYLIST_TRACK.key, playlistId).filter { !it.deleted }
            .map { PlaylistTrack.of(Merge.parseObject(it.json)) }
            .sortedWith(compareBy<PlaylistTrack> { it.position }.thenBy { it.id })
        return items.mapNotNull { item ->
            var t = store.get(EntityType.TRACK, item.trackId)?.let(Track::of)
            while (t?.mergedInto != null) t = store.get(EntityType.TRACK, t.mergedInto!!)?.let(Track::of)
            t?.takeIf { !it.deleted }?.let { item to it }
        }
    }

    suspend fun sourceTrackIds(researchId: String?, categoryId: String?): List<String> {
        if (researchId == null && categoryId == null) return emptyList()
        var ids = researchId?.let { r ->
            dao.byResearch(EntityType.DECISION.key, r).map { Decision.of(Merge.parseObject(it.json)) }
                .filter { !it.deleted && it.decision }.sortedBy { it.createdAt }.map { it.trackId }
        } ?: emptyList()
        if (categoryId != null) {
            val withCat = dao.byCategory(EntityType.TRACK_CATEGORY.key, categoryId).map { TrackCategory.of(Merge.parseObject(it.json)) }
                .filter { !it.deleted && (researchId == null || it.researchId == researchId) }
                .sortedBy { it.createdAt }.map { it.trackId }
            ids = if (researchId != null) ids.filter { it in withCat.toSet() } else withCat
        }
        return ids.distinct().filter { id -> store.get(EntityType.TRACK, id)?.let(Track::of)?.let { !it.deleted && it.mergedInto == null } == true }
    }

    suspend fun createPlaylist(name: String, researchId: String?, categoryId: String?): Playlist {
        val identity = store.init()
        val id = Ids.newId()
        val trackIds = sourceTrackIds(researchId, categoryId)
        return store.write { tx ->
            val playlist = tx.put(EntityType.PLAYLIST, id, mapOf(
                "user_id" to p(identity.userId), "name" to p(name.trim()), "description" to p(""),
                "research_id" to p(researchId), "category_id" to p(categoryId), "external_playlist_id" to JsonNull,
            ))
            var last: String? = null
            for (t in trackIds) {
                last = Fractional.keyBetween(last, null)
                tx.put(EntityType.PLAYLIST_TRACK, Ids.playlistTrackId(id, t), mapOf("playlist_id" to p(id), "track_id" to p(t), "position" to p(last)))
            }
            Playlist.of(playlist)
        }
    }

    suspend fun deletePlaylist(id: String) {
        val items = dao.byPlaylist(EntityType.PLAYLIST_TRACK.key, id).filter { !it.deleted }
        store.write { tx ->
            for (i in items) tx.put(EntityType.PLAYLIST_TRACK, i.id, mapOf("deleted_at" to p(now())), "delete")
            tx.put(EntityType.PLAYLIST, id, mapOf("deleted_at" to p(now())), "delete")
        }
    }

    suspend fun addToPlaylist(playlistId: String, trackId: String): Boolean {
        val id = Ids.playlistTrackId(playlistId, trackId)
        if (store.get(EntityType.PLAYLIST_TRACK, id)?.let(Merge::isAlive) == true) return false
        val last = playlistItems(playlistId).lastOrNull()?.first?.position
        store.put(EntityType.PLAYLIST_TRACK, id, mapOf("playlist_id" to p(playlistId), "track_id" to p(trackId), "position" to p(Fractional.keyBetween(last, null))))
        return true
    }

    suspend fun removePlaylistItem(itemId: String) = store.remove(EntityType.PLAYLIST_TRACK, itemId)

    suspend fun movePlaylistItem(playlistId: String, itemId: String, to: Int) {
        val others = playlistItems(playlistId).map { it.first }.filter { it.id != itemId }
        val index = to.coerceIn(0, others.size)
        val before = others.getOrNull(index - 1)?.position
        var after = others.getOrNull(index)?.position
        if (before != null && after != null && before >= after) after = null
        store.put(EntityType.PLAYLIST_TRACK, itemId, mapOf("position" to p(Fractional.keyBetween(before, after))))
    }

    suspend fun refreshPlaylistFromSource(playlistId: String): Int {
        val pl = store.get(EntityType.PLAYLIST, playlistId)?.let(Playlist::of)?.takeIf { !it.deleted } ?: return 0
        return sourceTrackIds(pl.researchId, pl.categoryId).count { addToPlaylist(playlistId, it) }
    }

    @Suppress("unused")
    private fun JsonObject.alive() = Merge.isAlive(this)
}
