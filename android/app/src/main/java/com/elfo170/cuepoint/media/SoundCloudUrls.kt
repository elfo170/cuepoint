package com.elfo170.cuepoint.media

import java.net.URI

/** URLs e URN do SoundCloud — espelho de content/soundcloud/url.ts da extensão. */
object SoundCloudUrls {
    private val RESERVED_ROOTS = setOf(
        "you", "discover", "search", "stream", "upload", "settings", "charts", "messages", "notifications", "pages", "terms-of-use",
    )
    private val RESERVED_SUBPATHS = setOf(
        "sets", "likes", "tracks", "reposts", "albums", "followers", "following", "popular-tracks", "comments",
    )
    private val URN_PATTERNS = listOf(
        Regex("""soundcloud://sounds:(\d+)"""),
        Regex(""""urn"\s*:\s*"soundcloud:tracks:(\d+)""""),
        Regex("""api\.soundcloud\.com/tracks/(\d+)"""),
    )
    private val URL_IN_TEXT = Regex("""https?://(?:www\.|m\.)?soundcloud\.com/[^\s"'<>]+""")

    /** `https://soundcloud.com/<artista>/<faixa>` sem query; null se não for URL de faixa. */
    fun normalizeTrackUrl(href: String?): String? {
        if (href.isNullOrBlank()) return null
        val uri = runCatching { URI(href.trim()) }.getOrNull() ?: return null
        val host = uri.host?.removePrefix("www.")?.removePrefix("m.") ?: return null
        if (host != "soundcloud.com") return null
        val parts = (uri.path ?: "").split('/').filter { it.isNotEmpty() }
        if (parts.size != 2) return null
        if (parts[0] in RESERVED_ROOTS || parts[1] in RESERVED_SUBPATHS) return null
        return "https://soundcloud.com/${parts[0]}/${parts[1]}"
    }

    /** Primeira URL de faixa do SoundCloud num texto (ex.: texto compartilhado pelo app). */
    fun findTrackUrl(text: String?): String? =
        text?.let { URL_IN_TEXT.findAll(it).firstNotNullOfOrNull { m -> normalizeTrackUrl(m.value) } }

    fun extractUrnFromHtml(html: String): String? =
        URN_PATTERNS.firstNotNullOfOrNull { it.find(html)?.groupValues?.get(1) }?.let { "soundcloud:tracks:$it" }

    fun isValidUrn(urn: String?) = urn != null && Regex("""^soundcloud:tracks:\d+$""").matches(urn)
}
