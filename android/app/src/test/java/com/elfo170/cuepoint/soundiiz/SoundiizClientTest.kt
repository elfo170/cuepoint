package com.elfo170.cuepoint.soundiiz

import com.elfo170.cuepoint.core.SoundiizProtocol
import com.elfo170.cuepoint.core.SoundiizProtocol.ErrorCode
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test

/** Camada HTTP da exportação via Soundiiz no celular (Sprint 19). */
class SoundiizClientTest {
    private lateinit var server: MockWebServer
    private val share = "https://soundiiz.com/go/import-playlist/0123456789abcdef0123456789abcdef"
    private val tracks = listOf(
        SoundiizProtocol.TrackInput("Faixa B", "Artista 2"),
        SoundiizProtocol.TrackInput("Faixa A", "  "),
    )

    private fun client() = SoundiizClient(importUrl = server.url("/go/import-playlist").toString())

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @After
    fun tearDown() = server.shutdown()

    private fun respond(code: Int, body: String) =
        server.enqueue(MockResponse().setResponseCode(code).setHeader("content-type", "application/json").setBody(body))

    @Test
    fun sendsCorePayloadInPlaylistOrder() = runBlocking {
        respond(200, """{"status":"success","nbTracks":2,"shareUrl":"$share","expiresAt":1782220923}""")
        val r = client().export("House", "", tracks)
        assertEquals(SoundiizProtocol.Result.Ok(share, 2, 1782220923L), r)

        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("application/json", req.getHeader("content-type"))
        assertEquals("application/json", req.getHeader("accept"))
        val body = Json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("House", body.getValue("title").jsonPrimitive.content)
        assertEquals("soundcloud", body.getValue("destination").jsonPrimitive.content)
        assertEquals("CuePoint", body.getValue("sourceName").jsonPrimitive.content)
        assertEquals("Playlist exportada do CuePoint", body.getValue("description").jsonPrimitive.content)
        val list = body.getValue("tracklist").jsonArray.map { it.jsonObject }
        assertEquals(listOf("Faixa B", "Faixa A"), list.map { it.getValue("title").jsonPrimitive.content })
        assertEquals("Artista 2", list[0].getValue("artists").jsonArray.single().jsonPrimitive.content)
        assertFalse("artista vazio é omitido", "artists" in list[1])
    }

    @Test
    fun badRequestCarriesSoundiizMessage() = runBlocking {
        respond(400, """{"status":"error","message":"Missing track title at index 1."}""")
        val r = client().export("House", null, tracks) as SoundiizProtocol.Result.Error
        assertEquals(ErrorCode.INVALID, r.code)
        assertEquals("O Soundiiz recusou a playlist: Missing track title at index 1.", SoundiizTexts.error(r))
    }

    @Test
    fun tooManyRequestsIsUnavailableWithoutRetry() = runBlocking {
        respond(429, """{"status":"error","message":"Too many requests. Please try again later."}""")
        val r = client().export("House", null, tracks) as SoundiizProtocol.Result.Error
        assertEquals(ErrorCode.UNAVAILABLE, r.code)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun nonJsonServerErrorIsUnavailable() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503).setBody("<html>Maintenance</html>"))
        val r = client().export("House", null, tracks) as SoundiizProtocol.Result.Error
        assertEquals(ErrorCode.UNAVAILABLE, r.code)
    }

    @Test
    fun foreignShareUrlIsRejected() = runBlocking {
        respond(200, """{"status":"success","nbTracks":2,"shareUrl":"https://example.com/x","expiresAt":1}""")
        val r = client().export("House", null, tracks) as SoundiizProtocol.Result.Error
        assertEquals(ErrorCode.HTTP, r.code)
    }

    @Test
    fun connectionFailureIsNetwork() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        val r = client().export("House", null, tracks) as SoundiizProtocol.Result.Error
        assertEquals(ErrorCode.NETWORK, r.code)
        assertEquals("Não foi possível falar com o Soundiiz. Confira a conexão e tente de novo.", SoundiizTexts.error(r))
    }

    @Test
    fun blockTextsMatchExtension() {
        assertEquals("Playlist vazia: adicione músicas para exportar.", SoundiizTexts.block(SoundiizProtocol.Block.Empty))
        assertEquals(
            "O Soundiiz aceita até 200 músicas por envio; esta playlist tem 201. Divida-a em playlists menores para exportar.",
            SoundiizTexts.block(SoundiizProtocol.check(201)!!),
        )
    }
}
