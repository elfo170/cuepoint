package com.elfo170.cuepoint.soundcloud

import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.elfo170.cuepoint.core.Protocol
import com.elfo170.cuepoint.data.CuePointDatabase
import com.elfo170.cuepoint.data.DeviceRow
import com.elfo170.cuepoint.data.Store
import com.elfo170.cuepoint.sync.PeerClient
import com.elfo170.cuepoint.sync.PeerHttpException
import com.elfo170.cuepoint.sync.SyncEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.security.PrivateKey

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class SoundCloudServiceTest {
    private lateinit var db: CuePointDatabase
    private lateinit var store: Store
    private lateinit var fake: FakeSoundCloud
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var clock = 1_700_000_000_000L
    private val pc = "aaaaaaaa-0000-4000-8000-00000000000a"

    /** Respostas do "PC" para POST /v1/sc/credentials (status → corpo ou código de erro). */
    private var pcAnswer: () -> String = { error("sem resposta") }
    private val pcPaths = mutableListOf<String>()

    private inner class FakePc(host: String, port: Int, cert: String, device: String, key: PrivateKey) :
        PeerClient(host, port, cert, device, key) {
        override suspend fun post(path: String, body: String, signed: Boolean): String {
            pcPaths += path
            assertTrue("a busca das credenciais é assinada", signed)
            return pcAnswer()
        }
    }

    private lateinit var service: SoundCloudService

    @Before
    fun setUp() = runBlocking {
        db = CuePointDatabase.create(ApplicationProvider.getApplicationContext(), inMemory = true)
        store = Store(db)
        fake = FakeSoundCloud()
        val sync = SyncEngine(store, clientFactory = { h, p, c, d, k -> FakePc(h, p, c, d, k) })
        service = SoundCloudService(store, sync, PlainBox(), scope, fake.api { clock }, now = { clock }, callbackPort = 0)
        val id = store.init()
        db.dao().putDevice(
            DeviceRow(pc, id.userId, "PC do estúdio", Protocol.publicKeyB64(Protocol.generateKeyPair().public), "paired", "auto",
                "2026-11-12T00:00:00Z", null, cert_fp = "ab".repeat(32), addresses = "192.168.0.10", port = 47800),
        )
    }

    @After
    fun tearDown() {
        scope.cancel()
        fake.close()
        db.close()
    }

    private suspend fun configure() = service.configure(fake.creds.clientId, fake.creds.clientSecret)

    /** Faz o papel do navegador: autoriza e chama o retorno local com o código. */
    private suspend fun connect() {
        val url = Uri.parse(service.login())
        assertEquals("https", url.scheme)
        assertEquals("secure.soundcloud.com", url.host)
        assertEquals("http://127.0.0.1:47801/callback", url.getQueryParameter("redirect_uri"))
        assertEquals("S256", url.getQueryParameter("code_challenge_method"))
        assertTrue(service.status.value.loginPending)
        val challenge = url.getQueryParameter("code_challenge")!!
        val state = url.getQueryParameter("state")!!
        val (status, _) = CallbackServerTest.get(service.loginPort!!, "/callback?code=code-for-$challenge&state=$state")
        assertEquals(200, status)
        withTimeout(5000) { service.status.first { it.state == ScState.CONNECTED && !it.loginPending } }
    }

    @Test
    fun configureValidatesAndKeepsVaultSealed() = runBlocking {
        val bad = runCatching { service.configure(fake.creds.clientId, "senha-errada") }.exceptionOrNull() as ScException
        assertEquals("invalid_client", bad.code)
        assertNull(store.getMeta(SoundCloudService.KEY_VAULT))
        fake.tokenCalls.clear()

        val st = configure()
        assertEquals(ScState.CONFIGURED, st.state)
        assertEquals("app-••••id", st.clientId)
        val sealed = store.getMeta(SoundCloudService.KEY_VAULT)!!
        assertTrue(sealed.startsWith("plain:"))
        assertFalse(sealed.contains(fake.creds.clientSecret))
        // uma única troca client_credentials, em Basic (lembrete técnico nº 1)
        assertEquals(listOf("client_credentials"), fake.tokenCalls.map { it.grant })
        assertTrue(fake.tokenCalls.single().authorization!!.startsWith("Basic "))
    }

    @Test
    fun loginWithPkceThroughLocalCallback() = runBlocking {
        configure()
        connect()
        val st = service.status.value
        assertEquals("dj-teste", st.user?.username)
        val code = fake.tokenCalls.single { it.grant == "authorization_code" }
        assertNull("authorization_code com o app no corpo", code.authorization)
        assertTrue(code.body.startsWith("client_id=app-client-id&client_secret="))
    }

    @Test
    fun concurrentCallsRenewOnlyOnce() = runBlocking {
        configure()
        connect()
        clock += 3600_000 // venceu
        val results = (1..4).map { scope.async { service.call("GET", "/me").status } }.awaitAll()
        assertEquals(listOf(200, 200, 200, 200), results)
        assertEquals(1, fake.tokenCalls.count { it.grant == "refresh_token" })
        val refresh = fake.tokenCalls.single { it.grant == "refresh_token" }
        assertNull(refresh.authorization)
        assertTrue(refresh.body.contains("redirect_uri="))
    }

    @Test
    fun rejectedRefreshAsksToReconnectWithoutLooping() = runBlocking {
        configure()
        connect()
        fake.revoked = true
        clock += 3600_000
        val e = runCatching { service.call("GET", "/me") }.exceptionOrNull() as ScException
        assertEquals("reconnect", e.code)
        assertEquals(ScState.RECONNECT, service.refresh().state)
        val calls = fake.tokenCalls.size
        val again = runCatching { service.call("GET", "/me") }.exceptionOrNull() as ScException
        assertEquals("reconnect", again.code)
        assertEquals("nenhuma nova tentativa sozinha", calls, fake.tokenCalls.size)
        // reconectar volta a funcionar
        connect()
        assertEquals(ScState.CONNECTED, service.refresh().state)
    }

    @Test
    fun receivesCredentialsFromPairedPcOnce() = runBlocking {
        pcAnswer = { throw PeerHttpException(409, "sc_not_shared") }
        val notShared = runCatching { service.receiveFromPc(pc) }.exceptionOrNull() as ScException
        assertEquals("sc_not_shared", notShared.code)
        assertTrue(notShared.message!!.contains("Enviar para este celular"))

        pcAnswer = { throw PeerHttpException(404, "sc_not_configured") }
        assertEquals("sc_not_configured", (runCatching { service.receiveFromPc(pc) }.exceptionOrNull() as ScException).code)
        assertNull(store.getMeta(SoundCloudService.KEY_VAULT))

        pcAnswer = { """{"client_id":"${fake.creds.clientId}","client_secret":"${fake.creds.clientSecret}"}""" }
        assertEquals(ScState.CONFIGURED, service.receiveFromPc(pc).state)
        assertEquals(listOf("/v1/sc/credentials"), pcPaths.distinct())
        // validadas uma vez com client_credentials ao receber
        assertEquals(listOf("client_credentials"), fake.tokenCalls.map { it.grant })
    }

    @Test
    fun forgetRevokesAndErasesEverything() = runBlocking {
        configure()
        connect()
        assertEquals(ScState.UNCONFIGURED, service.forget().state)
        assertTrue("POST /disconnect chamado", fake.revoked)
        assertNull(store.getMeta(SoundCloudService.KEY_VAULT))
        assertNull(store.getMeta(SoundCloudService.KEY_RECONNECT))
    }

    @Test
    fun secretsNeverGoToBackup() = runBlocking {
        configure()
        connect()
        val backup = store.exportBackup().toString()
        assertFalse(backup.contains(fake.creds.clientSecret))
        assertFalse(backup.contains("sc.vault"))
        assertFalse(backup.contains("at1"))
    }
}
