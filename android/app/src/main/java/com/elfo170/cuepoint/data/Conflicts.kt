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
    /** Texto legível do valor (ex.: "Aprovada", "Excluída"); nunca um identificador cru. */
    val label: String,
    /** Aparelhos que gravaram este valor (device_id). */
    val origins: List<String>,
    /** Momento da gravação mais recente deste valor (ISO). */
    val at: String,
    /** É o valor exibido hoje (vencedor provisório: o mais recente). */
    val current: Boolean,
    /** Valor técnico (id, URN, JSON) sem nome legível: a tela mostra "Versão de <aparelho>". */
    val technical: Boolean = false,
)

/** Conflito pronto para a tela: o que é, qual campo e as opções lado a lado. */
data class ConflictView(
    val id: String,
    val entityType: EntityType,
    val entityId: String,
    val field: String,
    val kind: String,
    /** Nome legível do registro (título da faixa, nome da pesquisa…); sem nome, o tipo. */
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

    /** Campos cujo valor é sempre técnico (chave de ordenação, ids). */
    private val TECHNICAL_FIELDS = setOf("position", "user_id", "soundcloud_urn", "external_playlist_id")

    private val UUID_RE = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

    const val TECHNICAL = "(valor técnico)"

    /** Texto parecido com identificador (UUID ou URN do SoundCloud), que não se mostra cru. */
    fun isIdLike(text: String): Boolean = text.trim().let { UUID_RE.matches(it) || it.startsWith("soundcloud:", ignoreCase = true) }

    /** Nome do aparelho de origem; desconhecido vira "outro aparelho" (nunca o id). */
    fun originName(id: String, names: Map<String, String>): String = names[id] ?: "outro aparelho"

    /** Texto de uma opção na tela: valores técnicos viram "Versão de <aparelho>". */
    fun optionText(option: ConflictOption, names: Map<String, String>): String = when {
        !option.technical -> option.label
        option.origins.isEmpty() -> TECHNICAL
        else -> "Versão de ${option.origins.map { originName(it, names) }.distinct().joinToString()}"
    }

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
        suspend fun title(trackId: String?): String? = get(EntityType.TRACK, trackId)?.let { t ->
            val title = Merge.str(t, "title")?.takeIf { it.isNotBlank() } ?: return@let null
            val artist = Merge.str(t, "artist").orEmpty()
            "$title${if (artist.isNotBlank()) " — $artist" else ""}"
        }

        suspend fun describe(type: EntityType, r: JsonObject): String? = when (type) {
            EntityType.TRACK -> title(Merge.str(r, "id"))
            EntityType.RESEARCH, EntityType.CATEGORY, EntityType.PLAYLIST -> Merge.str(r, "name")?.takeIf { it.isNotBlank() }
            EntityType.DECISION, EntityType.TRACK_CATEGORY, EntityType.PLAYLIST_TRACK -> title(Merge.str(r, "track_id"))
        }

        /** Texto legível do valor; null = valor técnico sem nome (nunca mostrado cru). */
        suspend fun label(type: EntityType, field: String, value: JsonElement): String? {
            val prim = value as? JsonPrimitive
            val text = prim?.takeIf { it.isString }?.content
            return when {
                field == "deleted_at" -> if (value is JsonNull) "Mantida (não excluída)" else "Excluída"
                type == EntityType.DECISION && field == "decision" -> if (prim?.booleanOrNull == true) "Aprovada" else "Rejeitada"
                field == "merged_into" -> if (value is JsonNull) "Não associada"
                else "Associada a ${get(EntityType.TRACK, text)?.let { Merge.str(it, "title") } ?: "outra faixa"}"
                field in REFS -> if (value is JsonNull) "Nenhuma"
                else get(REFS.getValue(field), text)?.let { Merge.str(it, "name") } ?: "Desconhecida"
                field == "track_id" && text != null -> get(EntityType.TRACK, text)?.let { Merge.str(it, "title") }
                prim?.booleanOrNull != null && !prim.isString -> if (prim.booleanOrNull == true) "Sim" else "Não"
                value is JsonNull -> "(vazio)"
                field in TECHNICAL_FIELDS -> null
                text != null -> if (isIdLike(text)) null else text.ifBlank { "(vazio)" }
                else -> null // número, objeto ou lista sem rótulo legível
            }
        }

        val out = mutableListOf<ConflictView>()
        for (row in rows) {
            val type = runCatching { EntityType.of(row.entity_type) }.getOrNull() ?: continue
            val rec = get(type, row.entity_id) ?: continue
            val candidates = Merge.candidates(rec)[row.field]
            if (candidates == null || candidates.size < 2) continue
            val options = group(row.field, candidates).map { g ->
                val label = label(type, row.field, g.value)
                ConflictOption(g.value, label ?: TECHNICAL, g.origins.toList(), Hlc.toIso(g.hlc), g.current, technical = label == null)
            }
            if (options.size < 2) continue
            val kind = KIND[type] ?: "Registro"
            out += ConflictView(
                row.id, type, row.entity_id, row.field, kind, describe(type, rec) ?: kind,
                FIELD[row.field] ?: "Outro dado", options, row.created_at,
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
