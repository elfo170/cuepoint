package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.security.MessageDigest
import java.util.Base64

/**
 * Protocolo da API do SoundCloud — espelho de packages/core/src/soundcloud.ts. Só funções puras;
 * a paridade é conferida por spec/vectors/soundcloud.json (`SoundCloudVectorsTest`).
 */
object SoundCloudProtocol {
    const val AUTHORIZE_URL = "https://secure.soundcloud.com/authorize"
    const val TOKEN_URL = "https://secure.soundcloud.com/oauth/token"
    const val API_BASE = "https://api.soundcloud.com"
    const val CALLBACK_HOST = "127.0.0.1"
    const val CALLBACK_PORT = 47801
    /** Endereço de retorno cadastrado no app do SoundCloud, o mesmo no PC e no celular. */
    const val REDIRECT_URI = "http://$CALLBACK_HOST:$CALLBACK_PORT/callback"
    /** Renova o access token quando faltar menos que isto para expirar. */
    const val REFRESH_MARGIN_MS = 5 * 60 * 1000L
    /** Esperas depois de um 429 antes de desistir. */
    val RETRY_DELAYS_MS = listOf(1000L, 2000L, 4000L)
    val TRACK_URN = Regex("^soundcloud:tracks:\\d+$")

    data class Credentials(val clientId: String, val clientSecret: String)

    data class HttpRequest(val url: String, val headers: Map<String, String>, val body: String)

    /**
     * Pedido ao endpoint de token (form-urlencoded).
     *
     * Conferido na API real em 11/11/2026, divergindo da OpenAPI: `client_credentials` só aceita o
     * app em **HTTP Basic** (no corpo → 401 `invalid_client`); `authorization_code` e
     * `refresh_token` levam `client_id`/`client_secret` **no corpo** (Basic → `invalid_request`).
     * Toda troca de token no app passa obrigatoriamente por aqui.
     */
    fun tokenRequest(creds: Credentials, params: Map<String, String>): HttpRequest {
        val basic = params["grant_type"] == "client_credentials"
        val fields = LinkedHashMap<String, String>()
        if (!basic) {
            fields["client_id"] = creds.clientId
            fields["client_secret"] = creds.clientSecret
        }
        fields.putAll(params)
        val headers = linkedMapOf(
            "accept" to "application/json; charset=utf-8",
            "content-type" to "application/x-www-form-urlencoded",
        )
        if (basic) {
            val raw = "${creds.clientId}:${creds.clientSecret}".toByteArray(Charsets.UTF_8)
            headers["authorization"] = "Basic " + Base64.getEncoder().encodeToString(raw)
        }
        return HttpRequest(TOKEN_URL, headers, formEncode(fields))
    }

    /** URL de autorização (authorization code + PKCE S256 + `state`). */
    fun authorizeUrl(clientId: String, challenge: String, state: String): String =
        "$AUTHORIZE_URL?" + formEncode(linkedMapOf(
            "client_id" to clientId,
            "redirect_uri" to REDIRECT_URI,
            "response_type" to "code",
            "code_challenge" to challenge,
            "code_challenge_method" to "S256",
            "state" to state,
        ))

    /** Desafio PKCE S256: base64url(sha256(verifier)) sem preenchimento. */
    fun pkceChallenge(verifier: String): String =
        Base64.getUrlEncoder().withoutPadding()
            .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    /** `rate_limited`, `invalid_client`, `reconnect` ou `api` (mesma regra do TS). */
    fun tokenErrorCode(status: Int, error: String): String = when {
        status == 429 -> "rate_limited"
        error == "invalid_client" || status == 401 -> "invalid_client"
        error == "invalid_grant" -> "reconnect"
        else -> "api"
    }

    object Paths {
        const val ME = "/me"
        const val DISCONNECT = "/disconnect"
        const val PLAYLISTS = "/playlists"
        fun playlist(urn: String) = "/playlists/${encodeUriComponent(urn)}"
        /** Sem `access`, a API omite as faixas `blocked`; segue-se `next_href` depois. */
        fun playlistTracks(urn: String) =
            "/playlists/${encodeUriComponent(urn)}/tracks?access=playable,preview,blocked&linked_partitioning=true"
        fun resolve(url: String) = "/resolve?url=${encodeUriComponent(url)}"
    }

    /** Corpo de `POST /playlists` (com `sharing`) ou `PUT /playlists/{urn}` (sem `sharing`). */
    fun playlistBody(title: String, description: String, urns: List<String>, sharing: String? = null): JsonObject {
        val playlist = linkedMapOf(
            "title" to JsonPrimitive(title),
            "description" to JsonPrimitive(description),
            "tracks" to JsonArray(urns.map { JsonObject(mapOf("urn" to JsonPrimitive(it))) }),
        )
        if (sharing != null) playlist["sharing"] = JsonPrimitive(sharing)
        return JsonObject(mapOf("playlist" to JsonObject(playlist)))
    }

    data class TrackDiff<T>(val add: List<T>, val remove: List<T>, val reordered: Boolean)

    /** O que muda no SoundCloud ao espelhar `local` (ordem do CuePoint) sobre `remote`. */
    fun <T> diffTracks(local: List<T>, remote: List<T>, urn: (T) -> String): TrackDiff<T> {
        val localSet = local.map(urn).toSet()
        val remoteSet = remote.map(urn).toSet()
        fun common(list: List<T>, other: Set<String>) = list.map(urn).filter { it in other }
        return TrackDiff(
            add = local.filter { urn(it) !in remoteSet },
            remove = remote.filter { urn(it) !in localSet },
            reordered = common(local, remoteSet) != common(remote, localSet),
        )
    }

    /** Serialização `application/x-www-form-urlencoded` igual à do `URLSearchParams`. */
    fun formEncode(fields: Map<String, String>): String =
        fields.entries.joinToString("&") { (k, v) -> formComponent(k) + "=" + formComponent(v) }

    private fun formComponent(s: String): String = escape(s, FORM_SAFE, spacePlus = true)

    /** Igual ao `encodeURIComponent` do JavaScript. */
    fun encodeUriComponent(s: String): String = escape(s, URI_COMPONENT_SAFE, spacePlus = false)

    private const val ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    private const val FORM_SAFE = "$ALNUM*-._"
    private const val URI_COMPONENT_SAFE = "$ALNUM-_.!~*'()"

    private fun escape(s: String, safe: String, spacePlus: Boolean): String {
        val out = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xff).toChar()
            when {
                c.code < 0x80 && c in safe -> out.append(c)
                spacePlus && c == ' ' -> out.append('+')
                else -> out.append('%').append("%02X".format(b.toInt() and 0xff))
            }
        }
        return out.toString()
    }
}
