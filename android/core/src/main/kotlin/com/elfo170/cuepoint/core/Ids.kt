package com.elfo170.cuepoint.core

import java.nio.ByteBuffer
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID

/** Identificadores — espelho de packages/core/src/ids.ts (validado por spec/vectors/ids.json). */
object Ids {
    /** Namespace fixo do CuePoint para UUIDv5 (não alterar). */
    const val NAMESPACE = "6f2b8f5e-3c1a-4d7e-9a43-2f6c1b9e0d57"

    private val random = SecureRandom()

    /** UUIDv7: 48 bits de milissegundos + aleatório. */
    fun newId(nowMs: Long = System.currentTimeMillis()): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        for (i in 0 until 6) bytes[i] = (nowMs ushr (8 * (5 - i))).toByte()
        bytes[6] = ((bytes[6].toInt() and 0x0f) or 0x70).toByte()
        bytes[8] = ((bytes[8].toInt() and 0x3f) or 0x80).toByte()
        return toUuid(bytes)
    }

    /** UUIDv5 (SHA-1) com o namespace do CuePoint. */
    fun deterministicId(name: String): String {
        val ns = UUID.fromString(NAMESPACE)
        val nsBytes = ByteBuffer.allocate(16).putLong(ns.mostSignificantBits).putLong(ns.leastSignificantBits).array()
        val digest = MessageDigest.getInstance("SHA-1").apply {
            update(nsBytes)
            update(name.toByteArray(Charsets.UTF_8))
        }.digest()
        val bytes = digest.copyOf(16)
        bytes[6] = ((bytes[6].toInt() and 0x0f) or 0x50).toByte()
        bytes[8] = ((bytes[8].toInt() and 0x3f) or 0x80).toByte()
        return toUuid(bytes)
    }

    fun trackIdFromUrn(urn: String) = deterministicId("track:$urn")
    fun decisionId(trackId: String, researchId: String) = deterministicId("decision:$trackId:$researchId")
    fun trackCategoryId(trackId: String, researchId: String, categoryId: String) =
        deterministicId("track_category:$trackId:$researchId:$categoryId")
    fun playlistTrackId(playlistId: String, trackId: String) = deterministicId("playlist_track:$playlistId:$trackId")
    fun conflictId(entityType: String, entityId: String, field: String) =
        deterministicId("conflict:$entityType:$entityId:$field")
    fun opId(origin: String, seq: Long) = deterministicId("op:$origin:$seq")

    private fun toUuid(b: ByteArray): String {
        val bb = ByteBuffer.wrap(b)
        return UUID(bb.long, bb.long).toString()
    }
}
