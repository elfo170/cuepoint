package com.elfo170.cuepoint.soundcloud

import com.elfo170.cuepoint.core.SoundCloudProtocol
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.BindException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder

/**
 * Servidor HTTP local que recebe o retorno do login (`/callback?code&state`), como o
 * `callback.ts` do serviço do PC. Escuta só em 127.0.0.1, fica aberto apenas durante um login e
 * fecha ao receber o retorno, ao ser cancelado ou depois de `timeoutMs`.
 */
class CallbackServer private constructor(
    private val socket: ServerSocket,
    private val state: String,
) {
    private val result = CompletableDeferred<String>()
    private val jobs = mutableListOf<Job>()

    /** Código de autorização (ou ScException: negado, sem código, tempo esgotado, interrompido). */
    val code: Deferred<String> get() = result

    val port: Int get() = socket.localPort

    private fun start(scope: CoroutineScope, timeoutMs: Long) {
        jobs += scope.launch(Dispatchers.IO) {
            while (isActive && !result.isCompleted) {
                val client = try {
                    socket.accept()
                } catch (_: IOException) {
                    break // fechado
                }
                runCatching { client.use { handle(it) } }
            }
        }
        jobs += scope.launch {
            delay(timeoutMs)
            finish(ScException("login_failed", "O login no SoundCloud não foi concluído a tempo."))
        }
    }

    private fun handle(client: Socket) {
        client.soTimeout = 10_000
        val reader = client.getInputStream().bufferedReader(Charsets.UTF_8)
        val requestLine = reader.readLine() ?: return
        while (true) {
            val line = reader.readLine() ?: break
            if (line.isEmpty()) break
        }
        val target = requestLine.split(' ').getOrNull(1) ?: "/"
        val path = target.substringBefore('?')
        val query = target.substringAfter('?', "").split('&').filter { it.isNotEmpty() }.associate { part ->
            val k = part.substringBefore('=')
            val v = part.substringAfter('=', "")
            URLDecoder.decode(k, "UTF-8") to URLDecoder.decode(v, "UTF-8")
        }
        val out = client.getOutputStream()
        fun send(status: Int, title: String, text: String, back: Boolean = false) {
            val body = page(title, text, back).toByteArray(Charsets.UTF_8)
            val reason = if (status == 200) "OK" else if (status == 404) "Not Found" else "Bad Request"
            out.write(
                ("HTTP/1.1 $status $reason\r\ncontent-type: text/html; charset=utf-8\r\n" +
                    "content-length: ${body.size}\r\nconnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
            )
            out.write(body)
            out.flush()
        }
        if (path != "/callback") {
            send(404, "Não encontrado", "")
            return
        }
        if (query["error"] != null) {
            send(400, "Login cancelado", "O SoundCloud não autorizou o CuePoint. Pode voltar ao app.", back = true)
            finish(ScException("login_failed", "O login no SoundCloud foi cancelado."))
            return
        }
        if (query["state"] != state) {
            // não encerra: pode ser uma aba antiga; o login certo ainda pode chegar
            send(400, "Login inválido", "Este retorno não corresponde ao login em andamento.")
            return
        }
        val received = query["code"]
        if (received.isNullOrEmpty()) {
            send(400, "Login inválido", "O SoundCloud não enviou o código de autorização.", back = true)
            finish(ScException("login_failed", "O SoundCloud não enviou o código de autorização."))
            return
        }
        send(200, "Conectado", "O CuePoint recebeu a autorização do SoundCloud.", back = true)
        finish(null, received)
    }

    private fun finish(error: Throwable?, value: String? = null) {
        val done = if (error != null) result.completeExceptionally(error) else result.complete(value!!)
        if (done) shutdown()
    }

    private fun shutdown() {
        runCatching { socket.close() }
        jobs.forEach { it.cancel() }
    }

    /** Interrompe o login em andamento. */
    fun close() {
        finish(ScException("login_failed", "Login interrompido."))
        shutdown()
    }

    companion object {
        const val LOGIN_TIMEOUT_MS = 5 * 60 * 1000L

        /** Abre o servidor. Porta ocupada → `ScException("port_busy")`. */
        suspend fun open(
            state: String,
            scope: CoroutineScope,
            port: Int = SoundCloudProtocol.CALLBACK_PORT,
            timeoutMs: Long = LOGIN_TIMEOUT_MS,
        ): CallbackServer {
            val socket = withContext(Dispatchers.IO) {
                val s = ServerSocket()
                try {
                    s.reuseAddress = true
                    s.bind(InetSocketAddress(InetAddress.getByName(SoundCloudProtocol.CALLBACK_HOST), port))
                    s
                } catch (e: BindException) {
                    s.close()
                    throw ScException("port_busy", "A porta $port do celular está ocupada por outro app. Feche-o e tente de novo.")
                }
            }
            return CallbackServer(socket, state).also { it.start(scope, timeoutMs) }
        }

        private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

        private fun page(title: String, text: String, back: Boolean): String =
            """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>CuePoint</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#222}
h1{font-size:1.3rem}a{display:inline-block;margin-top:1rem;padding:.6rem 1rem;border-radius:.5rem;background:#ea580c;color:#fff;text-decoration:none}</style></head>
<body><h1>${esc(title)}</h1><p>${esc(text)}</p>${if (back) """<a href="cuepoint://soundcloud">Voltar ao CuePoint</a>""" else ""}</body></html>"""
    }
}
