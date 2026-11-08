package com.elfo170.cuepoint.data

import com.elfo170.cuepoint.core.Merge
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** Visões tipadas dos registros (somente leitura) usadas pela interface. */
private fun JsonObject.s(field: String): String? = Merge.str(this, field)
private fun JsonObject.b(field: String): Boolean = (this[field] as? JsonPrimitive)?.booleanOrNull ?: false
private fun JsonObject.alive(): Boolean = this["deleted_at"] is JsonNull

data class Track(
    val id: String, val urn: String?, val url: String?, val title: String, val artist: String,
    val artworkUrl: String?, val mergedInto: String?, val deleted: Boolean, val updatedAt: String,
) {
    val provisional get() = urn == null

    companion object {
        fun of(o: JsonObject) = Track(
            o.s("id")!!, o.s("soundcloud_urn"), o.s("soundcloud_url"), o.s("title") ?: "", o.s("artist") ?: "",
            o.s("artwork_url"), o.s("merged_into"), !o.alive(), o.s("updated_at") ?: "",
        )
    }
}

data class Research(val id: String, val name: String, val description: String, val archived: Boolean, val deleted: Boolean) {
    companion object {
        fun of(o: JsonObject) = Research(o.s("id")!!, o.s("name") ?: "", o.s("description") ?: "", o.b("archived"), !o.alive())
    }
}

data class Category(val id: String, val name: String, val description: String, val deleted: Boolean) {
    companion object {
        fun of(o: JsonObject) = Category(o.s("id")!!, o.s("name") ?: "", o.s("description") ?: "", !o.alive())
    }
}

data class Decision(
    val id: String, val trackId: String, val researchId: String, val decision: Boolean,
    val deleted: Boolean, val createdAt: String, val updatedAt: String,
) {
    companion object {
        fun of(o: JsonObject) = Decision(
            o.s("id")!!, o.s("track_id")!!, o.s("research_id")!!, o.b("decision"), !o.alive(),
            o.s("created_at") ?: "", o.s("updated_at") ?: "",
        )
    }
}

data class TrackCategory(val id: String, val trackId: String, val researchId: String, val categoryId: String, val deleted: Boolean, val createdAt: String) {
    companion object {
        fun of(o: JsonObject) = TrackCategory(o.s("id")!!, o.s("track_id")!!, o.s("research_id")!!, o.s("category_id")!!, !o.alive(), o.s("created_at") ?: "")
    }
}

data class Playlist(val id: String, val name: String, val description: String, val researchId: String?, val categoryId: String?, val deleted: Boolean) {
    companion object {
        fun of(o: JsonObject) = Playlist(o.s("id")!!, o.s("name") ?: "", o.s("description") ?: "", o.s("research_id"), o.s("category_id"), !o.alive())
    }
}

data class PlaylistTrack(val id: String, val playlistId: String, val trackId: String, val position: String, val deleted: Boolean) {
    companion object {
        fun of(o: JsonObject) = PlaylistTrack(o.s("id")!!, o.s("playlist_id")!!, o.s("track_id")!!, o.s("position")!!, !o.alive())
    }
}

/** Dados mínimos para identificar uma faixa (MediaSession, manual, compartilhamento). */
data class TrackInput(
    val title: String,
    val artist: String,
    val url: String? = null,
    val urn: String? = null,
    val artworkUrl: String? = null,
    val source: String = "android",
)

data class TrackState(val trackId: String?, val provisional: Boolean, val decision: Boolean?, val categoryIds: List<String>)
