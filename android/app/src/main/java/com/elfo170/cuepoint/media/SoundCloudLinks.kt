package com.elfo170.cuepoint.media

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * "Abrir no SoundCloud" sem API: o app do SoundCloud abre a faixa pelo link interno
 * `soundcloud://sounds:<id>` (o mesmo que a página publica em `al:android:url`). Quando a faixa
 * tem o endereço web (vindo do Chrome pela sincronização), ele serve de alternativa.
 */
object SoundCloudLinks {
    private val URN = Regex("""^soundcloud:tracks:(\d+)$""")

    /** `soundcloud:tracks:123` → `soundcloud://sounds:123`; null para URN ausente ou inválido. */
    fun appUri(urn: String?): String? = urn?.let { URN.matchEntire(it)?.groupValues?.get(1) }?.let { "soundcloud://sounds:$it" }

    /** Links a tentar, em ordem: app do SoundCloud, depois a página web. */
    fun candidates(urn: String?, url: String?): List<String> =
        listOfNotNull(appUri(urn), SoundCloudUrls.normalizeTrackUrl(url)).distinct()

    fun canOpen(urn: String?, url: String?) = candidates(urn, url).isNotEmpty()

    /** Abre a faixa; devolve false se nenhum app tratou os links (ex.: SoundCloud ausente e sem URL). */
    fun open(context: Context, urn: String?, url: String?): Boolean {
        for (link in candidates(urn, url)) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                return true
            } catch (_: ActivityNotFoundException) {
                // tenta o próximo (ex.: app do SoundCloud não instalado → navegador)
            }
        }
        return false
    }
}
