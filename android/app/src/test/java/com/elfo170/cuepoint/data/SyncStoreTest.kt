package com.elfo170.cuepoint.data

import androidx.test.core.app.ApplicationProvider
import com.elfo170.cuepoint.core.EntityType
import com.elfo170.cuepoint.core.ForeignUserException
import com.elfo170.cuepoint.core.Merge
import com.elfo170.cuepoint.core.Ids
import com.elfo170.cuepoint.core.Protocol
import com.elfo170.cuepoint.core.Replica
import com.elfo170.cuepoint.sync.PinnedTrustManager
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.security.cert.CertificateException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class SyncStoreTest {
    private lateinit var db: CuePointDatabase
    private lateinit var store: Store
    private lateinit var curation: Curation

    @Before
    fun setUp() {
        db = CuePointDatabase.create(ApplicationProvider.getApplicationContext(), inMemory = true)
        store = Store(db)
        curation = Curation(store)
    }

    @After
    fun tearDown() = db.close()

    @Test
    fun compactsPendingOpsAndKeepsState() = runTest {
        val r = curation.createResearch("Latin")
        val t = curation.ensureTrack(TrackInput("A", "B", urn = "soundcloud:tracks:1"))
        val c = curation.createCategory("Vocal")
        curation.setTrackCategory(t.id, r.id, c.id, true)
        curation.setTrackCategory(t.id, r.id, c.id, false)
        curation.setTrackCategory(t.id, r.id, c.id, true)
        val before = db.dao().events().size
        val removed = store.compactPending()
        assertEquals(2, removed)
        assertEquals(before - 2, db.dao().events().size)
        assertEquals(listOf(c.id), curation.decisionState(t.id, r.id).second)
        val own = db.dao().events().filter { it.origin == store.init().deviceId }.map { it.seq }.sorted()
        assertEquals((1L..own.size).toList(), own)

        // o que foi enviado não é mais compactado
        store.markSent(store.opsSince(emptyMap()))
        curation.updateResearch(r.id, name = "X")
        curation.updateResearch(r.id, name = "Y")
        assertEquals(1, store.compactPending())
        assertEquals(0, store.compactPending())

        // outra réplica recebe o log compactado e chega ao mesmo estado
        val other = Replica("bbbbbbbb-0000-4000-8000-00000000000b", store.init().userId)
        other.receive(store.opsSince(emptyMap()))
        assertEquals("Y", other.get(EntityType.RESEARCH, r.id)?.get("name")?.toString()?.trim('"'))
        assertEquals(1, other.records.count { it.key.startsWith("track_category:") })
        assertTrue(other.get(EntityType.TRACK_CATEGORY, Ids.trackCategoryId(t.id, r.id, c.id))!!["deleted_at"].toString() == "null")
    }

    @Test
    fun adoptsPcUserOnlyWhenEmpty() = runTest {
        val pcUser = "eeeeeeee-0000-4000-8000-000000000001"
        assertTrue(store.adoptUserIfEmpty(pcUser))
        assertEquals(pcUser, store.init().userId)
        curation.createResearch("Algo")
        assertFalse(store.adoptUserIfEmpty("ffffffff-0000-4000-8000-000000000001"))
    }

    @Test
    fun rejectsWholeBatchFromAnotherUser() = runTest {
        val me = store.init().userId
        val other = "ffffffff-0000-4000-8000-000000000001"
        fun research(user: String, device: String, id: String) = Replica(device, user).put(
            EntityType.RESEARCH,
            id,
            mapOf(
                "user_id" to JsonPrimitive(user), "name" to JsonPrimitive("R"),
                "description" to JsonPrimitive(""), "archived" to JsonPrimitive(false),
            ),
        )
        val mine = research(me, "bbbbbbbb-0000-4000-8000-00000000000b", "20000000-0000-4000-8000-000000000001")
        val theirs = research(other, "cccccccc-0000-4000-8000-00000000000c", "20000000-0000-4000-8000-000000000002")
        assertThrows(ForeignUserException::class.java) { runBlocking { store.receive(listOf(mine, theirs)) } }
        assertEquals(0, db.dao().entityCount())
        assertTrue(store.versionVector().isEmpty())
        assertEquals(1, store.receive(listOf(mine)))
    }

    @Test
    fun readsShowOnlyLocalUserRecords() = runTest {
        val own = curation.createResearch("Minha")
        val foreign = Merge.parseObject(db.dao().entity("research", own.id)!!.json).toMutableMap().apply {
            put("id", JsonPrimitive("20000000-0000-4000-8000-0000000000aa"))
            put("user_id", JsonPrimitive("ffffffff-0000-4000-8000-000000000001"))
        }
        val row = db.dao().entity("research", own.id)!!
        db.dao().upsertEntity(row.copy(id = "20000000-0000-4000-8000-0000000000aa", json = JsonObject(foreign).toString()))
        assertEquals(listOf(own.id), curation.listResearches().map { it.id })
        val snap = Snapshot.of(db.dao().observeAll().first(), store.init().userId)
        assertEquals(listOf(own.id), snap.researches.map { it.id })
        assertEquals(2, Snapshot.of(db.dao().observeAll().first()).researches.size)
    }

    @Test
    fun pinnedTrustManagerRejectsOtherCertificates() {
        val kp = Protocol.generateKeyPair()
        val cert = object : java.security.cert.X509Certificate() {
            override fun getPublicKey() = kp.public
            override fun getEncoded() = ByteArray(0)
            override fun verify(key: java.security.PublicKey?) = Unit
            override fun verify(key: java.security.PublicKey?, sigProvider: String?) = Unit
            override fun toString() = "cert"
            override fun checkValidity() = Unit
            override fun checkValidity(date: java.util.Date?) = Unit
            override fun getVersion() = 3
            override fun getSerialNumber() = java.math.BigInteger.ONE
            override fun getIssuerDN() = null
            override fun getSubjectDN() = null
            override fun getNotBefore() = java.util.Date()
            override fun getNotAfter() = java.util.Date()
            override fun getTBSCertificate() = ByteArray(0)
            override fun getSignature() = ByteArray(0)
            override fun getSigAlgName() = ""
            override fun getSigAlgOID() = ""
            override fun getSigAlgParams() = ByteArray(0)
            override fun getIssuerUniqueID() = null
            override fun getSubjectUniqueID() = null
            override fun getKeyUsage() = null
            override fun getBasicConstraints() = 0
            override fun hasUnsupportedCriticalExtension() = false
            override fun getCriticalExtensionOIDs() = null
            override fun getNonCriticalExtensionOIDs() = null
            override fun getExtensionValue(oid: String?) = null
        }
        val fp = Protocol.sha256Hex(kp.public.encoded)
        PinnedTrustManager(fp).checkServerTrusted(arrayOf(cert), "ECDHE")
        val failed = runCatching { PinnedTrustManager("0".repeat(64)).checkServerTrusted(arrayOf(cert), "ECDHE") }
        assertTrue(failed.exceptionOrNull() is CertificateException)
    }
}
