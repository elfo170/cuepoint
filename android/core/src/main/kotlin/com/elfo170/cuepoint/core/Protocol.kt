package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonObject
import java.net.URLDecoder
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/** Protocolo de sincronização na LAN — espelho de packages/core/src/protocol.ts. */
object Protocol {
    const val VERSION = 1
    const val DEFAULT_PORT = 47800
    /** Tipo DNS-SD para o NsdManager: sem o ponto final, que o Android 14+ pode recusar. */
    const val SERVICE_TYPE = "_cuepoint._tcp"
    const val PULL_LIMIT = 500
    const val HEADER_DEVICE = "x-cuepoint-device"
    const val HEADER_TIMESTAMP = "x-cuepoint-timestamp"
    const val HEADER_NONCE = "x-cuepoint-nonce"
    const val HEADER_SIGNATURE = "x-cuepoint-signature"

    data class PairingPayload(
        val v: Int,
        val deviceId: String,
        val name: String,
        val addresses: List<String>,
        val port: Int,
        val certFp: String,
        val publicKey: String,
        val token: String,
    )

    /** Lê o conteúdo do QR / código de pareamento (`cuepoint://pair?...`). */
    fun parsePairingUri(text: String): PairingPayload {
        val t = text.trim()
        require(t.startsWith("cuepoint://pair?")) { "Código de pareamento inválido." }
        val params = t.removePrefix("cuepoint://pair?").split('&').filter { it.isNotEmpty() }.associate { part ->
            val i = part.indexOf('=')
            val k = if (i < 0) part else part.substring(0, i)
            val v = if (i < 0) "" else part.substring(i + 1)
            URLDecoder.decode(k, "UTF-8") to URLDecoder.decode(v, "UTF-8")
        }
        fun get(k: String) = params[k]?.takeIf { it.isNotEmpty() } ?: throw IllegalArgumentException("Código de pareamento incompleto ($k).")
        val p = PairingPayload(
            v = get("v").toInt(),
            deviceId = get("d"),
            name = get("n"),
            addresses = get("a").split(',').filter { it.isNotEmpty() },
            port = get("p").toInt(),
            certFp = get("f").lowercase(),
            publicKey = get("k"),
            token = get("t"),
        )
        require(p.v == VERSION) { "Versão de pareamento não suportada." }
        require(p.port > 0) { "Porta inválida." }
        return p
    }

    fun canonicalRequest(method: String, path: String, timestamp: String, nonce: String, bodySha256Hex: String) =
        listOf(method.uppercase(), path, timestamp, nonce, bodySha256Hex).joinToString("\n")

    fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

    fun sha256Hex(text: String): String = sha256Hex(text.toByteArray(Charsets.UTF_8))

    fun sha256Hex(bytes: ByteArray): String = sha256(bytes).joinToString("") { "%02x".format(it) }

    /** Código de 6 dígitos exibido nos dois aparelhos durante o pareamento. */
    fun pairingCode(token: String, keyA: String, keyB: String): String {
        val (x, y) = listOf(keyA, keyB).sorted()
        val d = sha256("$token|$x|$y".toByteArray(Charsets.UTF_8))
        val n = ((d[0].toLong() and 0xff) shl 24) or ((d[1].toLong() and 0xff) shl 16) or
            ((d[2].toLong() and 0xff) shl 8) or (d[3].toLong() and 0xff)
        return "%06d".format(n % 1_000_000)
    }

    // ------------------------------------------------------------ chaves e assinatura

    fun generateKeyPair(): KeyPair = KeyPairGenerator.getInstance("EC").apply {
        initialize(ECGenParameterSpec("secp256r1"))
    }.generateKeyPair()

    fun publicKeyB64(key: PublicKey): String = Base64.getEncoder().encodeToString(key.encoded)
    fun privateKeyB64(key: PrivateKey): String = Base64.getEncoder().encodeToString(key.encoded)

    fun publicKeyOf(b64: String): PublicKey =
        KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(b64)))

    fun privateKeyOf(b64: String): PrivateKey =
        KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(b64)))

    /** ECDSA P-256 / SHA-256, assinatura DER em base64 (mesmo formato do serviço do PC). */
    fun sign(key: PrivateKey, text: String): String {
        val s = Signature.getInstance("SHA256withECDSA")
        s.initSign(key)
        s.update(text.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(s.sign())
    }

    fun verify(publicKeyB64: String, text: String, signatureB64: String): Boolean = runCatching {
        val s = Signature.getInstance("SHA256withECDSA")
        s.initVerify(publicKeyOf(publicKeyB64))
        s.update(text.toByteArray(Charsets.UTF_8))
        s.verify(Base64.getDecoder().decode(signatureB64))
    }.getOrDefault(false)

    /** Cabeçalhos de uma requisição assinada. */
    fun signedHeaders(deviceId: String, key: PrivateKey, method: String, path: String, body: String, now: Long = System.currentTimeMillis()): Map<String, String> {
        val timestamp = now.toString()
        val nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(12).also { java.security.SecureRandom().nextBytes(it) })
        val message = canonicalRequest(method, path, timestamp, nonce, sha256Hex(body))
        return mapOf(
            HEADER_DEVICE to deviceId,
            HEADER_TIMESTAMP to timestamp,
            HEADER_NONCE to nonce,
            HEADER_SIGNATURE to sign(key, message),
        )
    }
}

/** Compactação de operações não enviadas — espelho de packages/core/src/compaction.ts. */
object Compaction {
    fun compactOps(ops: List<Op>, fromSeq: Long): List<Op> {
        if (ops.size < 2) return ops
        val origin = ops.first().origin
        val own = ops.map { it.hlc }.toSet()
        val groups = linkedMapOf<String, MutableList<Op>>()
        for (op in ops.sortedBy { it.seq }) {
            require(op.origin == origin) { "compactação exige operações de uma só origem" }
            groups.getOrPut("${op.entityType}:${op.entityId}") { mutableListOf() } += op
        }
        val merged = groups.values.map { list ->
            val last = list.last()
            val fields = linkedMapOf<String, kotlinx.serialization.json.JsonElement>()
            val base = linkedMapOf<String, MutableSet<String>>()
            for (op in list) for ((f, v) in op.fields) {
                fields[f] = v
                val set = base.getOrPut(f) { mutableSetOf() }
                for (h in op.base[f] ?: emptyList()) if (h !in own) set += h
            }
            val kinds = list.map { it.operation }
            val operation = when {
                "resolve" in kinds -> "resolve"
                kinds.first() == "create" -> "create"
                last.operation == "delete" -> "delete"
                else -> "update"
            }
            last.copy(operation = operation, fields = JsonObject(fields), base = base.mapValues { (_, s) -> s.sorted() })
        }
        return merged.sortedBy { it.hlc }.mapIndexed { i, op ->
            op.copy(seq = fromSeq + i, opId = Ids.opId(origin, fromSeq + i))
        }
    }

    /** Recalcula todos os registros reaplicando o log em ordem de HLC. */
    fun rebuild(log: List<Op>): Map<String, JsonObject> {
        val records = linkedMapOf<String, JsonObject>()
        for (op in log.sortedBy { it.hlc }) {
            val key = "${op.entityType}:${op.entityId}"
            records[key] = Merge.applyOp(op.type, records[key], op).record
        }
        return records
    }
}
