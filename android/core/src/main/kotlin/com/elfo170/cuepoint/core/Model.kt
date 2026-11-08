package com.elfo170.cuepoint.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Modelo de dados — espelho de packages/core/src/model.ts.
 * Registros são objetos JSON planos (campos de domínio + id, created_at, updated_at, _v, _c),
 * exatamente como no TypeScript, para que a mesclagem seja idêntica nas duas plataformas.
 */
enum class EntityType(val key: String) {
    TRACK("track"),
    RESEARCH("research"),
    DECISION("decision"),
    CATEGORY("category"),
    TRACK_CATEGORY("track_category"),
    PLAYLIST("playlist"),
    PLAYLIST_TRACK("playlist_track");

    companion object {
        fun of(key: String) = entries.firstOrNull { it.key == key } ?: throw IllegalArgumentException("tipo desconhecido: $key")
    }
}

object Model {
    val SYSTEM_FIELDS = setOf("id", "created_at", "updated_at", "_v", "_c")

    private val LWW = mapOf(
        EntityType.DECISION to setOf("device_source"),
        EntityType.TRACK to setOf("title", "artist", "soundcloud_url", "artwork_url", "metadata_source"),
    )

    fun isLww(type: EntityType, field: String) = LWW[type]?.contains(field) == true

    private enum class Kind { STRING, NONBLANK, STRING_NULL, UUID, UUID_NULL, BOOL, ISO_NULL, URN_NULL }

    private val FIELDS: Map<EntityType, Map<String, Kind>> = mapOf(
        EntityType.TRACK to mapOf(
            "soundcloud_urn" to Kind.URN_NULL, "soundcloud_url" to Kind.STRING_NULL, "title" to Kind.NONBLANK,
            "artist" to Kind.STRING, "artwork_url" to Kind.STRING_NULL, "metadata_source" to Kind.NONBLANK,
            "merged_into" to Kind.UUID_NULL, "deleted_at" to Kind.ISO_NULL,
        ),
        EntityType.RESEARCH to mapOf(
            "user_id" to Kind.UUID, "name" to Kind.NONBLANK, "description" to Kind.STRING,
            "archived" to Kind.BOOL, "deleted_at" to Kind.ISO_NULL,
        ),
        EntityType.DECISION to mapOf(
            "user_id" to Kind.UUID, "track_id" to Kind.UUID, "research_id" to Kind.UUID,
            "decision" to Kind.BOOL, "device_source" to Kind.NONBLANK, "deleted_at" to Kind.ISO_NULL,
        ),
        EntityType.CATEGORY to mapOf(
            "user_id" to Kind.UUID, "name" to Kind.NONBLANK, "description" to Kind.STRING, "deleted_at" to Kind.ISO_NULL,
        ),
        EntityType.TRACK_CATEGORY to mapOf(
            "track_id" to Kind.UUID, "research_id" to Kind.UUID, "category_id" to Kind.UUID, "deleted_at" to Kind.ISO_NULL,
        ),
        EntityType.PLAYLIST to mapOf(
            "user_id" to Kind.UUID, "name" to Kind.NONBLANK, "description" to Kind.STRING,
            "research_id" to Kind.UUID_NULL, "category_id" to Kind.UUID_NULL,
            "external_playlist_id" to Kind.STRING_NULL, "deleted_at" to Kind.ISO_NULL,
        ),
        EntityType.PLAYLIST_TRACK to mapOf(
            "playlist_id" to Kind.UUID, "track_id" to Kind.UUID, "position" to Kind.NONBLANK, "deleted_at" to Kind.ISO_NULL,
        ),
    )

    fun fields(type: EntityType): Set<String> = FIELDS.getValue(type).keys

    private val UUID_RE = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    private val URN_RE = Regex("""^soundcloud:tracks:\d+$""")
    private val ISO_RE = Regex("""^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$""")

    /** Regras de integridade (PRD §6.2). Lança IllegalArgumentException com o campo inválido. */
    fun validate(type: EntityType, data: Map<String, JsonElement>) {
        for ((field, kind) in FIELDS.getValue(type)) {
            val v = data[field] ?: throw IllegalArgumentException("$type: campo ausente $field")
            val str = (v as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            val ok = when (kind) {
                Kind.STRING -> str != null
                Kind.NONBLANK -> !str.isNullOrBlank()
                Kind.STRING_NULL -> v is JsonNull || str != null
                Kind.UUID -> str != null && UUID_RE.matches(str)
                Kind.UUID_NULL -> v is JsonNull || (str != null && UUID_RE.matches(str))
                Kind.BOOL -> v is JsonPrimitive && !v.isString && v.booleanOrNull != null
                Kind.ISO_NULL -> v is JsonNull || (str != null && ISO_RE.matches(str))
                Kind.URN_NULL -> v is JsonNull || (str != null && URN_RE.matches(str))
            }
            require(ok) { "$type: valor inválido em $field" }
        }
    }
}

@Serializable
data class Candidate(val hlc: String, val origin: String, val value: JsonElement)

/** Operação do log (SyncEvents) — espelho de packages/core/src/ops.ts. */
@Serializable
data class Op(
    @SerialName("op_id") val opId: String,
    val origin: String,
    val seq: Long,
    val hlc: String,
    @SerialName("user_id") val userId: String,
    @SerialName("entity_type") val entityType: String,
    @SerialName("entity_id") val entityId: String,
    val operation: String,
    val fields: JsonObject,
    val base: Map<String, List<String>>,
) {
    val type: EntityType get() = EntityType.of(entityType)

    fun validate(): Op {
        require(opId == Ids.opId(origin, seq)) { "op_id inconsistente em $opId" }
        Hlc.parse(hlc)
        EntityType.of(entityType)
        require(seq > 0) { "seq inválido" }
        return this
    }
}
