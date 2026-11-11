package com.elfo170.cuepoint.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Log
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.roundToInt

/** De onde vem a capa de uma faixa. */
sealed interface ArtworkSource {
    /** Imagem recebida da MediaSession e guardada só neste aparelho. */
    data object Session : ArtworkSource

    /** Endereço web (`artwork_url`, sincronizado do Chrome). */
    data class Web(val url: String) : ArtworkSource

    data object None : ArtworkSource
}

/**
 * Cache local das capas (`filesDir/artwork`). A capa que a MediaSession entrega como imagem é
 * reduzida e gravada como `<trackId>.webp`; ela **não sincroniza** (o `artwork_url` do modelo é um
 * endereço web). Capas com endereço web são baixadas uma vez e guardadas como `web-<sha1>.webp`.
 * Prioridade: a imagem da sessão; o endereço web é a reserva.
 */
class ArtworkCache(
    private val dir: File,
    private val download: suspend (String) -> ByteArray? = ::httpBytes,
    private val maxPx: Int = MAX_PX,
) {
    private val memory = LruCache<String, Bitmap>(64)
    private val failed = ConcurrentHashMap.newKeySet<String>()
    private val locks = ConcurrentHashMap<String, Mutex>()
    private val _version = MutableStateFlow(0)

    /** Muda quando uma capa nova é gravada — a interface recarrega as miniaturas. */
    val version: StateFlow<Int> = _version

    fun sessionFile(trackId: String) = File(dir, "${safe(trackId)}.webp")
    fun webFile(url: String) = File(dir, "web-${sha1(url)}.webp")

    fun hasSession(trackId: String?) = trackId != null && sessionFile(trackId).isFile

    fun source(trackId: String?, artworkUrl: String?) = chooseSource(hasSession(trackId), artworkUrl)

    /** Grava a capa recebida da sessão (se ainda não houver). Devolve true se gravou. */
    suspend fun saveSession(trackId: String, bitmap: Bitmap): Boolean = withContext(Dispatchers.IO) {
        lock("s:$trackId").withLock {
            val file = sessionFile(trackId)
            if (file.isFile) return@withLock false
            val scaled = scale(bitmap)
            if (!write(file, scaled)) return@withLock false
            memory.put("s:$trackId", scaled)
            _version.value++
            true
        }
    }

    /** Capa já em memória (sem I/O), para o primeiro quadro da interface. */
    fun peek(trackId: String?, artworkUrl: String?): Bitmap? = when (val s = source(trackId, artworkUrl)) {
        ArtworkSource.Session -> memory.get("s:$trackId")
        is ArtworkSource.Web -> memory.get("w:${s.url}")
        ArtworkSource.None -> null
    }

    /** Carrega a capa pela fonte escolhida; null se não houver capa ou se falhar. */
    suspend fun load(trackId: String?, artworkUrl: String?): Bitmap? = when (val s = source(trackId, artworkUrl)) {
        ArtworkSource.Session -> loadFile("s:$trackId", sessionFile(trackId!!)) ?: loadWeb(artworkUrl)
        is ArtworkSource.Web -> loadWeb(s.url)
        ArtworkSource.None -> null
    }

    private suspend fun loadFile(key: String, file: File): Bitmap? {
        memory.get(key)?.let { return it }
        return withContext(Dispatchers.IO) {
            runCatching { BitmapFactory.decodeFile(file.path) }.getOrNull()?.also { memory.put(key, it) }
        }
    }

    private suspend fun loadWeb(url: String?): Bitmap? {
        if (url == null || !url.startsWith("http")) return null
        val key = "w:$url"
        memory.get(key)?.let { return it }
        if (url in failed) return null
        return withContext(Dispatchers.IO) {
            lock(key).withLock {
                memory.get(key)?.let { return@withLock it }
                val file = webFile(url)
                if (file.isFile) return@withLock loadFile(key, file)
                val bytes = runCatching { download(url) }.getOrNull()
                val decoded = bytes?.let { decode(it) }
                if (decoded == null) {
                    failed += url
                    return@withLock null
                }
                write(file, decoded)
                memory.put(key, decoded)
                decoded
            }
        }
    }

    private fun decode(bytes: ByteArray): Bitmap? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val opts = BitmapFactory.Options().apply { inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, maxPx) }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)?.let(::scale)
    }.getOrNull()

    private fun scale(bitmap: Bitmap): Bitmap {
        val (w, h) = scaledSize(bitmap.width, bitmap.height, maxPx)
        return if (w == bitmap.width && h == bitmap.height) bitmap else Bitmap.createScaledBitmap(bitmap, w, h, true)
    }

    private fun write(file: File, bitmap: Bitmap): Boolean = runCatching {
        file.parentFile?.mkdirs()
        // escrita atômica: arquivo temporário + rename
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.outputStream().use { bitmap.compress(webp(), 85, it) }
        check(tmp.renameTo(file) || (file.delete() && tmp.renameTo(file)))
    }.onFailure { Log.w(TAG, "falha ao gravar a capa ${file.name}", it) }.isSuccess

    private fun lock(key: String) = locks.getOrPut(key) { Mutex() }

    companion object {
        const val TAG = "CuePointMedia"
        const val MAX_PX = 256

        /** A imagem da sessão (local) tem prioridade; o endereço web (do Chrome) é a reserva. */
        fun chooseSource(hasSession: Boolean, artworkUrl: String?): ArtworkSource = when {
            hasSession -> ArtworkSource.Session
            artworkUrl != null && artworkUrl.startsWith("http") -> ArtworkSource.Web(artworkUrl)
            else -> ArtworkSource.None
        }

        /** Mantém a proporção e limita o maior lado a [maxPx] (nunca amplia). */
        fun scaledSize(width: Int, height: Int, maxPx: Int): Pair<Int, Int> {
            val largest = max(width, height)
            if (largest <= maxPx || largest <= 0) return width to height
            val ratio = maxPx.toDouble() / largest
            return max(1, (width * ratio).roundToInt()) to max(1, (height * ratio).roundToInt())
        }

        /** Maior potência de 2 que ainda deixa a imagem com pelo menos [maxPx] no maior lado. */
        fun sampleSize(width: Int, height: Int, maxPx: Int): Int {
            var sample = 1
            while (max(width, height) / (sample * 2) >= maxPx) sample *= 2
            return sample
        }

        private fun safe(id: String) = id.replace(Regex("[^A-Za-z0-9._-]"), "_")

        private fun sha1(text: String) =
            MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

        @Suppress("DEPRECATION")
        private fun webp() = if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP

        suspend fun httpBytes(url: String): ByteArray = withContext(Dispatchers.IO) {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) CuePoint")
            try {
                check(conn.responseCode in 200..299) { "HTTP ${conn.responseCode}" }
                conn.inputStream.use { it.readBytes() }
            } finally {
                conn.disconnect()
            }
        }
    }
}
