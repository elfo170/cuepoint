package com.elfo170.cuepoint.data

import androidx.test.core.app.ApplicationProvider
import com.elfo170.cuepoint.core.EntityType
import com.elfo170.cuepoint.core.Ids
import com.elfo170.cuepoint.core.Replica
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CurationTest {
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

    private fun input(i: Int, urn: Boolean = true) = TrackInput(
        title = "Faixa $i", artist = "Artista $i", url = "https://soundcloud.com/a/faixa-$i",
        urn = if (urn) "soundcloud:tracks:$i" else null,
    )

    @Test
    fun identityIsCreatedOnce() = runTest {
        val a = store.init()
        val b = Store(db).init()
        assertEquals(a.deviceId, b.deviceId)
        assertTrue(a.deviceName.startsWith("Android"))
    }

    @Test
    fun decisionsAreIndependentPerResearchAndLogged() = runTest {
        val latin = curation.createResearch("Latin Bass")
        val techno = curation.createResearch("Techno Groovy")
        val t = curation.ensureTrack(input(1))
        assertEquals(Ids.trackIdFromUrn("soundcloud:tracks:1"), t.id)
        curation.decide(t.id, latin.id, true)
        curation.decide(t.id, techno.id, false)
        assertEquals(true, curation.decisionState(t.id, latin.id).first)
        assertEquals(false, curation.decisionState(t.id, techno.id).first)
        val events = db.dao().events().filter { it.origin == store.init().deviceId }
        assertEquals((1L..events.size).toList(), events.map { it.seq }.sorted())
    }

    @Test
    fun noopWritesDoNotCreateOperations() = runTest {
        val r = curation.createResearch("Peak Time")
        val t = curation.ensureTrack(input(1))
        val cat = curation.createCategory("Vocal")
        curation.decide(t.id, r.id, true)
        curation.setTrackCategory(t.id, r.id, cat.id, true)
        val before = db.dao().events().size
        curation.decide(t.id, r.id, true)
        curation.setTrackCategory(t.id, r.id, cat.id, true)
        curation.ensureTrack(input(1))
        assertEquals(before, db.dao().events().size)
        assertEquals(cat.id, curation.createCategory("  vocal ").id)
    }

    @Test
    fun approvalWithManyOrNoCategoriesAndSnapshot() = runTest {
        val r = curation.createResearch("Peak Time")
        val a = curation.ensureTrack(input(1))
        val b = curation.ensureTrack(input(2))
        val vocal = curation.createCategory("Vocal")
        val groovy = curation.createCategory("Groovy")
        curation.decide(a.id, r.id, true)
        curation.setTrackCategory(a.id, r.id, vocal.id, true)
        curation.setTrackCategory(a.id, r.id, groovy.id, true)
        curation.decide(b.id, r.id, true)
        val snap = Snapshot.of(db.dao().observeAll().first())
        val s = snap.summaries(false).single()
        assertEquals(2, s.approved)
        assertEquals(1, s.pending)
        assertEquals(listOf(a.id), snap.researchTracks(r.id, Snapshot.Tab.APPROVED, setOf(vocal.id, groovy.id)).map { it.track.id })
        assertEquals(listOf(b.id), snap.researchTracks(r.id, Snapshot.Tab.PENDING).map { it.track.id })
    }

    @Test
    fun provisionalTrackIsMergedWhenUrnAppears() = runTest {
        val r = curation.createResearch("Peak Time")
        val cat = curation.createCategory("Vocal")
        val prov = curation.ensureTrack(input(1, urn = false))
        assertNull(prov.urn)
        curation.decide(prov.id, r.id, true)
        curation.setTrackCategory(prov.id, r.id, cat.id, true)
        val state = curation.getTrackState(input(1), r.id)
        assertEquals(Ids.trackIdFromUrn("soundcloud:tracks:1"), state.trackId)
        assertEquals(true, state.decision)
        assertEquals(listOf(cat.id), state.categoryIds)
        assertEquals(state.trackId, store.get(EntityType.TRACK, prov.id)?.let(Track::of)?.mergedInto)
    }

    @Test
    fun manualTrackWithoutUrlMatchesOnlyExactTitleAndArtist() = runTest {
        val a = curation.ensureTrack(TrackInput("Song", "Band"))
        assertEquals(a.id, curation.ensureTrack(TrackInput("Song", "Band")).id)
        assertNotEquals(a.id, curation.ensureTrack(TrackInput("Song ", "Band")).id)
    }

    @Test
    fun playlistsFromSourceReorderAndRefresh() = runTest {
        val r = curation.createResearch("Latin")
        val t = (1..3).map { curation.ensureTrack(input(it)) }
        curation.decide(t[0].id, r.id, true)
        curation.decide(t[1].id, r.id, true)
        val p = curation.createPlaylist("Set", r.id, null)
        assertEquals(listOf(t[0].id, t[1].id), curation.playlistItems(p.id).map { it.second.id })
        val second = curation.playlistItems(p.id)[1].first
        curation.movePlaylistItem(p.id, second.id, 0)
        assertEquals(listOf(t[1].id, t[0].id), curation.playlistItems(p.id).map { it.second.id })
        curation.decide(t[2].id, r.id, true)
        assertEquals(1, curation.refreshPlaylistFromSource(p.id))
        assertEquals(3, curation.playlistItems(p.id).size)
    }

    @Test
    fun exchangesOperationsWithAnotherReplicaIdempotently() = runTest {
        store.init()
        val research = curation.createResearch("Techno")
        val other = Replica("bbbbbbbb-0000-4000-8000-00000000000b", store.init().userId)
        other.receive(store.opsSince(emptyMap()))
        other.put(EntityType.RESEARCH, research.id, mapOf("name" to JsonPrimitive("Techno Groovy")))
        assertEquals(1, store.receive(other.opsSince(store.versionVector())))
        assertEquals(0, store.receive(other.log))
        assertEquals("Techno Groovy", curation.listResearches().single().name)
        // e o outro lado também recebe o que foi feito aqui
        curation.updateResearch(research.id, description = "android")
        other.receive(store.opsSince(other.vv))
        assertEquals("android", other.get(EntityType.RESEARCH, research.id)?.get("description")?.let { (it as JsonPrimitive).content })
    }
}
