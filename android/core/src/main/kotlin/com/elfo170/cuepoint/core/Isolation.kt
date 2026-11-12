package com.elfo170.cuepoint.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Mensagem única (TS e Kotlin) para bibliotecas de usuários diferentes. */
const val FOREIGN_USER_MESSAGE =
    "Os aparelhos são de usuários diferentes. Para parear, apague a biblioteca do aparelho novo ou restaure nele um backup deste aparelho."

/** Operação (ou pareamento) de outro usuário: recusada inteira, nada é aplicado. */
class ForeignUserException(message: String = FOREIGN_USER_MESSAGE) : IllegalStateException(message) {
    val code = "foreign_user"
}

/**
 * Isolamento por usuário (PRD §16) — espelho de `isSameUser`/`assertSameUser` (ops.ts) e
 * `pairingUserDecision` (protocol.ts). Validado por spec/vectors/isolation.json.
 */
object Isolation {
    private val UUID_RE = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

    fun isUuid(value: String) = UUID_RE.matches(value)

    /** A operação pertence a [userId]: autor e, se escrito, o campo `user_id` do registro. */
    fun isSameUser(op: Op, userId: String): Boolean {
        if (op.userId != userId) return false
        val written = op.fields["user_id"] ?: return true
        return written is JsonPrimitive && written.isString && written.content == userId
    }

    /** Recusa o lote inteiro se alguma operação for de outro usuário. */
    fun assertSameUser(ops: List<Op>, userId: String) {
        if (ops.any { !isSameUser(it, userId) }) throw ForeignUserException()
    }

    /**
     * O registro é do usuário (ou não tem dono: faixas e vínculos seguem o registro pai).
     * Espelho de `ownedBy` (extensão, data/queries.ts).
     */
    fun owned(record: JsonObject, userId: String?): Boolean {
        if (userId == null) return true
        val owner = record["user_id"] as? JsonPrimitive ?: return true
        return owner.content == userId
    }

    const val SAME = "same"
    const val ADOPT = "adopt"
    const val FOREIGN = "foreign"

    /**
     * Decisão de usuário no pareamento: `same`, `adopt` (quem entra está vazio e adota o usuário
     * de quem mostrou o código) ou `foreign` (recusado). [joinerUser] nulo = cliente antigo.
     */
    fun pairingUserDecision(hostUser: String, joinerUser: String?, joinerCanAdopt: Boolean): String = when {
        joinerUser == null || joinerUser == hostUser -> SAME
        joinerCanAdopt -> ADOPT
        else -> FOREIGN
    }
}
