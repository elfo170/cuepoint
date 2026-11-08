package com.elfo170.cuepoint.data

import android.os.Build
import androidx.room.withTransaction
import com.elfo170.cuepoint.core.CausalityException
import com.elfo170.cuepoint.core.EntityType
import com.elfo170.cuepoint.core.Hlc
import com.elfo170.cuepoint.core.HlcClock
import com.elfo170.cuepoint.core.Ids
import com.elfo170.cuepoint.core.Merge
import com.elfo170.cuepoint.core.Op
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

data class Identity(val userId: String, val deviceId: String, val deviceName: String)

@Serializable
private data class ClockState(val last: String? = null, val seq: Long = 0)

@Serializable
private data class IdentityMeta(val userId: String, val deviceId: String)

/** Transação de escrita: cada `put` gera uma operação no log (exceto escritas sem efeito). */
interface WriteTx {
    suspend fun put(type: EntityType, id: String, changes: Map<String, JsonElement>, operation: String? = null): JsonObject
    suspend fun get(type: EntityType, id: String): JsonObject?
}

/**
 * Repositório local sobre o Room — espelho do Store da extensão. Toda escrita grava, na mesma
 * transação: o registro mesclado, a operação (sync_events), o relógio e os conflitos.
 */
class Store(val db: CuePointDatabase, private val now: () -> Long = System::currentTimeMillis) {
    private val dao = db.dao()
    private val mutex = Mutex()
    private var identity: Identity? = null
    private val _changes = MutableSharedFlow<Set<EntityType>>(extraBufferCapacity = 16)

    /** Emite os tipos alterados após cada escrita (para notificação/sincronização). */
    val changes: SharedFlow<Set<EntityType>> = _changes

    suspend fun init(): Identity {
        identity?.let { return it }
        return mutex.withLock {
            identity ?: db.withTransaction {
                val saved = dao.meta("identity")?.let { Merge.json.decodeFromString<IdentityMeta>(it) }
                val device = saved?.let { dao.device(it.deviceId) }
                if (saved != null && device != null) {
                    Identity(saved.userId, saved.deviceId, device.device_name)
                } else {
                    val at = Hlc.isoOf(now())
                    val userId = Ids.newId(now())
                    val deviceId = Ids.newId(now())
                    val name = "Android – ${Build.MODEL ?: "celular"}"
                    dao.putUser(UserRow(userId, at))
                    dao.putDevice(DeviceRow(deviceId, userId, name, null, "self", "ask", at, null))
                    dao.putMeta(MetaRow("identity", Merge.json.encodeToString(IdentityMeta(userId, deviceId))))
                    dao.putMeta(MetaRow("clock", Merge.json.encodeToString(ClockState())))
                    Identity(userId, deviceId, name)
                }
            }.also { identity = it }
        }
    }

    fun resetIdentity() {
        identity = null
    }

    suspend fun get(type: EntityType, id: String): JsonObject? =
        dao.entity(type.key, id)?.let { Merge.parseObject(it.json) }

    suspend fun all(type: EntityType): List<JsonObject> = dao.entities(type.key).map { Merge.parseObject(it.json) }

    suspend fun <R> write(block: suspend (WriteTx) -> R): R {
        val id = init()
        val touched = mutableSetOf<EntityType>()
        val result = mutex.withLock {
            db.withTransaction {
                val state = dao.meta("clock")?.let { Merge.json.decodeFromString<ClockState>(it) } ?: ClockState()
                var seq = state.seq
                val clock = HlcClock(id.deviceId, state.last, now)
                val tx = object : WriteTx {
                    override suspend fun get(type: EntityType, id: String) = this@Store.get(type, id)
                    override suspend fun put(type: EntityType, id: String, changes: Map<String, JsonElement>, operation: String?): JsonObject {
                        val current = get(type, id)
                        val fields = changes.toMutableMap().apply { if ("deleted_at" !in this) put("deleted_at", JsonNull) }
                        if (operation != "resolve" && Merge.isNoopWrite(current, fields)) return current!!
                        seq += 1
                        val op = Merge.buildLocalOp(type, id, current, changes, this@Store.identity!!.deviceId, seq, clock.tick(), this@Store.identity!!.userId, operation)
                        touched += type
                        return applyAndLog(op, "local_pending")
                    }
                }
                val r = block(tx)
                dao.putMeta(MetaRow("clock", Merge.json.encodeToString(ClockState(clock.last, seq))))
                r
            }
        }
        if (touched.isNotEmpty()) _changes.tryEmit(touched)
        return result
    }

