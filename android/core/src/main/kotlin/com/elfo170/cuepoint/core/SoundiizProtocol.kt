package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Exportação via Soundiiz (Issue #4) — espelho de packages/core/src/soundiiz.ts. Só funções
 * puras; a paridade é conferida por spec/vectors/soundiiz.json (`SoundiizVectorsTest`).
 * Contrato e resultados da PoC: docs/SOUNDIIZ_API.md.
 */
object SoundiizProtocol {
    const val IMPORT_URL = "https://soundiiz.com/go/import-playlist"
    /** Limite documentado de faixas por pedido (mínimo 1). */
    const val MAX_TRACKS = 200
    /** Corename do SoundCloud na API do Soundiiz (preseleciona o destino). */
    const val DESTINATION = "soundcloud"
    const val SOURCE_NAME = "CuePoint"
    const val DEFAULT_DESCRIPTION = "Playlist exportada do CuePoint"
    /** Só links do próprio Soundiiz são abertos. */
    const val SHARE_PREFIX = "https://soundiiz.com/"

    data class TrackInput(val title: String, val artist: String)

    data class Request(val url: String, val headers: Map<String, String>, val payload: JsonObject)

    /** O que impede o envio antes de chamar a API. */
    sealed interface Block {
        data object Empty : Block
        data class TooMany(val count: Int, val max: Int) : Block
    }

    fun check(trackCount: Int): Block? = when {
        trackCount < 1 -> Block.Empty
        trackCount > MAX_TRACKS -> Block.TooMany(trackCount, MAX_TRACKS)
        else -> null
    }

    /**
     * Pedido de importação: cada faixa leva título e artista (omitido quando vazio), na ordem da
     * playlist; nada de `album`/`isrc`, URN ou link.
     */
    fun importRequest(name: String, description: String?, tracks: List<TrackInput>): Request {
        val desc = description?.let(::jsTrim).orEmpty().ifEmpty { DEFAULT_DESCRIPTION }
        val tracklist = tracks.map { t ->
            val artist = jsTrim(t.artist)
            val fields = linkedMapOf<String, JsonElement>("title" to JsonPrimitive(clean(t.title)))
            if (artist.isNotEmpty()) fields["artists"] = JsonArray(listOf(JsonPrimitive(artist)))
            JsonObject(fields)
        }
        return Request(
            url = IMPORT_URL,
            headers = mapOf("accept" to "application/json", "content-type" to "application/json"),
            payload = JsonObject(
                linkedMapOf(
                    "title" to JsonPrimitive(clean(name)),
                    "sourceName" to JsonPrimitive(SOURCE_NAME),
                    "description" to JsonPrimitive(desc),
                    "destination" to JsonPrimitive(DESTINATION),
                    "tracklist" to JsonArray(tracklist),
                ),
            ),
        )
    }

    enum class ErrorCode(val wire: String) {
        /** HTTP 400: o Soundiiz recusou o pedido (mensagem dele em `message`). */
        INVALID("invalid"),
        /** 429 ou 5xx: indisponível no momento. */
        UNAVAILABLE("unavailable"),
        /** Qualquer outra resposta inesperada (inclui link que não é do Soundiiz). */
        HTTP("http"),
        /** Sem resposta (rede, timeout). Produzido pelo cliente, não por `parseResponse`. */
        NETWORK("network"),
    }

    sealed interface Result {
        data class Ok(val shareUrl: String, val nbTracks: Int, val expiresAt: Long) : Result
        data class Error(val code: ErrorCode, val status: Int, val message: String?) : Result
    }

    /** Interpreta a resposta da API (`body` já convertido de JSON, ou `null` se não era JSON). */
    fun parseResponse(status: Int, body: JsonElement?): Result {
        val obj = body as? JsonObject ?: JsonObject(emptyMap())
        fun str(k: String) = (obj[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun num(k: String) = (obj[k] as? JsonPrimitive)?.takeIf { !it.isString }
        val message = str("message")?.takeIf { it.isNotEmpty() }
        if (status in 200..299 && str("status") == "success") {
            val shareUrl = str("shareUrl")
            val nbTracks = num("nbTracks")?.doubleOrNull
            val expiresAt = num("expiresAt")?.doubleOrNull
            return if (shareUrl != null && shareUrl.startsWith(SHARE_PREFIX) && nbTracks != null && expiresAt != null) {
                Result.Ok(shareUrl, nbTracks.toInt(), num("expiresAt")?.longOrNull ?: expiresAt.toLong())
            } else {
                Result.Error(ErrorCode.HTTP, status, null)
            }
        }
        return when {
            status == 400 -> Result.Error(ErrorCode.INVALID, status, message)
            status == 429 || status >= 500 -> Result.Error(ErrorCode.UNAVAILABLE, status, message)
            else -> Result.Error(ErrorCode.HTTP, status, message)
        }
    }

    /** Texto aparado; se só houver espaços, mantém o original (a API exige título não vazio). */
    private fun clean(s: String) = jsTrim(s).ifEmpty { s }

    /** Igual ao `String.prototype.trim` do JavaScript (o `trim()` do Kotlin usa outro conjunto). */
    fun jsTrim(s: String): String = s.trim { it in JS_WHITESPACE }

    private val JS_WHITESPACE: Set<Char> = buildSet {
        addAll(listOf('\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' '))
        for (c in ' '..' ') add(c)
        addAll(listOf(' ', ' ', ' ', ' ', '　', '﻿'))
    }
}
