package com.elfo170.cuepoint.core

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Hybrid Logical Clock — espelho de packages/core/src/hlc.ts.
 * Formato: `<ms:15 dígitos>:<contador:6 dígitos>:<nó>` (ordem textual = ordem do relógio).
 */
data class HlcParts(val ms: Long, val counter: Int, val node: String)

object Hlc {
    const val MAX_COUNTER = 999_999
    const val MAX_DRIFT_MS = 24L * 60 * 60 * 1000
    private val REGEX = Regex("""^(\d{15}):(\d{6}):([^:]+)$""")
    private val ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    fun format(p: HlcParts): String {
        require(p.ms >= 0) { "HLC inválido: ms=${p.ms}" }
        require(p.counter in 0..MAX_COUNTER) { "HLC inválido: counter=${p.counter}" }
        require(p.node.isNotEmpty() && ':' !in p.node) { "HLC inválido: node=${p.node}" }
        return "%015d:%06d:%s".format(p.ms, p.counter, p.node)
    }

    fun parse(hlc: String): HlcParts {
        val m = REGEX.matchEntire(hlc) ?: throw IllegalArgumentException("HLC inválido: $hlc")
        return HlcParts(m.groupValues[1].toLong(), m.groupValues[2].toInt(), m.groupValues[3])
    }

    /** ISO 8601 com milissegundos, idêntico a `Date.prototype.toISOString()`. */
    fun toIso(hlc: String): String = isoOf(parse(hlc).ms)

    fun isoOf(ms: Long): String = ISO.format(Instant.ofEpochMilli(ms))
}

class HlcClock(val node: String, last: String? = null, val now: () -> Long = System::currentTimeMillis) {
    private var ms: Long
    private var counter: Int

    init {
        val p = last?.let(Hlc::parse)
        ms = p?.ms ?: 0
        counter = p?.counter ?: 0
    }

    val last: String get() = Hlc.format(HlcParts(ms, counter, node))

    fun tick(): String {
        val wall = now()
        if (wall > ms) {
            ms = wall
            counter = 0
        } else bump()
        return last
    }

    fun receive(remote: String) {
        val r = Hlc.parse(remote)
        val wall = now()
        require(r.ms <= wall + Hlc.MAX_DRIFT_MS) { "HLC remoto muito adiantado ($remote)" }
        when {
            wall > ms && wall > r.ms -> {
                ms = wall
                counter = 0
            }
            r.ms > ms -> {
                ms = r.ms
                counter = r.counter
                bump()
            }
            r.ms == ms -> {
                counter = maxOf(counter, r.counter)
                bump()
            }
            else -> bump()
        }
    }

    private fun bump() {
        if (counter >= Hlc.MAX_COUNTER) {
            ms += 1
            counter = 0
        } else counter += 1
    }
}
