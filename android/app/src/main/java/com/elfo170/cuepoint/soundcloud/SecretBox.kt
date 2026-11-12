package com.elfo170.cuepoint.soundcloud

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Cifra os segredos do SoundCloud antes de irem para o banco (espelho do `SecretBox` do PC). */
interface SecretBox {
    fun seal(plain: String): String
    fun open(sealed: String): String
}

/**
 * Android Keystore: chave AES-256-GCM que nunca sai do aparelho (alias `cuepoint.sc`). O cifrado
 * fica no `meta` do Room como `ks1:<iv>:<dados>`. Desinstalar o app apaga a chave.
 */
class KeystoreBox(private val alias: String = "cuepoint.sc") : SecretBox {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(PROVIDER).apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    override fun seal(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val data = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return "$PREFIX${b64(cipher.iv)}:${b64(data)}"
    }

    override fun open(sealed: String): String {
        require(sealed.startsWith(PREFIX)) { "segredo em formato desconhecido" }
        val (iv, data) = sealed.removePrefix(PREFIX).split(':', limit = 2).map { Base64.getDecoder().decode(it) }
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)) }
        return String(cipher.doFinal(data), Charsets.UTF_8)
    }

    private fun b64(bytes: ByteArray) = Base64.getEncoder().encodeToString(bytes)

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val PREFIX = "ks1:"
    }
}

/** Sem cifra real: só para testes (o Robolectric não tem Android Keystore). */
class PlainBox : SecretBox {
    override fun seal(plain: String) = "plain:" + Base64.getEncoder().encodeToString(plain.toByteArray(Charsets.UTF_8))

    override fun open(sealed: String): String {
        require(sealed.startsWith("plain:")) { "segredo em formato desconhecido" }
        return String(Base64.getDecoder().decode(sealed.removePrefix("plain:")), Charsets.UTF_8)
    }
}
