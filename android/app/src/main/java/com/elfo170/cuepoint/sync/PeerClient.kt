package com.elfo170.cuepoint.sync

import com.elfo170.cuepoint.core.Protocol
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/** Erro HTTP devolvido pelo par (ex.: approval_required, pending_confirmation, revoked). */
class PeerHttpException(val status: Int, val code: String) : Exception(code)

/**
 * Confia apenas no certificado cujo SHA-256 da chave pública (SPKI) foi recebido no QR de
 * pareamento. Certificados autoassinados de outros aparelhos são recusados.
 */
class PinnedTrustManager(private val certFp: String) : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
        throw CertificateException("não usado")

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("sem certificado")
        val fp = Protocol.sha256Hex(leaf.publicKey.encoded)
        if (!fp.equals(certFp, ignoreCase = true)) throw CertificateException("certificado do aparelho não confere")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

/** Cliente HTTPS para o serviço do PC (certificado fixado + requisições assinadas). */
class PeerClient(
    private val host: String,
    private val port: Int,
    certFp: String,
    private val deviceId: String,
    private val privateKey: PrivateKey,
) {
    private val client: OkHttpClient = run {
        val tm = PinnedTrustManager(certFp)
        val ssl = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), SecureRandom()) }
        OkHttpClient.Builder()
            .sslSocketFactory(ssl.socketFactory, tm)
            .hostnameVerifier { _, _ -> true } // a identidade é garantida pelo fingerprint
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    suspend fun post(path: String, body: String, signed: Boolean = true): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder()
            .url("https://$host:$port$path")
            .post(body.toRequestBody("application/json".toMediaType()))
        if (signed) Protocol.signedHeaders(deviceId, privateKey, "POST", path, body).forEach { (k, v) -> builder.header(k, v) }
        client.newCall(builder.build()).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                val code = Regex(""""error"\s*:\s*"([^"]+)"""").find(text)?.groupValues?.get(1) ?: "http_${res.code}"
                throw PeerHttpException(res.code, code)
            }
            text
        }
    }
}
