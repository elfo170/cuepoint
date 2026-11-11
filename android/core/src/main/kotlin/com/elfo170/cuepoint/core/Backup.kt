package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

class BackupException(message: String) : IllegalArgumentException(message)

/** Conteúdo de um backup já validado. */
class BackupFile(
    val root: JsonObject,
    val createdAt: String,
    val deviceId: String,
    val userId: String,
    val sha256: String,
    val entities: Map<EntityType, List<JsonObject>>,
    val ops: List<Op>,
    val users: List<JsonObject>,
    val devices: List<JsonObject>,
    val conflicts: List<JsonObject>,
    val settings: JsonObject,
) {
    fun counts(): Map<String, Int> = Backups.counts(entities, ops.size)
}

/**
 * Formato `cuepoint-backup` v1 — espelho de packages/core/src/backup.ts (validado por
 * spec/vectors/backup.json). Todas as entidades (com tombstones e metadados de mesclagem), o log de
 * operações, usuários, dispositivos, conflitos e o SHA-256 do JSON canônico do corpo.
 */
object Backups {
    const val FORMAT = "cuepoint-backup"
    const val VERSION = 1

    /** Referências obrigatórias: [tipo, campo, tipo referenciado, aceita null] (igual ao TS). */
    private val REFERENCES = listOf(
        Ref(EntityType.DECISION, "track_id", EntityType.TRACK, false),
        Ref(EntityType.DECISION, "research_id", EntityType.RESEARCH, false),
        Ref(EntityType.TRACK_CATEGORY, "track_id", EntityType.TRACK, false),
        Ref(EntityType.TRACK_CATEGORY, "research_id", EntityType.RESEARCH, false),
        Ref(EntityType.TRACK_CATEGORY, "category_id", EntityType.CATEGORY, false),
        Ref(EntityType.PLAYLIST, "research_id", EntityType.RESEARCH, true),
        Ref(EntityType.PLAYLIST, "category_id", EntityType.CATEGORY, true),
        Ref(EntityType.PLAYLIST_TRACK, "playlist_id", EntityType.PLAYLIST, false),
        Ref(EntityType.PLAYLIST_TRACK, "track_id", EntityType.TRACK, false),
        Ref(EntityType.TRACK, "merged_into", EntityType.TRACK, true),
    )

    private data class Ref(val type: EntityType, val field: String, val target: EntityType, val nullable: Boolean)

    fun counts(entities: Map<EntityType, List<JsonObject>>, ops: Int): Map<String, Int> =
        EntityType.entries.associate { it.key to (entities[it]?.size ?: 0) } + ("ops" to ops)

    fun create(
        entities: Map<EntityType, List<JsonObject>>,
        ops: List<Op>,
        users: List<JsonObject>,
        devices: List<JsonObject>,
        conflicts: List<JsonObject>,
        settings: JsonObject,
        deviceId: String,
        userId: String,
        nowMs: Long,
        schemaVersion: Int = CuePointCore.SCHEMA_VERSION,
    ): JsonObject {
        val data = buildJsonObject {
            put("entities", JsonObject(EntityType.entries.associate { it.key to JsonArray(entities[it].orEmpty()) }))
            put("ops", JsonArray(ops.map { Merge.json.encodeToJsonElement(it) }))
            put("users", JsonArray(users))
            put("devices", JsonArray(devices))
            put("conflicts", JsonArray(conflicts))
            put("settings", settings)
        }
        val body = buildJsonObject {
            put("format", FORMAT)
            put("version", VERSION)
            put("schema_version", schemaVersion)
            put("created_at", Hlc.isoOf(nowMs))
            put("device_id", deviceId)
            put("user_id", userId)
            put("counts", JsonObject(counts(entities, ops.size).mapValues { JsonPrimitive(it.value) }))
            put("data", data)
        }
        return JsonObject(body + ("sha256" to JsonPrimitive(checksum(body))))
    }

    fun checksum(body: JsonObject): String = Protocol.sha256Hex(Merge.canonicalJson(body))

    fun encode(backup: JsonObject): String = Merge.json.encodeToString(JsonObject.serializer(), backup)

