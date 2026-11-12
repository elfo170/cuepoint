package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/** Paridade do protocolo do SoundCloud com o TypeScript (spec/vectors/soundcloud.json). */
class SoundCloudVectorsTest {
    private val spec = File(System.getProperty("cuepoint.spec") ?: "../../spec")
    private val v = Merge.parseObject(File(spec, "vectors/soundcloud.json").readText())
    private fun JsonObject.s(k: String) = getValue(k).jsonPrimitive.content
    private fun JsonObject.strings() = mapValues { it.value.jsonPrimitive.content }
    private val creds = v.getValue("credentials").jsonObject.let {
        SoundCloudProtocol.Credentials(it.s("clientId"), it.s("clientSecret"))
    }

    @Test
    fun constantsMatchTypeScript() {
        val c = v.getValue("constants").jsonObject
        assertEquals(c.s("authorizeUrl"), SoundCloudProtocol.AUTHORIZE_URL)
        assertEquals(c.s("tokenUrl"), SoundCloudProtocol.TOKEN_URL)
        assertEquals(c.s("apiBase"), SoundCloudProtocol.API_BASE)
        assertEquals(c.s("redirectUri"), SoundCloudProtocol.REDIRECT_URI)
        assertEquals(c.getValue("callbackPort").jsonPrimitive.int, SoundCloudProtocol.CALLBACK_PORT)
        assertEquals(c.getValue("refreshMarginMs").jsonPrimitive.long, SoundCloudProtocol.REFRESH_MARGIN_MS)
        assertEquals(c.getValue("retryDelaysMs").jsonArray.map { it.jsonPrimitive.long }, SoundCloudProtocol.RETRY_DELAYS_MS)
    }

    @Test
    fun tokenRequestsMatchTypeScript() {
        for (case in v.getValue("tokenRequests").jsonArray) {
            val o = case.jsonObject
            val name = o.s("name")
            val expected = o.getValue("expected").jsonObject
            val req = SoundCloudProtocol.tokenRequest(creds, o.getValue("params").jsonObject.strings())
            assertEquals(name, expected.s("url"), req.url)
            assertEquals(name, expected.getValue("headers").jsonObject.strings(), req.headers)
            assertEquals(name, expected.s("body"), req.body)
        }
    }

    /** Lembrete técnico nº 1: Basic só em `client_credentials`; nas outras trocas, app no corpo. */
    @Test
    fun basicOnlyForClientCredentials() {
        val cc = SoundCloudProtocol.tokenRequest(creds, mapOf("grant_type" to "client_credentials"))
        assertEquals("grant_type=client_credentials", cc.body)
        assertEquals(true, cc.headers["authorization"]?.startsWith("Basic "))
        for (grant in listOf("authorization_code", "refresh_token")) {
            val r = SoundCloudProtocol.tokenRequest(creds, mapOf("grant_type" to grant, "redirect_uri" to SoundCloudProtocol.REDIRECT_URI))
            assertNull(grant, r.headers["authorization"])
            assertEquals(grant, true, r.body.startsWith("client_id="))
            assertEquals(grant, true, r.body.contains("&client_secret="))
        }
    }

    @Test
    fun pkceAndAuthorizeUrlMatchTypeScript() {
        val p = v.getValue("pkce").jsonObject
        assertEquals(p.s("challenge"), SoundCloudProtocol.pkceChallenge(p.s("verifier")))
        val a = v.getValue("authorize").jsonObject
        assertEquals(a.s("url"), SoundCloudProtocol.authorizeUrl(a.s("clientId"), a.s("challenge"), a.s("state")))
    }

    @Test
    fun tokenErrorsMatchTypeScript() {
        for (case in v.getValue("tokenErrors").jsonArray) {
            val o = case.jsonObject
            assertEquals(o.toString(), o.s("code"), SoundCloudProtocol.tokenErrorCode(o.getValue("status").jsonPrimitive.int, o.s("error")))
        }
    }

    @Test
    fun pathsMatchTypeScript() {
        for (case in v.getValue("paths").jsonArray) {
            val o = case.jsonObject
            val arg = o.getValue("arg").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val path = when (o.s("name")) {
                "me" -> SoundCloudProtocol.Paths.ME
                "disconnect" -> SoundCloudProtocol.Paths.DISCONNECT
                "playlists" -> SoundCloudProtocol.Paths.PLAYLISTS
                "playlist" -> SoundCloudProtocol.Paths.playlist(arg!!)
                "playlistTracks" -> SoundCloudProtocol.Paths.playlistTracks(arg!!)
                "resolve" -> SoundCloudProtocol.Paths.resolve(arg!!)
                else -> error("caminho desconhecido: ${o.s("name")}")
            }
            assertEquals(o.s("name"), o.s("path"), path)
        }
    }

    @Test
    fun playlistBodiesMatchTypeScript() {
        for (case in v.getValue("playlistBodies").jsonArray) {
            val input = case.jsonObject.getValue("input").jsonObject
            val body = SoundCloudProtocol.playlistBody(
                title = input.s("title"),
                description = input.s("description"),
                urns = input.getValue("urns").jsonArray.map { it.jsonPrimitive.content },
                sharing = input["sharing"]?.jsonPrimitive?.content,
            )
            assertEquals(case.jsonObject.getValue("body"), body)
        }
    }

    @Test
    fun diffsMatchTypeScript() {
        fun urns(o: JsonObject, k: String) = o.getValue(k).jsonArray.map { it.jsonObject.s("urn") }
        for (case in v.getValue("diffs").jsonArray) {
            val o = case.jsonObject
            val name = o.s("name")
            val d = SoundCloudProtocol.diffTracks(urns(o, "local"), urns(o, "remote")) { it }
            val e = o.getValue("expected").jsonObject
            assertEquals(name, urns(e, "add"), d.add)
            assertEquals(name, urns(e, "remove"), d.remove)
            assertEquals(name, e.getValue("reordered").jsonPrimitive.boolean, d.reordered)
        }
    }

    @Test
    fun trackUrnsMatchTypeScript() {
        for (case in v.getValue("trackUrns").jsonArray) {
            val o = case.jsonObject
            assertEquals(o.s("value"), o.getValue("valid").jsonPrimitive.boolean, SoundCloudProtocol.TRACK_URN.matches(o.s("value")))
        }
        assertFalse(SoundCloudProtocol.TRACK_URN.matches("soundcloud:tracks:1\n"))
    }
}
