package com.elfo170.cuepoint.soundcloud

import com.elfo170.cuepoint.core.Merge
import com.elfo170.cuepoint.core.SoundCloudProtocol
import com.elfo170.cuepoint.data.Store
import com.elfo170.cuepoint.sync.PeerHttpException
import com.elfo170.cuepoint.sync.SyncEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.security.SecureRandom
import java.util.Base64

enum class ScState { UNCONFIGURED, CONFIGURED, CONNECTED, RECONNECT }

data class ScUser(val username: String, val permalinkUrl: String?)

data class ScStatus(
    val state: ScState = ScState.UNCONFIGURED,
    /** Código do app, parcialmente oculto. */
    val clientId: String? = null,
    /** Conta conectada (só em memória: nada vindo da API é guardado além do URN). */
    val user: ScUser? = null,
    val loginPending: Boolean = false,
    val lastError: String? = null,
)

/** Cofre cifrado deste celular: credenciais do app (do usuário) + tokens deste aparelho. */
@Serializable
internal data class ScVault(val clientId: String, val clientSecret: String, val tokens: ScTokens? = null) {
    val credentials get() = SoundCloudProtocol.Credentials(clientId, clientSecret)
}

/**
 * Exportação para o SoundCloud no celular (Sprint 16): espelho do `SoundCloud` do serviço do PC.
 * As credenciais do app chegam do PC (liberação de uso único) ou são digitadas; ficam cifradas
 * com o Android Keystore no `meta` do banco (`sc.vault`), fora do backup e da sincronização. Os
 * tokens são deste aparelho. Só ações iniciadas pelo usuário chamam a API.
 */
