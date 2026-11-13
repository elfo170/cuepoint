package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Paridade do isolamento por usuário com o TypeScript (spec/vectors/isolation.json). */
class IsolationVectorsTest {
    private val spec = File(System.getProperty("cuepoint.spec") ?: "../../spec")
    private val v = Merge.parseObject(File(spec, "vectors/isolation.json").readText())

    @Test
    fun opsMatchTypeScript() {
        for (case in v.getValue("ops").jsonArray) {
            val o = case.jsonObject
            val op = Merge.json.decodeFromJsonElement<Op>(o.getValue("op")).validate()
            val user = o.getValue("user").jsonPrimitive.content
            assertEquals(o.getValue("name").jsonPrimitive.content, o.getValue("accepted").jsonPrimitive.boolean, Isolation.isSameUser(op, user))
        }
    }

    @Test
    fun pairingMatchesTypeScript() {
        for (case in v.getValue("pairing").jsonArray) {
            val o = case.jsonObject
            val joiner = o.getValue("joiner").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(
                o.getValue("name").jsonPrimitive.content,
                o.getValue("expected").jsonPrimitive.content,
                Isolation.pairingUserDecision(o.getValue("host").jsonPrimitive.content, joiner, o.getValue("can_adopt").jsonPrimitive.boolean),
            )
        }
    }

    @Test
    fun replicaRejectsWholeBatchFromAnotherUser() {
        val ops = v.getValue("ops").jsonArray.map { Merge.json.decodeFromJsonElement<Op>(it.jsonObject.getValue("op")) }
        val user = v.getValue("ops").jsonArray[0].jsonObject.getValue("user").jsonPrimitive.content
        val r = Replica("bbbbbbbb-0000-4000-8000-00000000000b", user)
        assertThrows(ForeignUserException::class.java) { r.receive(ops) }
        assertTrue(r.records.isEmpty())
        assertEquals(2, r.receive(ops.take(2)))
    }
}
