package com.elfo170.cuepoint.soundcloud

import com.elfo170.cuepoint.core.Merge
import com.elfo170.cuepoint.core.SoundCloudProtocol
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Erro com código estável (os mesmos do serviço do PC) e mensagem em linguagem simples. */
class ScException(val code: String, message: String, val status: Int? = null) : Exception(message)

@Serializable
data class ScTokens(val accessToken: String, val refreshToken: String? = null, val expiresAt: Long)

/** Resposta já validada (2xx ou 3xx) de uma chamada à API. */
class ScResponse(val status: Int, val location: String?, val body: String) {
    fun json(): JsonObject = if (body.isBlank()) JsonObject(emptyMap()) else Merge.parseObject(body)
}

/**
 * HTTP da API do SoundCloud (OAuth 2.1 + `Authorization: OAuth <token>`), espelho das chamadas do
 * `client.ts` do serviço do PC. A forma dos pedidos vem de `SoundCloudProtocol` (paridade por
 * vetor). Os endereços são injetáveis só para os testes (MockWebServer).
 */
class ScApi(
    private val tokenUrl: String = SoundCloudProtocol.TOKEN_URL,
    private val apiBase: String = SoundCloudProtocol.API_BASE,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val now: () -> Long = System::currentTimeMillis,
    client: OkHttpClient? = null,
) {
    private val http: OkHttpClient = (client ?: OkHttpClient()).newBuilder()
        .followRedirects(false) // o /resolve responde 302: seguido à mão, com o token
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /**
     * Troca no endpoint de token. Lembrete técnico nº 1 (divergência da OpenAPI conferida na API
     * real): Basic só em `client_credentials`; o app vai no corpo nas outras trocas — regra
     * aplicada por `SoundCloudProtocol.tokenRequest`, nunca montada aqui.
     */
    suspend fun requestToken(creds: SoundCloudProtocol.Credentials, params: Map<String, String>): ScTokens {
        val req = SoundCloudProtocol.tokenRequest(creds, params)
        val builder = Request.Builder()
            .url(if (req.url == SoundCloudProtocol.TOKEN_URL) tokenUrl else req.url)
            // bytes: `String.toRequestBody` acrescentaria "; charset=utf-8" ao content-type do vetor
            .post(req.body.toByteArray(Charsets.UTF_8).toRequestBody(req.headers.getValue("content-type").toMediaType()))
        req.headers.forEach { (k, v) -> builder.header(k, v) }
        val (status, text) = execute(builder.build()) { it.code to it.body?.string().orEmpty() }
        val json = runCatching { Merge.parseObject(text) }.getOrDefault(JsonObject(emptyMap()))
        val access = (json["access_token"] as? JsonPrimitive)?.contentOrNull
        if (status in 200..299 && access != null) {
            val ttl = (json["expires_in"] as? JsonPrimitive)?.longOrNull ?: 3600L
            return ScTokens(access, (json["refresh_token"] as? JsonPrimitive)?.contentOrNull, now() + ttl * 1000)
        }
        val error = (json["error"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        throw when (SoundCloudProtocol.tokenErrorCode(status, error)) {
            "rate_limited" -> ScException("rate_limited", "O SoundCloud pediu para esperar. Tente de novo mais tarde.", status)
            "invalid_client" -> ScException(
                "invalid_client",
                "O SoundCloud não aceitou o código e a senha do app. Confira os dois em soundcloud.com/you/apps (o app exige Artist Pro ativo).",
                status,
            )
            "reconnect" -> ScException("reconnect", RECONNECT_MESSAGE, status)
            else -> ScException("api", "O SoundCloud recusou o pedido ($status${if (error.isNotEmpty()) ": $error" else ""}).", status)
        }
    }

    /**
     * Chamada autenticada. 401 → uma renovação forçada (`token(true)`) e nova tentativa; 429 →
     * espera 1 s, 2 s e 4 s e desiste com mensagem clara. Respostas 3xx voltam para quem chamou.
     */
    suspend fun call(
        method: String,
        pathOrUrl: String,
        body: JsonElement? = null,
        token: suspend (force: Boolean) -> String,
    ): ScResponse {
        val url = if (pathOrUrl.startsWith("http")) pathOrUrl else apiBase + pathOrUrl
        var refreshed = false
        var throttled = 0
        while (true) {
            val access = token(false)
            val builder = Request.Builder().url(url)
                .header("accept", "application/json; charset=utf-8")
                .header("authorization", "OAuth $access")
            val payload = body?.toString()?.toByteArray(Charsets.UTF_8)?.toRequestBody("application/json".toMediaType())
            builder.method(method, payload ?: if (method == "POST" || method == "PUT") ByteArray(0).toRequestBody() else null)
            val res = execute(builder.build()) { ScResponse(it.code, it.header("location"), it.body?.string().orEmpty()) }
            when {
                res.status == 401 && !refreshed -> {
                    refreshed = true
                    token(true)
                }
                res.status == 429 -> {
                    val wait = SoundCloudProtocol.RETRY_DELAYS_MS.getOrNull(throttled++)
                        ?: throw ScException(
                            "rate_limited",
                            "O SoundCloud pediu para esperar (limite de requisições). Tente de novo em alguns minutos.",
                            429,
                        )
                    sleep(wait)
                }
                res.status == 401 -> throw ScException("reconnect", "O SoundCloud recusou o acesso. Toque em Reconectar.", 401)
                res.status == 404 -> throw ScException("not_found", "Não encontrado no SoundCloud.", 404)
                res.status >= 400 -> throw ScException(
                    "api",
                    "O SoundCloud recusou o pedido (${res.status}). ${res.body.take(200)}".trim(),
                    res.status,
                )
                else -> return res
            }
        }
    }

    private suspend fun <T> execute(request: Request, read: (okhttp3.Response) -> T): T = withContext(Dispatchers.IO) {
        try {
            http.newCall(request).execute().use(read)
        } catch (e: IOException) {
            throw ScException("network", "Sem conexão com o SoundCloud. Verifique a internet.")
        }
    }

    companion object {
        const val RECONNECT_MESSAGE = "O acesso ao SoundCloud expirou. Toque em Reconectar."
    }
}