class SoundCloudService(
    private val store: Store,
    private val sync: SyncEngine,
    private val box: SecretBox,
    private val scope: CoroutineScope,
    private val api: ScApi = ScApi(),
    private val now: () -> Long = System::currentTimeMillis,
    /** Porta do retorno do login (0 nos testes). */
    private val callbackPort: Int = SoundCloudProtocol.CALLBACK_PORT,
    private val loginTimeoutMs: Long = CallbackServer.LOGIN_TIMEOUT_MS,
) {
    private val _status = MutableStateFlow(ScStatus())
    val status: StateFlow<ScStatus> = _status

    private val vaultMutex = Mutex()
    private var vault: ScVault? = null
    private var loaded = false
    private var user: ScUser? = null
    private var lastError: String? = null
    private var waiter: CallbackServer? = null
    private var refreshing: Deferred<ScTokens>? = null

    // ------------------------------------------------------------------ cofre

    private suspend fun load(): ScVault? = vaultMutex.withLock {
        if (!loaded) {
            vault = store.getMeta(KEY_VAULT)?.let { Merge.json.decodeFromString<ScVault>(box.open(it)) }
            loaded = true
        }
        vault
    }

    private suspend fun save(v: ScVault?) = vaultMutex.withLock {
        if (v == null) store.deleteMeta(KEY_VAULT) else store.setMeta(KEY_VAULT, box.seal(Merge.json.encodeToString(v)))
        vault = v
        loaded = true
    }

    private suspend fun setReconnect(on: Boolean) =
        if (on) store.setMeta(KEY_RECONNECT, "1") else store.deleteMeta(KEY_RECONNECT)

    // ------------------------------------------------------------------ estado

    /** Recalcula o estado (e busca "Conectado como @…" quando ainda não se sabe). */
    suspend fun refresh(): ScStatus {
        val v = load()
        var state = when {
            v == null -> ScState.UNCONFIGURED
            v.tokens != null -> ScState.CONNECTED
            store.getMeta(KEY_RECONNECT) != null -> ScState.RECONNECT
            else -> ScState.CONFIGURED
        }
        if (state == ScState.CONNECTED && user == null) {
            try {
                loadMe()
            } catch (e: ScException) {
                if (e.code == "reconnect") state = ScState.RECONNECT else lastError = e.message
            }
        }
        return ScStatus(
            state = state,
            clientId = v?.clientId?.let(::mask),
            user = if (state == ScState.CONNECTED) user else null,
            loginPending = waiter != null,
            lastError = lastError,
        ).also { _status.value = it }
    }

    /** Salva as credenciais do app depois de validá-las com uma troca `client_credentials` (uma vez). */
    suspend fun configure(clientId: String, clientSecret: String): ScStatus {
        val creds = SoundCloudProtocol.Credentials(clientId.trim(), clientSecret.trim())
        if (creds.clientId.isEmpty() || creds.clientSecret.isEmpty()) throw ScException("invalid_client", "Informe o código e a senha do app.")
        api.requestToken(creds, mapOf("grant_type" to "client_credentials"))
        val current = load()
        val sameApp = current?.clientId == creds.clientId
        save(ScVault(creds.clientId, creds.clientSecret, if (sameApp) current?.tokens else null))
        if (!sameApp) {
            user = null
            setReconnect(false)
        }
        lastError = null
        return refresh()
    }

    /** Busca as credenciais no PC pareado (liberação de uso único feita na extensão) e as salva. */
    suspend fun receiveFromPc(peerId: String): ScStatus {
        val creds = try {
            sync.fetchScCredentials(peerId)
        } catch (e: PeerHttpException) {
            throw ScException(
                e.code,
                when (e.code) {
                    "sc_not_shared" -> "O PC não liberou o envio. No PC, abra Configurações → Exportar para o SoundCloud → Usar no celular → Enviar para este celular, e toque de novo em Receber do PC em até 10 minutos."
                    "sc_not_configured" -> "O PC ainda não tem o código e a senha do app. Configure a exportação no PC primeiro, ou digite os dois aqui."
                    "revoked" -> "Este celular não está mais pareado com o PC."
                    "pending_confirmation" -> "Confirme o pareamento no PC antes de receber as credenciais."
                    "foreign_user" -> "O PC é de outro usuário."
                    else -> "O PC recusou o pedido (${e.code})."
                },
                e.status,
            )
        } catch (e: ScException) {
            throw e
        } catch (e: Exception) {
            throw ScException("network", "Não foi possível falar com o PC. Ele precisa estar ligado, na mesma rede, com o CuePoint aberto.")
        }
        return configure(creds.clientId, creds.clientSecret)
    }

    /** Desconecta e apaga credenciais e tokens deste celular. */
    suspend fun forget(): ScStatus {
        runCatching { logout() }
        save(null)
        setReconnect(false)
        lastError = null
        return refresh()
    }

    // ------------------------------------------------------------------ login

    /**
     * Abre o retorno local (127.0.0.1:47801) e devolve a URL de autorização para abrir no
     * navegador; a troca do código acontece em segundo plano quando o retorno chegar.
     */
    suspend fun login(): String {
        val v = load() ?: throw ScException("not_configured", "Informe primeiro o código e a senha do app.")
        waiter?.close()
        val verifier = random(32)
        val state = random(16)
        val server = CallbackServer.open(state, scope, callbackPort, loginTimeoutMs)
        waiter = server
        lastError = null
        refresh()
        scope.launch {
            try {
                val code = server.code.await()
                val tokens = api.requestToken(
                    v.credentials,
                    mapOf(
                        "grant_type" to "authorization_code",
                        "code" to code,
                        "redirect_uri" to SoundCloudProtocol.REDIRECT_URI,
                        "code_verifier" to verifier,
                    ),
                )
                save(v.copy(tokens = tokens))
                setReconnect(false)
                user = null
                runCatching { loadMe() }
            } catch (e: Exception) {
                lastError = e.message
            } finally {
                if (waiter === server) waiter = null
                refresh()
            }
        }
        return SoundCloudProtocol.authorizeUrl(v.clientId, SoundCloudProtocol.pkceChallenge(verifier), state)
    }

    /** Porta em que o retorno do login está escutando (testes usam porta 0). */
    val loginPort: Int? get() = waiter?.port

    /** Revoga os tokens deste app no SoundCloud (melhor esforço) e os apaga daqui. */
    suspend fun logout(): ScStatus {
        waiter?.close()
        waiter = null
        val v = load()
        if (v?.tokens != null) {
            runCatching { call("POST", SoundCloudProtocol.Paths.DISCONNECT) }
            save(v.copy(tokens = null))
        }
        user = null
        setReconnect(false)
        return refresh()
    }

    // ------------------------------------------------------------------ tokens

    internal suspend fun accessToken(force: Boolean = false): String {
        val pending = vaultMutex.withLock {
            val v = vault ?: throw ScException("not_configured", "Informe primeiro o código e a senha do app.")
            val t = v.tokens ?: throw if (store.getMeta(KEY_RECONNECT) != null) {
                ScException("reconnect", ScApi.RECONNECT_MESSAGE)
            } else {
                ScException("not_connected", "Entre com o SoundCloud primeiro.")
            }
            if (!force && t.expiresAt - now() > SoundCloudProtocol.REFRESH_MARGIN_MS) return t.accessToken
            // uma renovação por vez: o refresh token é de uso único
            refreshing ?: scope.async { renew(v) }.also { d ->
                refreshing = d
                d.invokeOnCompletion { scope.launch { vaultMutex.withLock { if (refreshing === d) refreshing = null } } }
            }
        }
        return pending.await().accessToken
    }

    private suspend fun renew(v: ScVault): ScTokens {
        try {
            val rt = v.tokens?.refreshToken ?: throw ScException("reconnect", ScApi.RECONNECT_MESSAGE)
            val tokens = api.requestToken(
                v.credentials,
                mapOf("grant_type" to "refresh_token", "refresh_token" to rt, "redirect_uri" to SoundCloudProtocol.REDIRECT_URI),
            )
            save(v.copy(tokens = tokens))
            return tokens
        } catch (e: ScException) {
            if (e.code == "reconnect" || e.code == "invalid_client") {
                // sem repetir em loop: apaga os tokens e espera o usuário reconectar
                save(v.copy(tokens = null))
                setReconnect(true)
                user = null
                lastError = e.message
                refresh()
                throw ScException("reconnect", e.message ?: ScApi.RECONNECT_MESSAGE)
            }
            throw e
        }
    }

    // ------------------------------------------------------------------ API

    internal suspend fun call(method: String, pathOrUrl: String, body: kotlinx.serialization.json.JsonElement? = null): ScResponse {
        load()
        return api.call(method, pathOrUrl, body) { force -> accessToken(force) }
    }

    private suspend fun loadMe() {
        val me = call("GET", SoundCloudProtocol.Paths.ME).json()
        user = ScUser(
            (me["username"] as? JsonPrimitive)?.contentOrNull ?: "?",
            (me["permalink_url"] as? JsonPrimitive)?.contentOrNull,
        )
    }

    companion object {
        const val KEY_VAULT = "sc.vault"
        const val KEY_RECONNECT = "sc.reconnect"
        private val rng = SecureRandom()

        private fun random(bytes: Int): String =
            Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(bytes).also(rng::nextBytes))

        fun mask(id: String) = if (id.length <= 6) "••••" else "${id.take(4)}••••${id.takeLast(2)}"
    }
}
