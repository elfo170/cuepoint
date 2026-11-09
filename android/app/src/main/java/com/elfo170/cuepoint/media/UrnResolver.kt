package com.elfo170.cuepoint.media

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/** Metadados lidos da página da faixa no SoundCloud. */
data class TrackPage(val urn: String?, val title: String?, val artist: String?, val artworkUrl: String?)

/**
 * Busca a página da faixa para obter o URN (e título/artista/capa quando disponíveis).
 * Requer internet; sem ela a faixa continua provisória (PRD §8.2). Resultados ficam em cache.
 */
class UrnResolver(private val fetch: suspend (String) -> String = ::httpGet) {
    private val cache = ConcurrentHashMap<String, TrackPage>()

    suspend fun resolve(url: String): TrackPage? {
        cache[url]?.let { return it }
        val html = runCatching { fetch(url) }.getOrNull() ?: return null
        return parse(html).also { if (it.urn != null) cache[url] = it }
    }

    companion object {
        private fun meta(html: String, prop: String): String? =
            Regex("""<meta[^>]+(?:property|name)="${Regex.escape(prop)}"[^>]+content="([^"]*)"""").find(html)?.groupValues?.get(1)
                ?.replace("&amp;", "&")?.replace("&quot;", "\"")?.replace("&#39;", "'")

        fun parse(html: String) = TrackPage(
            urn = SoundCloudUrls.extractUrnFromHtml(html),
            title = meta(html, "og:title"),
            artist = meta(html, "twitter:audio:artist_name") ?: meta(html, "soundcloud:user"),
            artworkUrl = meta(html, "og:image"),
        )

        suspend fun httpGet(url: String): String = withContext(Dispatchers.IO) {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) CuePoint")
            try {
                check(conn.responseCode in 200..299) { "HTTP ${conn.responseCode}" }
                conn.inputStream.bufferedReader().use { it.readText() }
            } finally {
                conn.disconnect()
            }
        }
    }
}
