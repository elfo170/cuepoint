package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** Paridade com o TypeScript: os mesmos arquivos de spec/vectors precisam dar o mesmo resultado. */
class SpecVectorsTest {
    private val spec = File(System.getProperty("cuepoint.spec") ?: "../../spec")

    private fun load(name: String): JsonObject = Merge.parseObject(File(spec, "vectors/$name").readText())

    @Test
    fun idsMatchTypeScript() {
        val file = load("ids.json")
        for (case in file.getValue("cases").jsonArray) {
            val c = case.jsonObject
            val args = c.getValue("args").jsonArray.map { it.jsonPrimitive }
            val a = { i: Int -> args[i].content }
            val actual = when (c.getValue("fn").jsonPrimitive.content) {
                "deterministicId" -> Ids.deterministicId(a(0))
                "trackIdFromUrn" -> Ids.trackIdFromUrn(a(0))
                "decisionId" -> Ids.decisionId(a(0), a(1))
                "trackCategoryId" -> Ids.trackCategoryId(a(0), a(1), a(2))
                "playlistTrackId" -> Ids.playlistTrackId(a(0), a(1))
                "opId" -> Ids.opId(a(0), args[1].long)
                "conflictId" -> Ids.conflictId(a(0), a(1), a(2))
                else -> error("fn desconhecida")
            }
            assertEquals(c.toString(), c.getValue("expected").jsonPrimitive.content, actual)
        }
        for (h in file.getValue("hlc").jsonArray) {
            val p = h.jsonObject.getValue("parts").jsonObject
            val parts = HlcParts(p.getValue("ms").jsonPrimitive.long, p.getValue("counter").jsonPrimitive.int, p.getValue("node").jsonPrimitive.content)
            val text = h.jsonObject.getValue("text").jsonPrimitive.content
            assertEquals(text, Hlc.format(parts))
            assertEquals(parts, Hlc.parse(text))
        }
        for (f in file.getValue("fractional").jsonArray) {
            val o = f.jsonObject
            val a = o["a"].let { if (it == null || it is JsonNull) null else it.jsonPrimitive.content }
            val b = o["b"].let { if (it == null || it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(o.toString(), o.getValue("expected").jsonPrimitive.content, Fractional.keyBetween(a, b))
        }
    }

    @Test
    fun mergeScenariosMatchTypeScript() {
        val scenarios = load("merge.json").getValue("scenarios").jsonArray
        check(scenarios.size >= 10)
        for (s in scenarios) {
            val sc = s.jsonObject
            val name = sc.getValue("name").jsonPrimitive.content
            val ops = sc.getValue("ops").jsonArray.map { Merge.json.decodeFromJsonElement<Op>(it).validate() }
            val fresh = Replica("ffffffff-0000-4000-8000-00000000000f", "00000000-0000-4000-8000-000000000001")
            fresh.receive(ops)
            val expected = sc.getValue("expected").jsonObject
            // Comparação independente de ordem (o TS ordena com localeCompare)
            val expectedRecords = expected.getValue("records").jsonArray.map(Merge::canonicalJson).sorted()
            val actualRecords = fresh.records.values.map(Merge::canonicalJson).sorted()
            assertEquals(name, expectedRecords, actualRecords)
            val conflicts = expected.getValue("conflicts").jsonArray.map {
                val o = it.jsonObject
                ConflictInfo(o.getValue("entity_type").jsonPrimitive.content, o.getValue("entity_id").jsonPrimitive.content, o.getValue("field").jsonPrimitive.content)
            }
            assertEquals(name, conflicts.toSet(), fresh.conflicts().toSet())
            // reentrega não altera nada
            assertEquals(0, fresh.receive(ops))
        }
    }
}
