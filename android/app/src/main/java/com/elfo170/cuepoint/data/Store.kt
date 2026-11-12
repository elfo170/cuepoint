package com.elfo170.cuepoint.data

import android.os.Build
import androidx.room.withTransaction
import com.elfo170.cuepoint.core.BackupFile
import com.elfo170.cuepoint.core.Backups
import com.elfo170.cuepoint.core.CausalityException
import com.elfo170.cuepoint.core.Compaction
import com.elfo170.cuepoint.core.EntityType
import com.elfo170.cuepoint.core.Hlc
import com.elfo170.cuepoint.core.HlcClock
import com.elfo170.cuepoint.core.Ids
import com.elfo170.cuepoint.core.Isolation
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class Identity(val userId: String, val deviceId: String, val deviceName: String)

@Serializable
private data class ClockState(val last: String? = null, val seq: Long = 0)

@Serializable
private data class IdentityMeta(val userId: String, val deviceId: String)

/** Transação de escrita: cada `put` gera uma operação no log (exceto escritas sem efeito). */
interface WriteTx {
    /**
     * Grava as alterações. Com [concurrent], a escrita não "viu" o estado atual: valor divergente
     * vira conflito em vez de sobrescrever (ver `Merge.buildLocalOp`).
     */
    suspend fun put(
        type: EntityType,
        id: String,
        changes: Map<String, JsonElement>,
        operation: String? = null,
        concurrent: Boolean = false,
    ): JsonObject
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

    /** Registros do usuário local (isolamento por usuário, PRD §16). */
    suspend fun all(type: EntityType): List<JsonObject> {
        val userId = init().userId
        return dao.entities(type.key).map { Merge.parseObject(it.json) }.filter { Isolation.owned(it, userId) }
    }

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
                    override suspend fun put(
                        type: EntityType,
                        id: String,
                        changes: Map<String, JsonElement>,
                        operation: String?,
                        concurrent: Boolean,
                    ): JsonObject {
                        val current = get(type, id)
                        val fields = changes.toMutableMap().apply { if ("deleted_at" !in this) put("deleted_at", JsonNull) }
                        if (operation != "resolve" && Merge.isNoopWrite(current, fields)) return current!!
                        seq += 1
                        val op = Merge.buildLocalOp(
                            type, id, current, changes, this@Store.identity!!.deviceId, seq, clock.tick(),
                            this@Store.identity!!.userId, operation, concurrent,
                        )
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
        val validated = ops.map { it.validate() }
        // Isolamento por usuário: um lote com operação de outro usuário é recusado inteiro.
        Isolation.assertSameUser(validated, id.userId)
        val touched = mutableSetOf<EntityType>()
        val applied = mutex.withLock {
            db.withTransaction {
                val vv = versionVector().toMutableMap()
                val state = dao.meta("clock")?.let { Merge.json.decodeFromString<ClockState>(it) } ?: ClockState()
                val clock = HlcClock(id.deviceId, state.last, now)
                var count = 0
                for (op in validated.sortedBy { it.hlc }) {
                    val have = vv[op.origin] ?: 0
                    if (op.seq <= have) continue
                    if (op.seq != have + 1) throw CausalityException("lacuna em ${op.origin}: esperado ${have + 1}, recebido ${op.seq}")
                    clock.receive(op.hlc)
                    applyAndLog(op, "received")
                    vv[op.origin] = op.seq
                    touched += op.type
                    count++
                }
                // Operações próprias devolvidas por um par (ex.: depois de restaurar um backup antigo):
                // a sequência local continua depois delas, sem reutilizar números.
                val ownSeq = maxOf(state.seq, vv[id.deviceId] ?: 0L)
                dao.putMeta(MetaRow("clock", Merge.json.encodeToString(ClockState(clock.last, ownSeq))))
                count
            }
        }
        if (touched.isNotEmpty()) _changes.tryEmit(touched)
        return applied
    }

    suspend fun versionVector(): Map<String, Long> = dao.versionVector().associate { it.origin to it.seq }

    /**
     * Quantas operações daqui faltam para quem tem [vv]. As sequências de cada origem são
     * contínuas (entrega causal), então basta a diferença por origem.
     */
    suspend fun pendingFor(vv: Map<String, Long>): Int =
        versionVector().entries.sumOf { (origin, max) -> maxOf(0L, max - (vv[origin] ?: 0L)) }.toInt()