    fun parse(text: String): BackupFile {
        val json = try {
            Merge.json.parseToJsonElement(text)
        } catch (_: Exception) {
            throw BackupException("O arquivo não é um JSON válido (pode estar truncado).")
        }
        return validate(json)
    }

    /**
     * Valida antes de restaurar: formato, checksum, registros (schema), operações e integridade
     * referencial. Lança [BackupException] com uma mensagem legível (as mesmas do TypeScript).
     */
    fun validate(input: JsonElement): BackupFile {
        val b = input as? JsonObject ?: throw BackupException("Arquivo de backup inválido.")
        if (b.str("format") != FORMAT) throw BackupException("Não é um backup do CuePoint.")
        val version = (b["version"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
        if (version != VERSION) throw BackupException("Versão de backup não suportada: ${b["version"]?.let(::plain) ?: "undefined"}.")
        val sha = b.str("sha256")
        val body = JsonObject(b - "sha256")
        if (sha == null || checksum(body) != sha) {
            throw BackupException("Checksum não confere: o arquivo está corrompido ou foi alterado.")
        }
        val data = b["data"] as? JsonObject
        val entitiesJson = data?.get("entities") as? JsonObject
        val opsJson = data?.get("ops") as? JsonArray
        if (data == null || entitiesJson == null || opsJson == null) throw BackupException("Backup incompleto.")

        val entities = mutableMapOf<EntityType, List<JsonObject>>()
        val ids = mutableMapOf<EntityType, MutableSet<String>>()
        for (type in EntityType.entries) {
            val records = entitiesJson[type.key] as? JsonArray ?: throw BackupException("Backup sem a tabela ${type.key}.")
            val seen = mutableSetOf<String>()
            entities[type] = records.map { el ->
                val rec = el as? JsonObject ?: throw BackupException("Registro inválido em ${type.key}.")
                val id = rec.str("id")
                if (id == null || !UUID_RE.matches(id) || rec.str("created_at") == null || rec.str("updated_at") == null || !validVersions(rec["_v"])) {
                    throw BackupException("Registro inválido em ${type.key}.")
                }
                try {
                    Model.validate(type, rec - Model.SYSTEM_FIELDS)
                } catch (_: IllegalArgumentException) {
                    throw BackupException("Dados inválidos em ${type.key} $id.")
                }
                if (!seen.add(id)) throw BackupException("Id duplicado em ${type.key}: $id.")
                rec
            }
            ids[type] = seen
        }
        for (ref in REFERENCES) {
            for (rec in entities.getValue(ref.type)) {
                val value = rec[ref.field]
                if (value is JsonNull && ref.nullable) continue
                val target = (value as? JsonPrimitive)?.contentOrNull
                if (target == null || target !in ids.getValue(ref.target)) {
                    throw BackupException("Referência quebrada: ${ref.type.key}.${ref.field} → ${ref.target.key} ${target ?: "null"}.")
                }
            }
        }
        val ops = try {
            opsJson.map { Merge.json.decodeFromJsonElement<Op>(it).validate() }
        } catch (_: Exception) {
            throw BackupException("Log de operações inválido.")
        }
        return BackupFile(
            root = b,
            createdAt = b.str("created_at") ?: "",
            deviceId = b.str("device_id") ?: throw BackupException("Backup incompleto."),
            userId = b.str("user_id") ?: throw BackupException("Backup incompleto."),
            sha256 = sha,
            entities = entities,
            ops = ops,
            users = data.objects("users"),
            devices = data.objects("devices"),
            conflicts = data.objects("conflicts"),
            settings = data["settings"] as? JsonObject ?: JsonObject(emptyMap()),
        )
    }

    private val UUID_RE = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)

    private fun validVersions(v: JsonElement?): Boolean = v is JsonObject && v.values.all { arr ->
        arr is JsonArray && arr.all { it is JsonPrimitive && it.isString }
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.objects(key: String): List<JsonObject> = (this[key] as? JsonArray)?.filterIsInstance<JsonObject>().orEmpty()

    private fun plain(e: JsonElement): String = (e as? JsonPrimitive)?.content ?: e.toString()
}
