package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

class CausalityException(message: String) : IllegalStateException(message)

data class ConflictInfo(val entityType: String, val entityId: String, val field: String)

/** Réplica em memória — implementação de referência, espelho de packages/core/src/replica.ts. */
class Replica(val deviceId: String, val userId: String, now: () -> Long = System::currentTimeMillis) {
    val records = linkedMapOf<String, JsonObject>()
    val log = mutableListOf<Op>()
    val vv = mutableMapOf<String, Long>()
    val clock = HlcClock(deviceId, null, now)
    private var seq = 0L

    fun get(type: EntityType, id: String) = records["${type.key}:$id"]

    fun put(type: EntityType, id: String, changes: Map<String, JsonElement>, operation: String? = null): Op {
        val op = Merge.buildLocalOp(type, id, get(type, id), changes, deviceId, seq + 1, clock.tick(), userId, operation)
        seq += 1
        applyAndLog(op)
        return op
    }

    fun delete(type: EntityType, id: String): Op =
        put(type, id, mapOf("deleted_at" to JsonPrimitive(Hlc.isoOf(clock.now()))))

    /** Recebe operações remotas: idempotente, exige entrega causal. Retorna quantas aplicou. */
    fun receive(ops: List<Op>): Int {
        var applied = 0
        for (op in ops.sortedBy { it.hlc }) {
            val have = vv[op.origin] ?: 0
            if (op.seq <= have) continue
            if (op.seq != have + 1) throw CausalityException("lacuna em ${op.origin}: esperado ${have + 1}, recebido ${op.seq}")
            clock.receive(op.hlc)
            applyAndLog(op)
            applied++
        }
        return applied
    }

    fun opsSince(remote: Map<String, Long>): List<Op> =
        log.filter { it.seq > (remote[it.origin] ?: 0) }.sortedBy { it.hlc }

    fun conflicts(): List<ConflictInfo> = records.flatMap { (key, rec) ->
        val type = key.substringBefore(':')
        Merge.conflictFields(rec).map { ConflictInfo(type, Merge.str(rec, "id")!!, it) }
    }

    private fun applyAndLog(op: Op) {
        val key = "${op.entityType}:${op.entityId}"
        records[key] = Merge.applyOp(op.type, records[key], op).record
        log += op
        vv[op.origin] = op.seq
    }
}

/** Chaves fracionárias — espelho de packages/core/src/fractional.ts. */
object Fractional {
    const val DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

    fun keyBetween(a: String?, b: String?): String = midpoint(a ?: "", b)

    private fun midpoint(a: String, b: String?): String {
        if (b != null) require(a < b) { "chaves fora de ordem: $a >= $b" }
        require(!a.endsWith('0') && !(b?.endsWith('0') ?: false)) { "chave não pode terminar em 0" }
        if (b != null) {
            var n = 0
            while ((a.getOrNull(n) ?: '0') == b.getOrNull(n)) n++
            if (n > 0) return b.substring(0, n) + midpoint(a.substring(minOf(n, a.length)), b.substring(n))
        }
        val digitA = if (a.isNotEmpty()) DIGITS.indexOf(a[0]) else 0
        val digitB = if (b != null) DIGITS.indexOf(b[0]) else DIGITS.length
        if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB)).toInt()].toString()
        if (b != null && b.length > 1) return b.substring(0, 1)
        return DIGITS[digitA] + midpoint(if (a.isNotEmpty()) a.substring(1) else "", null)
    }
}