    /** O que o par [peerId] já tem, visto na última troca com ele (null: ainda não houve troca). */
    suspend fun knownBy(peerId: String): Map<String, Long>? =
        getMeta("sync.known.$peerId")?.let { Merge.json.decodeFromString<Map<String, Long>>(it) }

    /** Registra que o par tem (pelo menos) o que [vv] indica. */
    suspend fun noteKnown(peerId: String, vv: Map<String, Long>) {
        val prev = knownBy(peerId).orEmpty()
        val merged = (prev.keys + vv.keys).associateWith { k -> maxOf(prev[k] ?: 0L, vv[k] ?: 0L) }
        setMeta("sync.known.$peerId", Merge.json.encodeToString(merged))
    }

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

    /** Marca operações próprias como enviadas (não podem mais ser compactadas). */
    suspend fun markSent(ops: List<Op>) {
        val id = init()
        val own = ops.filter { it.origin == id.deviceId }.map { it.opId }
        own.chunked(500).forEach { dao.markSent(it) }
    }

    /**
     * Compacta as operações próprias ainda não enviadas (várias do mesmo registro viram uma)
     * e recalcula os registros a partir do log. Retorna quantas operações deixaram de existir.
     */
    suspend fun compactPending(): Int {
        val id = init()
        val removed = mutex.withLock {
            db.withTransaction {
                val pending = dao.pendingOwn(id.deviceId)
                if (pending.size < 2) return@withTransaction 0
                val fromSeq = pending.first().seq
                if (dao.countOwnFrom(id.deviceId, fromSeq) != pending.size) return@withTransaction 0
                val ops = pending.map { Merge.json.decodeFromString<Op>(it.json) }
                val compacted = Compaction.compactOps(ops, fromSeq)
                if (compacted.size == ops.size) return@withTransaction 0
                dao.deleteEvents(pending.map { it.op_id })
                for (op in compacted) {
                    dao.insertEvent(SyncEventRow(op.opId, op.origin, op.seq, op.hlc, op.entityType, op.entityId, op.operation, Hlc.toIso(op.hlc), "local_pending", Merge.json.encodeToString(op)))
                }
                val all = dao.events().map { Merge.json.decodeFromString<Op>(it.json) }
                val records = Compaction.rebuild(all)
                dao.clearEntities()
                dao.clearConflicts()
                for ((key, rec) in records) {
                    val type = EntityType.of(key.substringBefore(':'))
                    dao.upsertEntity(toRow(type, rec))
                    for (field in Merge.conflictFields(rec)) {
                        val eid = Merge.str(rec, "id")!!
                        dao.upsertConflict(ConflictRow(Ids.conflictId(type.key, eid, field), type.key, eid, field, Hlc.isoOf(now())))
                    }
                }
                val state = dao.meta("clock")?.let { Merge.json.decodeFromString<ClockState>(it) } ?: ClockState()
                dao.putMeta(MetaRow("clock", Merge.json.encodeToString(state.copy(seq = fromSeq + compacted.size - 1))))
                ops.size - compacted.size
            }
        }
        if (removed > 0) _changes.tryEmit(EntityType.entries.toSet())
        return removed
    }

    /**
     * No primeiro pareamento, um aparelho ainda vazio adota o usuário do PC, para que os dois
     * apareçam como a mesma pessoa (PRD §4: bibliotecas privadas por usuário).
     */
    suspend fun adoptUserIfEmpty(userId: String): Boolean {
        val id = init()
        if (id.userId == userId || dao.entityCount() > 0) return false
        val at = Hlc.isoOf(now())
        dao.putUser(UserRow(userId, at))
        dao.device(id.deviceId)?.let { dao.putDevice(it.copy(user_id = userId)) }
        dao.putMeta(MetaRow("identity", Merge.json.encodeToString(IdentityMeta(userId, id.deviceId))))
        identity = null
        return true
    }

    /** Monta o backup `cuepoint-backup` v1 com todo o conteúdo do banco (formato comum ao Chrome). */
    suspend fun exportBackup(): JsonObject {
        val id = init()
        return mutex.withLock {
            db.withTransaction {
                val entities = EntityType.entries.associateWith { t ->
                    dao.entities(t.key).map { Merge.parseObject(it.json) }.sortedBy { Merge.str(it, "id") }
                }
                Backups.create(
                    entities = entities,
                    ops = dao.events().map { Merge.json.decodeFromString<Op>(it.json) },
                    users = dao.users().map { buildJsonObject { put("id", it.id); put("created_at", it.created_at) } },
                    devices = dao.devices().map(::deviceJson),
                    conflicts = dao.conflicts().map {
                        buildJsonObject {
                            put("id", it.id); put("entity_type", it.entity_type); put("entity_id", it.entity_id)
                            put("field", it.field); put("created_at", it.created_at)
                        }
                    },
                    settings = buildJsonObject { put("activeResearchId", dao.meta("activeResearchId")?.takeIf(String::isNotEmpty)) },
                    deviceId = id.deviceId,
                    userId = id.userId,
                    nowMs = now(),
                )
            }
        }
    }

