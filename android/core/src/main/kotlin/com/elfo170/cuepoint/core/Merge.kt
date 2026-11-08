package com.elfo170.cuepoint.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Motor de mesclagem por campo — espelho exato de packages/core/src/merge.ts.
 * Ver spec/README.md para as regras.
 */
object Merge {
    val json = Json { ignoreUnknownKeys = false; encodeDefaults = true }

    /** JSON canônico (chaves ordenadas), igual ao `canonicalJson` do TypeScript. */
    fun canonicalJson(value: JsonElement): String = when (value) {
        is JsonObject -> value.keys.sorted().joinToString(",", "{", "}") { k ->
            JsonPrimitive(k).toString() + ":" + canonicalJson(value.getValue(k))
        }
        is JsonArray -> value.joinToString(",", "[", "]") { canonicalJson(it) }
        else -> value.toString()
    }

    fun valuesEquivalent(field: String, a: JsonElement, b: JsonElement): Boolean =
        if (field == "deleted_at") (a is JsonNull) == (b is JsonNull) else canonicalJson(a) == canonicalJson(b)

    fun candidates(record: JsonObject): Map<String, List<Candidate>> =
        (record["_c"] as? JsonObject)?.mapValues { (_, v) ->
            v.jsonArray.map { json.decodeFromJsonElement<Candidate>(it) }
        } ?: emptyMap()

    fun versions(record: JsonObject?): Map<String, List<String>> =
        (record?.get("_v") as? JsonObject)?.mapValues { (_, v) -> v.jsonArray.map { it.jsonPrimitive.content } } ?: emptyMap()

    /** Campos em conflito: candidatos com valores divergentes. */
    fun conflictFields(record: JsonObject?): List<String> {
        if (record == null) return emptyList()
        return candidates(record).filter { (field, list) ->
            val first = list.first().value
            list.any { !valuesEquivalent(field, it.value, first) }
        }.keys.sorted()
    }

    data class ConflictChange(val field: String, val conflicted: Boolean)
    data class ApplyResult(val record: JsonObject, val conflictChanges: List<ConflictChange>)

    /** Aplica uma operação a um registro (ou cria o registro). */
    fun applyOp(type: EntityType, current: JsonObject?, op: Op): ApplyResult {
        val at = Hlc.toIso(op.hlc)
        val rec: MutableMap<String, JsonElement> = current?.toMutableMap()
            ?: mutableMapOf("id" to JsonPrimitive(op.entityId), "created_at" to JsonPrimitive(at), "updated_at" to JsonPrimitive(at), "_v" to JsonObject(emptyMap()))
        val v = versions(current).toMutableMap()
        val c = (current?.let(::candidates) ?: emptyMap()).toMutableMap()
        val before = conflictFields(current).toSet()

        for ((field, value) in op.fields) {
            if (field in Model.SYSTEM_FIELDS) continue
            val frontier = v[field] ?: emptyList()
            if (op.hlc in frontier) continue

            if (Model.isLww(type, field)) {
                val top = frontier.lastOrNull()
                if (top == null || op.hlc > top) {
                    rec[field] = value
                    v[field] = listOf(op.hlc)
                }
                continue
            }

            val base = op.base[field] ?: emptyList()
            val existing = c[field] ?: frontier.map { Candidate(it, Hlc.parse(it).node, rec[field] ?: JsonNull) }
            val incoming = Candidate(op.hlc, op.origin, value)
            val dominates = frontier.all { it in base }
            val next = (if (dominates) listOf(incoming) else existing.filter { it.hlc !in base } + incoming)
                .sortedBy { it.hlc }
            v[field] = next.map { it.hlc }
            rec[field] = next.last().value
            if (next.size > 1) c[field] = next else c.remove(field)
        }

        val created = (rec["created_at"] as JsonPrimitive).content
        val updated = (rec["updated_at"] as JsonPrimitive).content
        if (at < created) rec["created_at"] = JsonPrimitive(at)
        if (at > updated) rec["updated_at"] = JsonPrimitive(at)
        rec["_v"] = JsonObject(v.mapValues { (_, l) -> JsonArray(l.map(::JsonPrimitive)) })
        if (c.isEmpty()) rec.remove("_c") else rec["_c"] = JsonObject(c.mapValues { (_, l) -> json.encodeToJsonElement(l) })

        val record = JsonObject(rec)
        val after = conflictFields(record).toSet()
        val changes = (after - before).map { ConflictChange(it, true) } + (before - after).map { ConflictChange(it, false) }
        return ApplyResult(record, changes)
    }

    /** Escrita sem efeito (valores iguais e campo sem conflito) — não deve gerar operação. */
    fun isNoopWrite(current: JsonObject?, fields: Map<String, JsonElement>): Boolean {
        if (current == null) return false
        val conflicted = conflictFields(current).toSet()
        return fields.all { (f, value) ->
            f in current && f !in conflicted && valuesEquivalent(f, current.getValue(f), value)
        }
    }

    /** Monta a operação local para as alterações desejadas (inclui `deleted_at = null` implícito). */
    fun buildLocalOp(
        type: EntityType,
        id: String,
        current: JsonObject?,
        changes: Map<String, JsonElement>,
        origin: String,
        seq: Long,
        hlc: String,
        userId: String,
        operation: String? = null,
    ): Op {
        val fields = changes.toMutableMap()
        if ("deleted_at" !in fields) fields["deleted_at"] = JsonNull
        val merged = (current ?: JsonObject(emptyMap())).toMutableMap().apply { putAll(fields) }
        Model.validate(type, merged.filterKeys { it !in Model.SYSTEM_FIELDS })
        val kind = operation ?: when {
            current == null -> "create"
            fields["deleted_at"] !is JsonNull -> "delete"
            else -> "update"
        }
        val v = versions(current)
        return Op(
            opId = Ids.opId(origin, seq),
            origin = origin,
            seq = seq,
            hlc = hlc,
            userId = userId,
            entityType = type.key,
            entityId = id,
            operation = kind,
            fields = JsonObject(fields),
            base = fields.keys.associateWith { v[it] ?: emptyList() },
        )
    }

    fun str(record: JsonObject, field: String): String? = (record[field] as? JsonPrimitive)?.takeIf { it.isString }?.content

    fun isAlive(record: JsonObject?): Boolean = record != null && record["deleted_at"] is JsonNull

    fun parseObject(text: String): JsonObject = json.parseToJsonElement(text).jsonObject
}
