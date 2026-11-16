package com.elfo170.cuepoint.soundiiz

import com.elfo170.cuepoint.core.SoundiizProtocol
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Exportação via Soundiiz no celular (Sprint 19, Issue #4): alternativa sem Artist Pro, com
 * paridade com a extensão. A forma do pedido vem de `SoundiizProtocol` (vetor compartilhado).
 * Um pedido por toque, sem novas tentativas: a API tem limite de requisições. O endereço é
 * injetável só para os testes (MockWebServer).
 */
class SoundiizClient(
    private val importUrl: String = SoundiizProtocol.IMPORT_URL,
    client: OkHttpClient? = null,
) {
    private val http: OkHttpClient = (client ?: OkHttpClient()).newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun export(
        name: String,
        description: String?,
        tracks: List<SoundiizProtocol.TrackInput>,
    ): SoundiizProtocol.Result = withContext(Dispatchers.IO) {
        val req = SoundiizProtocol.importRequest(name, description, tracks)
        val body = Json.encodeToString(JsonObject.serializer(), req.payload).toByteArray(Charsets.UTF_8)
        val builder = Request.Builder()
            .url(if (req.url == SoundiizProtocol.IMPORT_URL) importUrl else req.url)
            // bytes: `String.toRequestBody` acrescentaria "; charset=utf-8" ao content-type
            .post(body.toRequestBody(req.headers.getValue("content-type").toMediaType()))
        req.headers.forEach { (k, v) -> builder.header(k, v) }
        try {
            http.newCall(builder.build()).execute().use { res ->
                val text = res.body?.string().orEmpty()
                val json = runCatching { Json.parseToJsonElement(text) }.getOrNull()
                SoundiizProtocol.parseResponse(res.code, json)
            }
        } catch (e: IOException) {
            SoundiizProtocol.Result.Error(SoundiizProtocol.ErrorCode.NETWORK, 0, e.message)
        }
    }
}

/** Textos iguais aos da extensão (`packages/extension/src/library/soundiiz.ts`). */
object SoundiizTexts {
    fun block(block: SoundiizProtocol.Block): String = when (block) {
        SoundiizProtocol.Block.Empty -> "Playlist vazia: adicione músicas para exportar."
        is SoundiizProtocol.Block.TooMany ->
            "Máximo de ${block.max} músicas por envio (esta tem ${block.count})."
    }

    fun error(e: SoundiizProtocol.Result.Error): String = when (e.code) {
        SoundiizProtocol.ErrorCode.INVALID -> "O Soundiiz recusou a playlist."
        SoundiizProtocol.ErrorCode.UNAVAILABLE -> "Soundiiz indisponível. Tente em alguns minutos."
        SoundiizProtocol.ErrorCode.NETWORK ->
            "Não foi possível falar com o Soundiiz. Confira a conexão e tente de novo."
        SoundiizProtocol.ErrorCode.HTTP -> "Erro no Soundiiz. Tente mais tarde."
    }
}