    /**
     * Restaura um backup já validado, substituindo a biblioteca numa única transação (tudo ou nada).
     *
     * Diferente do Chrome, o celular **mantém a própria identidade de aparelho** (id, chaves e
     * pareamentos ficam como estão) e adota o usuário do backup: assim um backup do PC ou de um
     * celular antigo não faz dois aparelhos compartilharem o mesmo id. Operações deste aparelho
     * que vierem no backup continuam suas; as demais entram como recebidas.
     */
    suspend fun restore(backup: BackupFile) {
        val id = init()
        mutex.withLock {
            db.withTransaction {
                dao.clearEntities()
                dao.clearConflicts()
                dao.clearEvents()
                dao.clearUsers()
                for ((type, records) in backup.entities) records.forEach { dao.upsertEntity(toRow(type, it)) }
                for (op in backup.ops.sortedBy { it.hlc }) {
                    val status = if (op.origin == id.deviceId) "local_sent" else "received"
                    dao.insertEvent(SyncEventRow(op.opId, op.origin, op.seq, op.hlc, op.entityType, op.entityId, op.operation, Hlc.toIso(op.hlc), status, Merge.json.encodeToString(op)))
                }
                for (c in backup.conflicts) {
                    val s = { k: String -> Merge.str(c, k) }
                    val cid = s("id") ?: continue
                    dao.upsertConflict(ConflictRow(cid, s("entity_type") ?: continue, s("entity_id") ?: continue, s("field") ?: continue, s("created_at") ?: ""))
                }
                for (u in backup.users) {
                    val uid = Merge.str(u, "id") ?: continue
                    dao.putUser(UserRow(uid, Merge.str(u, "created_at") ?: Hlc.isoOf(now())))
                }
                if (dao.user(backup.userId) == null) dao.putUser(UserRow(backup.userId, Hlc.isoOf(now())))
                dao.device(id.deviceId)?.let { dao.putDevice(it.copy(user_id = backup.userId)) }
                dao.putMeta(MetaRow("identity", Merge.json.encodeToString(IdentityMeta(backup.userId, id.deviceId))))
                val lastHlc = backup.ops.maxOfOrNull { it.hlc }
                val previous = dao.meta("clock")?.let { Merge.json.decodeFromString<ClockState>(it) } ?: ClockState()
                val last = listOfNotNull(previous.last, lastHlc).maxOrNull()
                val ownSeq = backup.ops.filter { it.origin == id.deviceId }.maxOfOrNull { it.seq } ?: 0L
                dao.putMeta(MetaRow("clock", Merge.json.encodeToString(ClockState(last, ownSeq))))
                dao.putMeta(MetaRow("activeResearchId", Merge.str(backup.settings, "activeResearchId") ?: ""))
                // o que cada par "já tem" é recalculado na próxima sincronização
                dao.deleteMetaPrefix("sync.known.")
            }
            identity = null
        }
        _changes.tryEmit(EntityType.entries.toSet())
    }

    suspend fun getMeta(key: String): String? = dao.meta(key)
    suspend fun setMeta(key: String, value: String) = dao.putMeta(MetaRow(key, value))
    suspend fun deleteMeta(key: String) = dao.deleteMeta(key)

    suspend fun renameDevice(name: String) {
        val id = init()
        val device = dao.device(id.deviceId) ?: return
        require(name.isNotBlank()) { "Informe um nome." }
        dao.putDevice(device.copy(device_name = name.trim()))
        identity = null
    }

    companion object {
        fun deviceJson(d: DeviceRow): JsonObject = buildJsonObject {
            put("id", d.id); put("user_id", d.user_id); put("device_name", d.device_name)
            put("public_key", d.public_key); put("pairing_status", d.pairing_status); put("sync_policy", d.sync_policy)
            put("created_at", d.created_at); put("last_sync_at", d.last_sync_at)
            put("cert_fp", d.cert_fp); put("addresses", d.addresses); put("port", d.port)
        }

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
