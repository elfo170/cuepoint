package com.elfo170.cuepoint.backup

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.elfo170.cuepoint.core.BackupException
import com.elfo170.cuepoint.core.Backups
import com.elfo170.cuepoint.core.EntityType
import com.elfo170.cuepoint.core.Merge
import com.elfo170.cuepoint.core.Op
import com.elfo170.cuepoint.data.CuePointDatabase
import com.elfo170.cuepoint.data.Curation
import com.elfo170.cuepoint.data.Snapshot
import com.elfo170.cuepoint.data.Store
import com.elfo170.cuepoint.data.TrackInput
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class BackupTest {
    @get:Rule val tmp = TemporaryFolder()

    private val spec = File(System.getProperty("cuepoint.spec") ?: "../../spec")
    private val opened = mutableListOf<CuePointDatabase>()
    private lateinit var dir: File

    @Before
    fun setUp() {
        dir = tmp.newFolder("backups")
    }

    @After
    fun tearDown() = opened.forEach { it.close() }

    private inner class Device {
        val db = CuePointDatabase.create(ApplicationProvider.getApplicationContext(), inMemory = true).also { opened += it }
        val store = Store(db)
        val curation = Curation(store)
        val backups = BackupManager(ApplicationProvider.getApplicationContext(), store, destinationOverride = DirectoryDestination(dir))
    }

    private fun canonicalEntities(entities: Collection<List<JsonObject>>) =
        Merge.canonicalJson(JsonArray(entities.flatten().sortedBy { Merge.str(it, "id") }))

    private suspend fun seed(d: Device) {
        val latin = d.curation.createResearch("Latin Bass", "graves")
        val vocal = d.curation.createCategory("Vocal ✓")
        val tracks = (1..3).map { i ->
            d.curation.ensureTrack(TrackInput("Faixa $i", "Artista $i", "https://soundcloud.com/a/faixa-$i", "soundcloud:tracks:$i", source = "mediasession"))
        }
        d.curation.decide(tracks[0].id, latin.id, true)
        d.curation.decide(tracks[1].id, latin.id, false)
        d.curation.setTrackCategory(tracks[0].id, latin.id, vocal.id, true)
        val playlist = d.curation.createPlaylist("Set \"sábado\"", latin.id, null)
        d.curation.addToPlaylist(playlist.id, tracks[2].id)
        d.curation.deleteCategory(d.curation.createCategory("Apagar").id)
        d.curation.setActiveResearchId(latin.id)
    }

    @Test
    fun chromeBackupRestoresIntoRoomKeepingThisDeviceIdentity() = runBlocking {
        val chrome = Merge.parseObject(File(spec, "vectors/backup.json").readText()).getValue("valid").jsonObject
        val backup = Backups.validate(chrome)
        val phone = Device()
        seed(phone) // biblioteca atual, que será substituída
        val before = phone.store.init()

        phone.backups.restore(backup)

        val after = phone.store.init()
        assertEquals("o celular mantém o próprio id", before.deviceId, after.deviceId)
        assertEquals("adota o usuário do backup", backup.userId, after.userId)
        val snapshot = Snapshot.of(phone.db.dao().observeAll().first())
        assertEquals(2, snapshot.tracks.size)
        assertEquals(canonicalEntities(backup.entities.values), canonicalEntities(EntityType.entries.map { phone.store.all(it) }))
        assertEquals(backup.ops.size, phone.db.dao().eventCount())
        assertTrue(phone.db.dao().events().all { it.status == "received" })
        assertEquals(1, phone.db.dao().conflicts().size)
        assertEquals(Merge.str(backup.settings, "activeResearchId"), phone.curation.getActiveResearchId())

        // um backup de segurança foi gravado antes de substituir
        assertTrue(dir.listFiles()!!.any { it.name.endsWith("-antes-de-restaurar.json") })

        // novas escritas continuam o log normalmente e o backup refeito é válido
        phone.curation.createResearch("Depois da restauração")
        val again = Backups.parse(Backups.encode(phone.store.exportBackup()))
        assertEquals(backup.ops.size + 1, again.ops.size)
    }

    @Test
    fun androidBackupIsValidAndSharedWithTypeScript() = runBlocking {
        val phone = Device()
        seed(phone)
        val record = phone.backups.run("manual")
        val file = File(dir, record.filename)
        assertTrue(file.isFile)
        val parsed = Backups.parse(file.readText())
        assertEquals(record.sha256, parsed.sha256)
        assertEquals(parsed.ops.size, record.ops)
        assertEquals(0, phone.backups.changesSinceLast())
        assertEquals(listOf(record), phone.backups.history())

        // restaurar num celular novo reproduz a mesma biblioteca
        val other = Device()
        other.backups.restore(parsed)
        assertEquals(canonicalEntities(parsed.entities.values), canonicalEntities(EntityType.entries.map { other.store.all(it) }))

        // spec/vectors/backup-android.json: backup feito pelo Android, validado pela suíte TypeScript.
        // Gerado quando ausente (apague o arquivo para regenerar).
        val shared = File(spec, "vectors/backup-android.json")
        if (!shared.isFile) shared.writeText(Merge.json.encodeToString(JsonObject.serializer(), parsed.root).let(::pretty) + "\n")
        Backups.parse(shared.readText())
        Unit
    }

    @Test
    fun autoBackupOnlyWhenSomethingChanged() = runBlocking {
        val phone = Device()
        seed(phone)
        assertTrue(phone.backups.runAuto() != null)
        assertNull("sem alterações, não grava de novo", phone.backups.runAuto())
        phone.curation.createCategory("Nova")
        assertEquals(1, phone.backups.changesSinceLast())
        assertTrue(phone.backups.runAuto() != null)
        assertEquals(2, dir.listFiles()!!.count { it.name.endsWith(".json") })
    }

    @Test
    fun corruptedBackupIsRefusedBeforeTouchingData() = runBlocking {
        val phone = Device()
        seed(phone)
        val text = Backups.encode(phone.store.exportBackup()).replace("Latin Bass", "Latin Bas5")
        try {
            Backups.parse(text)
            fail("deveria recusar")
        } catch (e: BackupException) {
            assertTrue(e.message!!.startsWith("Checksum não confere"))
        }
        assertEquals(1, phone.curation.listResearches().size)
    }

    @Test
    fun ownOpsReturnedAfterRestoringAnOlderBackupDoNotReuseSequenceNumbers() = runBlocking {
        val phone = Device()
        phone.curation.createResearch("A")
        val old = Backups.parse(Backups.encode(phone.store.exportBackup()))
        phone.curation.createResearch("B")
        phone.curation.createResearch("C")
        // ops 2 e 3 deste aparelho já tinham ido para o PC
        val sentLater = phone.db.dao().events().map { Merge.json.decodeFromString<Op>(it.json) }.filter { it.seq > 1 }
        phone.backups.restore(old)
        assertEquals(1, phone.curation.listResearches().size)
        // o PC devolve as ops 2 e 3 na próxima sincronização
        phone.store.receive(sentLater)
        assertEquals(3, phone.curation.listResearches().size)
        phone.curation.createResearch("D") // seq 4, sem colidir
        val seqs = phone.db.dao().events().filter { it.origin == phone.store.init().deviceId }.map { it.seq }.sorted()
        assertEquals(listOf(1L, 2L, 3L, 4L), seqs)
        assertNotEquals(0, seqs.size)
    }

    private fun pretty(compact: String): String =
        kotlinx.serialization.json.Json { prettyPrint = true }.let { it.encodeToString(JsonObject.serializer(), it.parseToJsonElement(compact).jsonObject) }
}
