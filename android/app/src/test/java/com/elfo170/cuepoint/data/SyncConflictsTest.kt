package com.elfo170.cuepoint.data

import androidx.test.core.app.ApplicationProvider
import com.elfo170.cuepoint.core.EntityType
import com.elfo170.cuepoint.core.Ids
import com.elfo170.cuepoint.core.Merge
import com.elfo170.cuepoint.core.Op
import com.elfo170.cuepoint.core.Replica
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Sprint 10 no Android: conflitos legíveis, resolução, provisórias, categorias repetidas e pendências. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class SyncConflictsTest {
    private val other = "bbbbbbbb-0000-4000-8000-00000000000b"
    private lateinit var db: CuePointDatabase
    private lateinit var store: Store
    private lateinit var curation: Curation
    private lateinit var replica: Replica

    @Before
    fun setUp() {
        db = CuePointDatabase.create(ApplicationProvider.getApplicationContext(), inMemory = true)
        store = Store(db)
        curation = Curation(store)
    }

    @After
    fun tearDown() = db.close()

    private suspend fun connect() {
        replica = Replica(other, store.init().userId)
    }
    private suspend fun fromHere() = replica.receive(store.opsSince(replica.vv))
    private suspend fun fromOther() = store.receive(replica.opsSince(store.versionVector()))
    private fun p(v: String?): JsonElement = v?.let(::JsonPrimitive) ?: JsonNull

    private fun input(urn: String? = "soundcloud:tracks:123", url: String? = "https://soundcloud.com/a/deep-groove", title: String = "Deep Groove") =
        TrackInput(title = title, artist = "Fixture Artist", url = url, urn = urn)

    private suspend fun lastOp(): Op = Merge.json.decodeFromString(db.dao().events().last().json)

    @Test
    fun conflictShowsBothValuesAndResolutionWritesOnlyThatField() = runTest {
        connect()
        val r = curation.createResearch("Techno")
        fromHere()
        replica.put(EntityType.RESEARCH, r.id, mapOf("name" to p("Techno Peak")))
        curation.updateResearch(r.id, name = "Techno Groovy")
        fromOther()

        val c = Conflicts.load(store).single()
        assertEquals("Pesquisa", c.kind)
        assertEquals("Nome", c.fieldLabel)
        assertEquals(listOf("Techno Groovy", "Techno Peak"), c.options.map { it.label }.sorted())
        assertEquals(1, c.options.count { it.current })
        assertTrue(c.options.flatMap { it.origins }.contains(other))

        store.resolve(EntityType.RESEARCH, r.id, "name", p("Techno Peak"))
        assertTrue(Conflicts.load(store).isEmpty())
        val op = lastOp()
        assertEquals("resolve", op.operation)
        assertEquals(setOf("name"), op.fields.keys)
    }

    @Test
    fun keepingADeletedRecordRestoresItWithTheOtherEdit() = runTest {
        connect()
        val r = curation.createResearch("Techno")
        fromHere()
        curation.deleteResearch(r.id)
        replica.put(EntityType.RESEARCH, r.id, mapOf("description" to p("ainda uso")))
        fromOther()

        val c = Conflicts.load(store).single()
        assertEquals("Exclusão", c.fieldLabel)
        assertEquals(listOf("Excluída", "Mantida (não excluída)"), c.options.map { it.label }.sorted())
        store.resolve(EntityType.RESEARCH, r.id, "deleted_at", JsonNull)
        assertTrue(Conflicts.load(store).isEmpty())
        val rec = store.get(EntityType.RESEARCH, r.id)!!
        assertTrue(Merge.isAlive(rec))
        assertEquals("ainda uso", Merge.str(rec, "description"))
    }

    @Test
    fun divergentDecisionReadsApprovedVsRejected() = runTest {
        connect()
        val r = curation.createResearch("Latin Bass")
        val t = curation.ensureTrack(input())
        curation.decide(t.id, r.id, true)
        fromHere()
        replica.put(EntityType.DECISION, Ids.decisionId(t.id, r.id), mapOf("decision" to JsonPrimitive(false), "device_source" to p(other)))
        curation.decide(t.id, r.id, false)
        curation.decide(t.id, r.id, true)
        fromOther()
        val c = Conflicts.load(store).single()
        assertEquals("Decisão", c.kind)
        assertTrue(c.subject.contains("Deep Groove") && c.subject.contains("Latin Bass"))
        assertEquals(listOf("Aprovada", "Rejeitada"), c.options.map { it.label }.sorted())
    }

    @Test
    fun mergingProvisionalWithDifferentDecisionBecomesConflict() = runTest {
        val r = curation.createResearch("Peak Time")
        val definitive = curation.ensureTrack(input())
        curation.decide(definitive.id, r.id, false)
        val provisional = curation.ensureTrack(input(urn = null, url = null, title = "Deep Groove (rip)"))
        curation.decide(provisional.id, r.id, true)
        curation.mergeTracks(provisional.id, definitive.id)
        val c = Conflicts.load(store).single()
        assertEquals(Ids.decisionId(definitive.id, r.id), c.entityId)
        assertEquals("decision", c.field)
    }

    @Test
    fun definitiveFromAnotherDeviceAbsorbsLocalProvisional() = runTest {
        connect()
        val r = curation.createResearch("Peak Time")
        val provisional = curation.ensureTrack(input(urn = null))
        curation.decide(provisional.id, r.id, true)
        fromHere()
        val definitiveId = Ids.trackIdFromUrn("soundcloud:tracks:123")
        replica.put(EntityType.TRACK, definitiveId, mapOf(
            "soundcloud_urn" to p("soundcloud:tracks:123"), "soundcloud_url" to p(input().url), "title" to p("Deep Groove"),
            "artist" to p("Fixture Artist"), "artwork_url" to JsonNull, "metadata_source" to p("dom"), "merged_into" to JsonNull,
        ))
        fromOther()

        assertEquals(1, curation.reconcileProvisional())
        assertEquals(definitiveId, Merge.str(store.get(EntityType.TRACK, provisional.id)!!, "merged_into"))
        assertEquals(true, curation.decisionState(definitiveId, r.id).first)
        assertTrue(Conflicts.load(store).isEmpty())
        assertEquals(0, curation.reconcileProvisional())
    }

    @Test
    fun sameNameCategoriesAreSuggestedAndMergedIntoTheOldest() = runTest {
        connect()
        val r = curation.createResearch("Latin Bass")
        val t1 = curation.ensureTrack(input())
        val t2 = curation.ensureTrack(input(urn = "soundcloud:tracks:456", url = null, title = "Outra"))
        val mine = curation.createCategory("Vocal")
        curation.decide(t1.id, r.id, true)
        curation.setTrackCategory(t1.id, r.id, mine.id, true)
        fromHere()
        val theirs = "30000000-0000-4000-8000-0000000000ff"
        replica.put(EntityType.CATEGORY, theirs, mapOf("user_id" to p(replica.userId), "name" to p(" vocal"), "description" to p("")))
        replica.put(EntityType.DECISION, Ids.decisionId(t2.id, r.id), mapOf(
            "user_id" to p(replica.userId), "track_id" to p(t2.id), "research_id" to p(r.id),
            "decision" to JsonPrimitive(true), "device_source" to p(other),
        ))
        replica.put(EntityType.TRACK_CATEGORY, Ids.trackCategoryId(t2.id, r.id, theirs), mapOf(
            "track_id" to p(t2.id), "research_id" to p(r.id), "category_id" to p(theirs),
        ))
        fromOther()

        val snapshot = Snapshot.of(db.dao().observeAll().first())
        assertEquals(listOf(listOf(mine.id, theirs)), snapshot.categoryDuplicates().map { g -> g.map { it.id } })

        curation.mergeCategories(mine.id, listOf(theirs))
        assertEquals(listOf(mine.id), curation.listCategories().map { it.id })
        assertEquals(listOf(mine.id), curation.decisionState(t2.id, r.id).second)
        assertEquals(listOf(mine.id), curation.decisionState(t1.id, r.id).second)
        assertTrue(Snapshot.of(db.dao().observeAll().first()).categoryDuplicates().isEmpty())
    }

    @Test
    fun pendingPerPeerCountsWhatThePeerDoesNotHave() = runTest {
        val peer = "cccccccc-0000-4000-8000-00000000000c"
        val r = curation.createResearch("Techno")
        assertNull(store.knownBy(peer))
        store.noteKnown(peer, store.versionVector())
        assertEquals(0, store.pendingFor(store.knownBy(peer)!!))
        curation.updateResearch(r.id, description = "a")
        curation.updateResearch(r.id, description = "b")
        assertEquals(2, store.pendingFor(store.knownBy(peer)!!))
        store.noteKnown(peer, store.versionVector())
        assertEquals(0, store.pendingFor(store.knownBy(peer)!!))
    }
}
