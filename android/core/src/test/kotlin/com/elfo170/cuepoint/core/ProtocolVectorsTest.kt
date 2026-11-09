package com.elfo170.cuepoint.core

import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Paridade do protocolo e da compactação com o TypeScript (spec/vectors). */
class ProtocolVectorsTest {
    private val spec = File(System.getProperty("cuepoint.spec") ?: "../../spec")
    private fun load(name: String) = Merge.parseObject(File(spec, "vectors/$name").readText())

    @Test
    fun canonicalPairingCodeUriAndSignature() {
        val v = load("protocol.json")
        val c = v.getValue("canonical").jsonObject
        val s = { k: String -> c.getValue(k).jsonPrimitive.content }
        assertEquals(s("message"), Protocol.canonicalRequest(s("method"), s("path"), s("timestamp"), s("nonce"), Protocol.sha256Hex(s("body"))))

        val pc = v.getValue("pairingCode").jsonObject
        val p = { k: String -> pc.getValue(k).jsonPrimitive.content }
        assertEquals(p("code"), Protocol.pairingCode(p("token"), p("keyA"), p("keyB")))
        assertEquals(p("code"), Protocol.pairingCode(p("token"), p("keyB"), p("keyA")))

        val payload = Protocol.parsePairingUri(v.getValue("pairingUri").jsonPrimitive.content)
        assertEquals("PC do estúdio", payload.name)
        assertEquals(listOf("192.168.0.10"), payload.addresses)
        assertEquals(47800, payload.port)
        assertEquals("tok123", payload.token)

        // assinatura gerada pelo Node (DER) verifica no Java
        val sig = v.getValue("signature").jsonObject
        assertTrue(Protocol.verify(sig.getValue("publicKey").jsonPrimitive.content, s("message"), sig.getValue("signature").jsonPrimitive.content))
        assertFalse(Protocol.verify(sig.getValue("publicKey").jsonPrimitive.content, s("message") + "x", sig.getValue("signature").jsonPrimitive.content))
    }

    @Test
    fun javaSignatureRoundTrip() {
        val kp = Protocol.generateKeyPair()
        val pub = Protocol.publicKeyB64(kp.public)
        val priv = Protocol.privateKeyOf(Protocol.privateKeyB64(kp.private))
        val h = Protocol.signedHeaders("dev", priv, "post", "/v1/sync/pull", "{}")
        val msg = Protocol.canonicalRequest("POST", "/v1/sync/pull", h.getValue(Protocol.HEADER_TIMESTAMP), h.getValue(Protocol.HEADER_NONCE), Protocol.sha256Hex("{}"))
        assertTrue(Protocol.verify(pub, msg, h.getValue(Protocol.HEADER_SIGNATURE)))
    }

    @Test
    fun compactionMatchesTypeScript() {
        for (case in load("compaction.json").getValue("cases").jsonArray) {
            val o = case.jsonObject
            val input = o.getValue("input").jsonArray.map { Merge.json.decodeFromJsonElement<Op>(it) }
            val expected = o.getValue("expected").jsonArray.map { Merge.json.decodeFromJsonElement<Op>(it) }
            val actual = Compaction.compactOps(input, o.getValue("fromSeq").jsonPrimitive.long)
            assertEquals(expected.map { Merge.canonicalJson(Merge.json.encodeToJsonElement(Op.serializer(), it)) },
                actual.map { Merge.canonicalJson(Merge.json.encodeToJsonElement(Op.serializer(), it)) })
        }
    }
}
