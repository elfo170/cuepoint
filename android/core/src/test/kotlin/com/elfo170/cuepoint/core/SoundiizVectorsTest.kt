package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** Paridade da exportação via Soundiiz com o TypeScript (spec/vectors/soundiiz.json). */
class SoundiizVectorsTest {
    private val spec = File(System.getProperty("cuepoint.spec") ?: "../../spec")
    private val v = Merge.parseObject(File(spec, "vectors/soundiiz.json").readText())
    private fun JsonObject.s(k: String) = getValue(k).jsonPrimitive.content

    @Test
    fun constantsMatchTypeScript() {
        val c = v.getValue("constants").jsonObject
        assertEquals(c.s("importUrl"), SoundiizProtocol.IMPORT_URL)
        assertEquals(c.getValue("maxTracks").jsonPrimitive.int, SoundiizProtocol.MAX_TRACKS)
        assertEquals(c.s("destination"), SoundiizProtocol.DESTINATION)
        assertEquals(c.s("sourceName"), SoundiizProtocol.SOURCE_NAME)
        assertEquals(c.s("defaultDescription"), SoundiizProtocol.DEFAULT_DESCRIPTION)
        assertEquals(c.s("sharePrefix"), SoundiizProtocol.SHARE_PREFIX)
    }

    @Test
    fun requestsMatchTypeScript() {
        for (case in v.getValue("requests").jsonArray) {
            val o = case.jsonObject
            val name = o.s("name")
            val input = o.getValue("input").jsonObject
            val description = input.getValue("description").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val tracks = input.getValue("tracks").jsonArray.map {
                SoundiizProtocol.TrackInput(it.jsonObject.s("title"), it.jsonObject.s("artist"))
            }
            val req = SoundiizProtocol.importRequest(input.s("name"), description, tracks)
            val expected = o.getValue("expected").jsonObject
            assertEquals(name, expected.s("url"), req.url)
            assertEquals(name, expected.getValue("headers").jsonObject.mapValues { it.value.jsonPrimitive.content }, req.headers)
            assertEquals(name, expected.getValue("payload"), req.payload)
            // a ordem das chaves também é a mesma do TypeScript
            assertEquals(name, expected.getValue("payload").jsonObject.keys.toList(), req.payload.keys.toList())
        }
    }

    @Test
    fun checksMatchTypeScript() {
        for (case in v.getValue("checks").jsonArray) {
            val o = case.jsonObject
            val count = o.getValue("count").jsonPrimitive.int
            val expected = o.getValue("expected")
            val got = SoundiizProtocol.check(count)
            when {
                expected is JsonNull -> assertEquals("$count", null, got)
                expected.jsonObject.s("code") == "empty" -> assertEquals("$count", SoundiizProtocol.Block.Empty, got)
                else -> assertEquals(
                    "$count",
                    SoundiizProtocol.Block.TooMany(
                        expected.jsonObject.getValue("count").jsonPrimitive.int,
                        expected.jsonObject.getValue("max").jsonPrimitive.int,
                    ),
                    got,
                )
            }
        }
    }

    @Test
    fun responsesMatchTypeScript() {
        for (case in v.getValue("responses").jsonArray) {
            val o = case.jsonObject
            val name = o.s("name")
            val got = SoundiizProtocol.parseResponse(o.getValue("status").jsonPrimitive.int, o.getValue("body").takeUnless { it is JsonNull })
            val e = o.getValue("expected").jsonObject
            if (e.getValue("ok").jsonPrimitive.boolean) {
                assertEquals(
                    name,
                    SoundiizProtocol.Result.Ok(e.s("shareUrl"), e.getValue("nbTracks").jsonPrimitive.int, e.getValue("expiresAt").jsonPrimitive.long),
                    got,
                )
            } else {
                val err = got as SoundiizProtocol.Result.Error
                assertEquals(name, e.s("code"), err.code.wire)
                assertEquals(name, e.getValue("status").jsonPrimitive.int, err.status)
                assertEquals(name, e.getValue("message").let { if (it is JsonNull) null else it.jsonPrimitive.content }, err.message)
            }
        }
    }
}
