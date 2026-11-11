package com.elfo170.cuepoint.data

import com.elfo170.cuepoint.core.Candidate
import com.elfo170.cuepoint.core.EntityType
import com.elfo170.cuepoint.core.Hlc
import com.elfo170.cuepoint.core.Merge
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** Um dos valores possíveis de um campo em conflito. */
data class ConflictOption(
    val value: JsonElement,
    /** Texto legível do valor (ex.: "Aprovada", "Excluída"). */
    val label: String,
    /** Aparelhos que gravaram este valor (device_id). */
    val origins: List<String>,
    /** Momento da gravação mais recente deste valor (ISO). */
    val at: String,
    /** É o valor exibido hoje (vencedor provisório: o mais recente). */
    val current: Boolean,
)

/** Conflito pronto para a tela: o que é, qual campo e as opções lado a lado. */
data class ConflictView(
    val id: String,
    val entityType: EntityType,
    val entityId: String,
    val field: String,
    val kind: String,
    val subject: String,
    val fieldLabel: String,
    val options: List<ConflictOption>,
    val createdAt: String,
)

/** Lista de conflitos legível — espelho de data/conflicts.ts da extensão. */
object Conflicts {
    private val KIND = mapOf(
        EntityType.TRACK to "Faixa", EntityType.RESEARCH to "Pesquisa", EntityType.DECISION to "Decisão",
        EntityType.CATEGORY to "Categoria", EntityType.TRACK_CATEGORY to "Classificação",
        EntityType.PLAYLIST to "Playlist", EntityType.PLAYLIST_TRACK to "Item de playlist",
    )

    private val FIELD = mapOf(
        "name" to "Nome", "description" to "Descrição", "archived" to "Arquivada", "decision" to "Decisão",
        "deleted_at" to "Exclusão", "merged_into" to "Associação a outra faixa",
        "soundcloud_urn" to "Identificador do SoundCloud", "research_id" to "Pesquisa", "category_id" to "Categoria",
        "track_id" to "Faixa", "playlist_id" to "Playlist", "position" to "Posição na playlist",
        "external_playlist_id" to "Playlist no SoundCloud", "user_id" to "Usuário",
    )

    private val REFS = mapOf(
        "research_id" to EntityType.RESEARCH, "category_id" to EntityType.CATEGORY, "playlist_id" to EntityType.PLAYLIST,
    )

    /** Conflitos abertos, prontos para exibir lado a lado (mais recentes primeiro). */
    suspend fun load(store: Store): List<ConflictView> {
        val rows = store.db.dao().observeConflicts().first()
        val cache = mutableMapOf<String, JsonObject?>()
        suspend fun get(type: EntityType, id: String?): JsonObject? {
            if (id == null) return null
            val key = "${type.key}:$id"
            if (key !in cache) cache[key] = store.get(type, id)
            return cache[key]
        }
        suspend fun title(trackId: String?): String = get(EntityType.TRACK, trackId)?.let { t ->
            val artist = Merge.str(t, "artist").orEmpty()
            "${Merge.str(t, "title")}${if (artist.isNotBlank()) " — $artist" else ""}"
        } ?: "faixa desconhecida"
        suspend fun name(type: EntityType, id: String?) = get(type, id)?.let { Merge.str(it, "name") } ?: "desconhecida"

        suspend fun describe(type: EntityType, r: JsonObject): String = when (type) {
            EntityType.TRACK -> title(Merge.str(r, "id"))
            EntityType.RESEARCH, EntityType.CATEGORY, EntityType.PLAYLIST -> Merge.str(r, "name").orEmpty()
            EntityType.DECISION ->
                "${title(Merge.str(r, "track_id"))} · pesquisa ${name(EntityType.RESEARCH, Merge.str(r, "research_id"))}"
            EntityType.TRACK_CATEGORY ->
                "${name(EntityType.CATEGORY, Merge.str(r, "category_id"))} em ${title(Merge.str(r, "track_id"))} · " +
                    "pesquisa ${name(EntityType.RESEARCH, Merge.str(r, "research_id"))}"
            EntityType.PLAYLIST_TRACK ->
                "${title(Merge.str(r, "track_id"))} na playlist ${name(EntityType.PLAYLIST, Merge.str(r, "playlist_id"))}"
        }

        suspend fun label(type: EntityType, field: String, value: JsonElement): String {
            val prim = value as? JsonPrimitive
            val text = prim?.takeIf { it.isString }?.content
            return when {
                field == "deleted_at" -> if (value is JsonNull) "Mantida (não excluída)" else "Excluída"
                type == EntityType.DECISION && field == "decision" -> if (prim?.booleanOrNull == true) "Aprovada" else "Rejeitada"
                field == "merged_into" -> if (value is JsonNull) "Não associada"
                else "Associada a ${get(EntityType.TRACK, text)?.let { Merge.str(it, "title") } ?: "outra faixa"}"
                field in REFS -> if (value is JsonNull) "Nenhuma"
                else get(REFS.getValue(field), text)?.let { Merge.str(it, "name") } ?: "Desconhecida"
                prim?.booleanOrNull != null && !prim.isString -> if (prim.booleanOrNull == true) "Sim" else "Não"
                value is JsonNull -> "(vazio)"
                text != null -> text.ifBlank { "(vazio)" }
                else -> Merge.canonicalJson(value)
            }
        }

        val out = mutableListOf<ConflictView>()
        for (row in rows) {
            val type = runCatching { EntityType.of(row.entity_type) }.getOrNull() ?: continue
            val rec = get(type, row.entity_id) ?: continue
            val candidates = Merge.candidates(rec)[row.field]
            if (candidates == null || candidates.size < 2) continue
            val options = group(row.field, candidates).map { g ->
                ConflictOption(g.value, label(type, row.field, g.value), g.origins.toList(), Hlc.toIso(g.hlc), g.current)
            }
            if (options.size < 2) continue
            out += ConflictView(
                row.id, type, row.entity_id, row.field, KIND[type] ?: type.key, describe(type, rec),
                FIELD[row.field] ?: row.field, options, row.created_at,
            )
        }
        return out.sortedByDescending { it.createdAt }
    }

    private class Group(var value: JsonElement, val origins: LinkedHashSet<String>, var hlc: String, var current: Boolean)

    /** Agrupa candidatos de mesmo valor; o último (maior HLC) é o vencedor provisório. */
    private fun group(field: String, candidates: List<Candidate>): List<Group> {
        val sorted = candidates.sortedBy { it.hlc }
        val winner = sorted.last()
        val groups = mutableListOf<Group>()
        for (c in sorted) {
            val g = groups.firstOrNull { Merge.valuesEquivalent(field, it.value, c.value) }
            if (g != null) {
                g.origins += c.origin
                g.hlc = c.hlc
                g.value = c.value
                g.current = g.current || c === winner
            } else {
                groups += Group(c.value, linkedSetOf(c.origin), c.hlc, c === winner)
            }
        }
        // valor exibido hoje primeiro; depois do mais recente ao mais antigo
        return groups.sortedWith(compareByDescending<Group> { it.current }.thenByDescending { it.hlc })
    }
}
