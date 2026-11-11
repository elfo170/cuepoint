package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/** Paridade do backup com o TypeScript (spec/vectors/backup.json): restauração cruzada Chrome ⇄ Android. */
class BackupVectorsTest {
    private val spec = File(System.getProperty("cuepoint.spec") ?: "../../spec")
    private val file = Merge.parseObject(File(spec, "vectors/backup.json").readText())

    @Test
    fun chromeBackupIsAcceptedWithSameChecksum() {
        val valid = file.getValue("valid").jsonObject
        val backup = Backups.validate(valid)
        assertEquals(valid.getValue("sha256").jsonPrimitive.content, Backups.checksum(JsonObject(valid - "sha256")))
        assertEquals(15, backup.ops.size)
        assertEquals(1, backup.conflicts.size)
        assertEquals(
            valid.getValue("counts").jsonObject.mapValues { it.value.jsonPrimitive.content.toInt() },
            backup.counts(),
        )
    }

    @Test
    fun opsOfChromeBackupRebuildTheSameRecords() {
        val backup = Backups.validate(file.getValue("valid"))
        val replica = Replica("ffffffff-0000-4000-8000-00000000000f", backup.userId)
        replica.receive(backup.ops)
        val rebuilt = replica.records.values.sortedBy { Merge.str(it, "id") }
        val saved = backup.entities.values.flatten().sortedBy { Merge.str(it, "id") }
        assertEquals(Merge.canonicalJson(JsonArray(saved)), Merge.canonicalJson(JsonArray(rebuilt)))
    }

    @Test
    fun invalidBackupsAreRefusedWithTheSameMessages() {
        for (case in file.getValue("invalid").jsonArray) {
            val c = case.jsonObject
            val name = c.getValue("name").jsonPrimitive.content
            try {
                Backups.parse(c.getValue("text").jsonPrimitive.content)
                fail("$name: deveria ser recusado")
            } catch (e: BackupException) {
                assertEquals(name, c.getValue("error").jsonPrimitive.content, e.message)
            }
        }
    }

    @Test
    fun backupCreatedInKotlinValidatesAndRoundTrips() {
        val source = Backups.validate(file.getValue("valid"))
        val created = Backups.create(
            source.entities, source.ops, source.users, source.devices, source.conflicts, source.settings,
            source.deviceId, source.userId, nowMs = 1_767_229_200_000,
        )
        // mesmo conteúdo e mesmo instante → mesmo checksum que o TypeScript calculou
        assertEquals(file.getValue("valid").jsonObject.getValue("sha256").jsonPrimitive.content, created.getValue("sha256").jsonPrimitive.content)
        val again = Backups.parse(Backups.encode(created))
        assertTrue(again.entities.values.sumOf { it.size } > 0)
    }
}
