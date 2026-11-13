package com.elfo170.cuepoint.soundcloud

import com.elfo170.cuepoint.core.SoundCloudProtocol
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** Camada HTTP da API do SoundCloud no celular (Sprint 16.3). */
class ScApiTest {
    private lateinit var server: MockWebServer
    private val sleeps = mutableListOf<Long>()
    private val creds = SoundCloudProtocol.Credentials("app-client-id", "s3cr3t-do-app")

    private fun api() = ScApi(
        tokenUrl = server.url("/oauth/token").toString(),
        apiBase = server.url("/").toString().trimEnd('/'),
        sleep = { sleeps += it },
        now = { 1_000_000L },
    )

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @After
    fun tearDown() = server.shutdown()

    private fun code(block: suspend () -> Unit): String = try {
        runBlocking { block() }
        fail("deveria falhar")
        ""
    } catch (e: ScException) {
        e.code
    }

    /** Lembrete técnico nº 1: o pedido que sai do app é exatamente o do vetor compartilhado. */
    @Test
    fun tokenRequestsFollowSharedProtocol() = runBlocking {
        val grants = listOf(
            mapOf("grant_type" to "client_credentials"),
            mapOf("grant_type" to "authorization_code", "code" to "c0de", "redirect_uri" to SoundCloudProtocol.REDIRECT_URI, "code_verifier" to "v"),
            mapOf("grant_type" to "refresh_token", "refresh_token" to "rt1", "redirect_uri" to SoundCloudProtocol.REDIRECT_URI),
        )
        for (params in grants) {
            server.enqueue(MockResponse().setBody("""{"access_token":"at","refresh_token":"rt2","expires_in":60}"""))
            val tokens = api().requestToken(creds, params)
            assertEquals(ScTokens("at", "rt2", 1_000_000L + 60_000), tokens)
            val expected = SoundCloudProtocol.tokenRequest(creds, params)
            val req = server.takeRequest()
            assertEquals("POST", req.method)
            assertEquals("/oauth/token", req.path)
            assertEquals(expected.body, req.body.readUtf8())
            assertEquals("application/x-www-form-urlencoded", req.getHeader("content-type"))
            assertEquals(expected.headers["authorization"], req.getHeader("authorization"))
            if (params["grant_type"] == "client_credentials") {
                assertEquals(true, req.getHeader("authorization")?.startsWith("Basic "))
            } else {
                assertNull(req.getHeader("authorization"))
            }
        }
    }

    @Test
    fun tokenErrorsBecomeStableCodes() {
        val cases = listOf(
            MockResponse().setResponseCode(400).setBody("""{"error":"invalid_grant"}""") to "reconnect",
            MockResponse().setResponseCode(401).setBody("""{"error":"invalid_client"}""") to "invalid_client",
            MockResponse().setResponseCode(429).setBody("{}") to "rate_limited",
            MockResponse().setResponseCode(500).setBody("oops") to "api",
        )
        for ((res, expected) in cases) {
            server.enqueue(res)
            assertEquals(expected, code { api().requestToken(creds, mapOf("grant_type" to "refresh_token", "refresh_token" to "x")) })
        }
    }

    @Test
    fun unauthorizedRenewsOnceThenGivesUp() = runBlocking {
        val forced = mutableListOf<Boolean>()
        val token: suspend (Boolean) -> String = { f -> forced += f; if (f) "novo" else "velho" }
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setBody("""{"username":"dj"}"""))
        val res = api().call("GET", "/me", token = token)
        assertEquals("dj", res.json()["username"].toString().trim('"'))
        assertEquals(listOf(false, true, false), forced)
        assertEquals("OAuth velho", server.takeRequest().getHeader("authorization"))
        server.takeRequest()

        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401))
        assertEquals("reconnect", code { api().call("GET", "/me", token = token) })
    }

    @Test
    fun rateLimitWaitsOneTwoFourSecondsThenGivesUp() = runBlocking {
        repeat(3) { server.enqueue(MockResponse().setResponseCode(429)) }
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, api().call("GET", "/me", token = { "t" }).status)
        assertEquals(listOf(1000L, 2000L, 4000L), sleeps)

        sleeps.clear()
        repeat(4) { server.enqueue(MockResponse().setResponseCode(429)) }
        assertEquals("rate_limited", code { api().call("GET", "/me", token = { "t" }) })
        assertEquals(listOf(1000L, 2000L, 4000L), sleeps)
    }

    @Test
    fun notFoundRedirectAndNetworkErrors() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(404))
        assertEquals("not_found", code { api().call("GET", "/playlists/x", token = { "t" }) })

        // 3xx não é seguido sozinho (o /resolve é seguido à mão, com o token)
        server.enqueue(MockResponse().setResponseCode(302).setHeader("location", "https://api.soundcloud.com/tracks/1"))
        val r = api().call("GET", "/resolve?url=x", token = { "t" })
        assertEquals(302, r.status)
        assertEquals("https://api.soundcloud.com/tracks/1", r.location)

        server.enqueue(MockResponse().setResponseCode(422).setBody("tracks inválidas"))
        assertEquals("api", code { api().call("PUT", "/playlists/x", token = { "t" }) })

        val dead = ScApi(tokenUrl = "http://127.0.0.1:1/oauth/token", apiBase = "http://127.0.0.1:1")
        assertThrows(ScException::class.java) { runBlocking { dead.call("GET", "/me", token = { "t" }) } }
        assertEquals("network", code { dead.requestToken(creds, mapOf("grant_type" to "client_credentials")) })
    }
}