    suspend fun put(type: EntityType, id: String, changes: Map<String, JsonElement>, operation: String? = null): JsonObject =
        write { it.put(type, id, changes, operation) }

    /** Exclusão explícita (tombstone propagável). */
    suspend fun remove(type: EntityType, id: String) {
        put(type, id, mapOf("deleted_at" to JsonPrimitive(Hlc.isoOf(now()))), "delete")
    }

    suspend fun resolve(type: EntityType, id: String, field: String, value: JsonElement) {
        put(type, id, mapOf(field to value), "resolve")
    }

    /** Recebe operações de outro aparelho (entrega causal, idempotente). */
    suspend fun receive(ops: List<Op>): Int {
        val id = init()
        val touched = mutableSetOf<EntityType>()
        val applied = mutex.withLock {
            db.withTransaction {
                val vv = versionVector().toMutableMap()
                val state = dao.meta("clock")?.let { Merge.json.decodeFromString<ClockState>(it) } ?: ClockState()
                val clock = HlcClock(id.deviceId, state.last, now)
                var count = 0
                for (op in ops.map { it.validate() }.sortedBy { it.hlc }) {
                    val have = vv[op.origin] ?: 0
                    if (op.seq <= have) continue
                    if (op.seq != have + 1) throw CausalityException("lacuna em ${op.origin}: esperado ${have + 1}, recebido ${op.seq}")
                    clock.receive(op.hlc)
                    applyAndLog(op, "received")
                    vv[op.origin] = op.seq
                    touched += op.type
                    count++
                }
                dao.putMeta(MetaRow("clock", Merge.json.encodeToString(ClockState(clock.last, state.seq))))
                count
            }
        }
        if (touched.isNotEmpty()) _changes.tryEmit(touched)
        return applied
    }

    suspend fun versionVector(): Map<String, Long> = dao.versionVector().associate { it.origin to it.seq }

    suspend fun opsSince(remote: Map<String, Long>): List<Op> =
        dao.events().filter { it.seq > (remote[it.origin] ?: 0) }.map { Merge.json.decodeFromString<Op>(it.json) }

    private suspend fun applyAndLog(op: Op, status: String): JsonObject {
        val current = get(op.type, op.entityId)
        val result = Merge.applyOp(op.type, current, op)
        dao.upsertEntity(toRow(op.type, result.record))
        dao.insertEvent(
            SyncEventRow(op.opId, op.origin, op.seq, op.hlc, op.entityType, op.entityId, op.operation, Hlc.toIso(op.hlc), status, Merge.json.encodeToString(op)),
        )
        for (change in result.conflictChanges) {
            val cid = Ids.conflictId(op.entityType, op.entityId, change.field)
            if (change.conflicted) dao.upsertConflict(ConflictRow(cid, op.entityType, op.entityId, change.field, Hlc.toIso(op.hlc)))
            else dao.deleteConflict(cid)
        }
        return result.record
    }

    suspend fun getMeta(key: String): String? = dao.meta(key)
    suspend fun setMeta(key: String, value: String) = dao.putMeta(MetaRow(key, value))

    suspend fun renameDevice(name: String) {
        val id = init()
        val device = dao.device(id.deviceId) ?: return
        require(name.isNotBlank()) { "Informe um nome." }
        dao.putDevice(device.copy(device_name = name.trim()))
        identity = null
    }

    companion object {
        fun toRow(type: EntityType, record: JsonObject) = EntityRow(
            type = type.key,
            id = Merge.str(record, "id")!!,
            json = Merge.json.encodeToString(JsonObject.serializer(), record),
            deleted = record["deleted_at"] !is JsonNull,
            track_id = Merge.str(record, "track_id"),
            research_id = Merge.str(record, "research_id"),
            category_id = Merge.str(record, "category_id"),
            playlist_id = Merge.str(record, "playlist_id"),
            soundcloud_url = Merge.str(record, "soundcloud_url"),
            updated_at = Merge.str(record, "updated_at") ?: "",
        )
    }
}
