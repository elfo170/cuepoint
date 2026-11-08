package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplicaTest {
    private val user = "00000000-0000-4000-8000-000000000001"
    private val research = "20000000-0000-4000-8000-000000000001"
    private fun clock(): () -> Long { var t = 1_767_225_600_000; return { t += 1000; t } }

    private fun seed(r: Replica) = r.put(
        EntityType.RESEARCH, research,
        mapOf("user_id" to JsonPrimitive(user), "name" to JsonPrimitive("Techno"), "description" to JsonPrimitive(""), "archived" to JsonPrimitive(false)),
    )

    @Test
    fun concurrentRenameConflictsAndResolutionConverges() {
        val now = clock()
        val a = Replica("aaaaaaaa-0000-4000-8000-00000000000a", user, now)
        val b = Replica("bbbbbbbb-0000-4000-8000-00000000000b", user, now)
        seed(a)
        b.receive(a.opsSince(b.vv))
        a.put(EntityType.RESEARCH, research, mapOf("name" to JsonPrimitive("A")))
        b.put(EntityType.RESEARCH, research, mapOf("name" to JsonPrimitive("B")))
        b.receive(a.opsSince(b.vv)); a.receive(b.opsSince(a.vv))
        assertEquals(listOf("name"), a.conflicts().map { it.field })
        assertEquals(Merge.canonicalJson(a.get(EntityType.RESEARCH, research)!!), Merge.canonicalJson(b.get(EntityType.RESEARCH, research)!!))
        a.put(EntityType.RESEARCH, research, mapOf("name" to JsonPrimitive("A")), "resolve")
        b.receive(a.opsSince(b.vv))
        assertTrue(b.conflicts().isEmpty())
        assertEquals("A", Merge.str(b.get(EntityType.RESEARCH, research)!!, "name"))
    }

    @Test
    fun validationAndNoop() {
        val a = Replica("aaaaaaaa-0000-4000-8000-00000000000a", user, clock())
        seed(a)
        val rec = a.get(EntityType.RESEARCH, research)!!
        assertTrue(Merge.isNoopWrite(rec, mapOf("name" to JsonPrimitive("Techno"), "deleted_at" to kotlinx.serialization.json.JsonNull)))
        assertFalse(Merge.isNoopWrite(rec, mapOf("name" to JsonPrimitive("Outro"))))
        val error = runCatching { a.put(EntityType.RESEARCH, research, mapOf("name" to JsonPrimitive("  "))) }
        assertTrue(error.isFailure)
    }

    @Test
    fun idsAndFractional() {
        val id = Ids.newId()
        assertEquals('7', id[14])
        var keys = listOf<String>()
        repeat(50) { i ->
            val pos = (i * 7) % (keys.size + 1)
            val k = Fractional.keyBetween(keys.getOrNull(pos - 1), keys.getOrNull(pos))
            keys = keys.toMutableList().apply { add(pos, k) }
        }
        assertEquals(keys.sorted(), keys)
    }
}
