package com.elfo170.cuepoint.soundcloud

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ServerSocket
import java.net.Socket

/** Retorno local do login no celular (127.0.0.1, só durante o login). */
class CallbackServerTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @After
    fun tearDown() = scope.cancel()

    companion object {
        /** GET cru (sem cliente HTTP: nada de política de cleartext no caminho). */
        fun get(port: Int, target: String): Pair<Int, String> = Socket("127.0.0.1", port).use { s ->
            s.getOutputStream().write("GET $target HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".toByteArray())
            val text = s.getInputStream().readBytes().toString(Charsets.UTF_8)
            text.substringAfter(' ').substringBefore(' ').toInt() to text
        }
    }

    private fun failure(server: CallbackServer): ScException = runBlocking {
        try {
            withTimeout(5000) { server.code.await() }
            throw AssertionError("deveria falhar")
        } catch (e: ScException) {
            e
        }
    }

    @Test
    fun receivesCodeOnlyWithMatchingState() = runBlocking {
        val server = CallbackServer.open("st4te", scope, port = 0)
        assertEquals(404, get(server.port, "/outra").first)
        val (wrong, page) = get(server.port, "/callback?code=x&state=antigo")
        assertEquals(400, wrong)
        assertTrue(page.contains("não corresponde"))
        assertFalse(server.code.isCompleted) // uma aba antiga não encerra o login
        val (ok, done) = get(server.port, "/callback?code=c%2F0de&state=st4te")
        assertEquals(200, ok)
        assertTrue(done.contains("cuepoint://soundcloud"))
        assertEquals("c/0de", withTimeout(5000) { server.code.await() })
        // fechado depois do retorno
        assertTrue(runCatching { Socket("127.0.0.1", server.port).close() }.isFailure)
    }

    @Test
    fun deniedTimeoutAndCancel() {
        val denied = runBlocking { CallbackServer.open("s", scope, port = 0) }
        assertEquals(400, get(denied.port, "/callback?error=access_denied&state=s").first)
        assertTrue(failure(denied).message!!.contains("cancelado"))

        val slow = runBlocking { CallbackServer.open("s", scope, port = 0, timeoutMs = 50) }
        assertTrue(failure(slow).message!!.contains("a tempo"))

        val cancelled = runBlocking { CallbackServer.open("s", scope, port = 0) }
        cancelled.close()
        assertEquals("login_failed", failure(cancelled).code)
    }

    @Test
    fun busyPortIsReported() {
        ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1")).use { busy ->
            busy.reuseAddress = false
            val e = runCatching { runBlocking { CallbackServer.open("s", scope, port = busy.localPort) } }.exceptionOrNull()
            assertEquals("port_busy", (e as ScException).code)
        }
    }
}
