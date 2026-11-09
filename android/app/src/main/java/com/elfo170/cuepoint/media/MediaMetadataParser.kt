package com.elfo170.cuepoint.media

import com.elfo170.cuepoint.data.TrackInput

/**
 * Converte os metadados da MediaSession (PRD §12.3) em [TrackInput].
 * A MediaSession costuma trazer título e artista, mas nem sempre um identificador da faixa;
 * o URN só é usado quando o media id/URI segue um formato reconhecido do SoundCloud.
 */
object MediaMetadataParser {
    const val SOUNDCLOUD_PACKAGE = "com.soundcloud.android"

    private val ID_PATTERNS = listOf(
        Regex("""soundcloud:tracks:(\d+)"""),
        Regex("""soundcloud://sounds:(\d+)"""),
        Regex("""^tracks?:(\d+)$"""),
        Regex("""api\.soundcloud\.com/tracks/(\d+)"""),
    )

    fun urnFrom(vararg candidates: String?): String? = candidates.filterNotNull().firstNotNullOfOrNull { c ->
        ID_PATTERNS.firstNotNullOfOrNull { it.find(c)?.groupValues?.get(1) }?.let { "soundcloud:tracks:$it" }
    }

    fun parse(
        title: String?,
        artist: String?,
        mediaId: String? = null,
        mediaUri: String? = null,
        artworkUri: String? = null,
        source: String = "android",
    ): TrackInput? {
        val cleanTitle = title?.trim().orEmpty()
        if (cleanTitle.isEmpty()) return null
        return TrackInput(
            title = cleanTitle,
            artist = artist?.trim().orEmpty(),
            url = SoundCloudUrls.normalizeTrackUrl(mediaUri) ?: SoundCloudUrls.normalizeTrackUrl(mediaId),
            urn = urnFrom(mediaId, mediaUri),
            artworkUrl = artworkUri?.takeIf { it.startsWith("http") },
            source = source,
        )
    }

    /** Texto compartilhado pelo app do SoundCloud: extrai URL e, se houver, título/artista. */
    fun parseShare(text: String?, subject: String?): TrackInput? {
        val url = SoundCloudUrls.findTrackUrl(text) ?: SoundCloudUrls.findTrackUrl(subject) ?: return null
        // Formatos comuns: "Ouça Título de Artista no #SoundCloud", "Listen to Title by Artist on #SoundCloud"
        val raw = listOfNotNull(subject, text).firstOrNull { !it.isNullOrBlank() }.orEmpty()
        val m = Regex("""(?:Listen to|Ouça|Escute)\s+(.+?)\s+(?:by|de|por)\s+(.+?)\s+(?:on|no|em)\s+#?SoundCloud""", RegexOption.IGNORE_CASE).find(raw)
        val slug = url.substringAfterLast('/').replace('-', ' ')
        return TrackInput(
            title = m?.groupValues?.get(1)?.trim() ?: slug,
            artist = m?.groupValues?.get(2)?.trim() ?: url.split('/')[3].replace('-', ' '),
            url = url,
            source = "share",
        )
    }
}
