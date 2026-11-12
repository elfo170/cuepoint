package com.elfo170.cuepoint.soundcloud

import com.elfo170.cuepoint.core.Merge
import com.elfo170.cuepoint.core.SoundCloudProtocol
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import java.net.URLDecoder
import java.util.Base64

/**
 * SoundCloud falso (MockWebServer), com as mesmas regras do falso do TS
 * (packages/helper/test/soundcloud.test.ts) e da API real conferida em 11/11/2026:
 * `client_credentials` só em Basic; as outras trocas só com o app no corpo; refresh token de uso
 * único; código de autorização vinculado ao desafio PKCE.
 */
class FakeSoundCloud(val creds: SoundCloudProtocol.Credentials = SoundCloudProtocol.Credentials("app-client-id", "s3cr3t-do-app")) : Dispatcher() {
    data class TokenCall(val grant: String, val authorization: String?, val contentType: String?, val body: String)

    val server = MockWebServer().also {
        it.dispatcher = this
        it.start()
    }
    val base: String = server.url("/").toString().trimEnd('/')
    val tokenCalls = mutableListOf<TokenCall>()
    val apiCalls = mutableListOf<String>()
    var tokenSeq = 0
    var expiresIn = 3600L
    val usedRefresh = mutableSetOf<String>()
    /** Respostas forçadas para as próximas chamadas à API (ex.: 429, 401). */
    val queue = ArrayDeque<Int>()
    var revoked = false
    val playlists = LinkedHashMap<String, MutableList<String>>()
    val sharing = mutableMapOf<String, String?>()
    /** link → id da faixa */
    val links = mutableMapOf("https://soundcloud.com/a/sem-urn" to 77L)
    var pageSize = 2
    val sleeps = mutableListOf<Long>()

    fun api(now: () -> Long = System::currentTimeMillis) =
        ScApi(tokenUrl = "$base/oauth/token", apiBase = base, sleep = { sleeps += it }, now = now)

    fun close() = server.shutdown()

    private fun json(status: Int, body: String, headers: Map<String, String> = emptyMap()) =
        MockResponse().setResponseCode(status).setHeader("content-type", "application/json").also { r ->
            headers.forEach { (k, v) -> r.setHeader(k, v) }
        }.setBody(body)

    private fun form(body: String): Map<String, String> = body.split('&').filter { it.isNotEmpty() }.associate {
        URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
    }

    override fun dispatch(request: RecordedRequest): MockResponse = synchronized(this) {
        val url = request.requestUrl!!
        val method = request.method!!
        val body = request.body.readUtf8()
        val auth = request.getHeader("authorization")

        if (url.encodedPath == "/oauth/token") {
            val p = form(body)
            val grant = p["grant_type"].orEmpty()
            tokenCalls += TokenCall(grant, auth, request.getHeader("content-type"), body)
            if (grant == "client_credentials") {
                val basic = "Basic " + Base64.getEncoder().encodeToString("${creds.clientId}:${creds.clientSecret}".toByteArray())
                if ("client_secret" in p || auth != basic) return json(401, """{"error":"invalid_client"}""")
                return json(200, """{"access_token":"cc","expires_in":3600}""")
            }
            if (auth != null) return json(400, """{"error":"invalid_request"}""")
            if (p["client_id"] != creds.clientId || p["client_secret"] != creds.clientSecret) return json(401, """{"error":"invalid_client"}""")
            if (grant == "refresh_token") {
                val rt = p["refresh_token"].orEmpty()
                if (revoked || !usedRefresh.add(rt)) return json(400, """{"error":"invalid_grant"}""")
                if (p["redirect_uri"] != SoundCloudProtocol.REDIRECT_URI) return json(400, """{"error":"invalid_grant"}""")
            }
            if (grant == "authorization_code") {
                val challenge = SoundCloudProtocol.pkceChallenge(p["code_verifier"].orEmpty())
                if (p["code"] != "code-for-$challenge" || p["redirect_uri"] != SoundCloudProtocol.REDIRECT_URI) {
                    return json(400, """{"error":"invalid_grant"}""")
                }
                revoked = false
            }
            tokenSeq += 1
            return json(200, """{"access_token":"at$tokenSeq","refresh_token":"rt$tokenSeq","expires_in":$expiresIn}""")
        }

        val segments = url.pathSegments
        val path = "/" + segments.joinToString("/")
        apiCalls += "$method $path"
        queue.removeFirstOrNull()?.let { return json(it, """{"error":"forced $it"}""") }
        if (revoked || auth != "OAuth at$tokenSeq") return json(401, "{}")

        if (method == "GET" && path == "/me") return json(200, """{"username":"dj-teste","permalink_url":"https://soundcloud.com/dj-teste"}""")
        if (method == "POST" && path == "/disconnect") {
            revoked = true
            return MockResponse().setResponseCode(204)
        }
        if (method == "GET" && path == "/resolve") {
            val id = links[url.queryParameter("url")] ?: return json(404, """{"error":"not found"}""")
            val location = "$base/tracks/$id"
            return json(302, """{"status":"302 - Found","location":"$location"}""", mapOf("location" to location))
        }
        if (method == "GET" && segments.size == 2 && segments[0] == "tracks") {
            return json(200, """{"kind":"track","urn":"soundcloud:tracks:${segments[1]}","title":"t"}""")
        }
        if (method == "POST" && path == "/playlists") {
            val p = Merge.parseObject(body).getValue("playlist").jsonObject
            val id = "soundcloud:playlists:${playlists.size + 1}"
            playlists[id] = urns(p).toMutableList()
            sharing[id] = p["sharing"]?.jsonPrimitive?.content
            return json(201, """{"urn":"$id","permalink_url":"https://soundcloud.com/x/sets/${playlists.size}"}""")
        }
        if (segments.firstOrNull() == "playlists" && segments.size >= 2) {
            val id = segments[1]
            val list = playlists[id] ?: return json(404, """{"error":"not found"}""")
            if (method == "PUT" && segments.size == 2) {
                val p = Merge.parseObject(body).getValue("playlist").jsonObject
                if ("sharing" in p) return json(400, """{"error":"PUT não deveria mudar a visibilidade"}""")
                playlists[id] = urns(p).toMutableList()
                return json(200, """{"urn":"$id","permalink_url":"https://soundcloud.com/x/sets/1"}""")
            }
            if (method == "GET" && segments.size == 3 && segments[2] == "tracks") {
                check(url.queryParameter("access") == "playable,preview,blocked") { "faltou access=playable,preview,blocked" }
                val offset = url.queryParameter("offset")?.toInt() ?: 0
                val page = list.drop(offset).take(pageSize)
                val next = if (offset + pageSize < list.size) {
                    "\"$base/playlists/${SoundCloudProtocol.encodeUriComponent(id)}/tracks?access=playable,preview,blocked&linked_partitioning=true&offset=${offset + pageSize}\""
                } else "null"
                val items = page.joinToString(",") { u -> """{"urn":"$u","title":"T${u.substringAfterLast(':')}","user":{"username":"a"}}""" }
                return json(200, """{"collection":[$items],"next_href":$next}""")
            }
        }
        return json(404, """{"error":"rota falsa ausente: $method $path"}""")
    }

    private fun urns(p: JsonObject) = (p["tracks"] as? JsonArray ?: JsonArray(emptyList())).map {
        it.jsonObject.getValue("urn").let { u -> (u as JsonPrimitive).content }
    }
}
