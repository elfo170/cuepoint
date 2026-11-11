package com.elfo170.cuepoint.sync

import com.elfo170.cuepoint.core.Hlc
import com.elfo170.cuepoint.core.Merge
import com.elfo170.cuepoint.core.Op
import com.elfo170.cuepoint.core.Protocol
import com.elfo170.cuepoint.data.DeviceRow
import com.elfo170.cuepoint.data.Store
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.boolean
import java.security.PrivateKey

@Serializable
private data class StoredKeys(val privateKey: String, val publicKey: String)

@Serializable
data class SyncRun(val peerId: String, val at: String, val status: String, val received: Int, val sent: Int, val error: String? = null)

data class SyncResult(val status: String, val received: Int = 0, val sent: Int = 0, val error: String? = null)

/**
 * Pareamento e sincronização com o serviço do PC (PRD §4.4, §5). O celular atua como cliente:
 * busca o que falta (pull) e envia o que o PC não tem (push), em lotes, de forma idempotente.
 */
class SyncEngine(
    private val store: Store,
    private val clientFactory: (host: String, port: Int, certFp: String, deviceId: String, key: PrivateKey) -> PeerClient = ::PeerClient,
    /** Chamado depois de receber operações (ex.: associar faixas provisórias às definitivas). */
    private val afterReceive: suspend () -> Unit = {},
) {
    private val dao = store.db.dao()

    /** Alterações daqui que o par ainda não tem (null: ainda não houve troca com ele). */
    suspend fun pendingFor(peerId: String): Int? = store.knownBy(peerId)?.let { store.pendingFor(it) }

    /** Última execução registrada com o par (sucesso, erro ou aguardando aprovação). */
    suspend fun lastRun(peerId: String): SyncRun? = runs().firstOrNull { it.peerId == peerId }

    /** Chaves de assinatura do aparelho (geradas na primeira vez). */
    suspend fun keys(): Pair<PrivateKey, String> {
        val saved = store.getMeta("keys")?.let { Merge.json.decodeFromString<StoredKeys>(it) }
        if (saved != null) return Protocol.privateKeyOf(saved.privateKey) to saved.publicKey
        val kp = Protocol.generateKeyPair()
        val stored = StoredKeys(Protocol.privateKeyB64(kp.private), Protocol.publicKeyB64(kp.public))
        store.setMeta("keys", Merge.json.encodeToString(stored))
        return kp.private to stored.publicKey
    }

    data class PairingResult(val peerId: String, val name: String, val code: String)

    /** Usa o código/QR do PC: apresenta-se com o token e registra o PC como pareado. */
    suspend fun pair(uri: String): PairingResult {
        val p = Protocol.parsePairingUri(uri)
        val id = store.init()
        val (key, publicKey) = keys()
        val body = Merge.json.encodeToString(
            JsonObject.serializer(),
            JsonObject(
                mapOf(
                    "token" to kotlinx.serialization.json.JsonPrimitive(p.token),
                    "device_id" to kotlinx.serialization.json.JsonPrimitive(id.deviceId),
                    "name" to kotlinx.serialization.json.JsonPrimitive(id.deviceName),
                    "public_key" to kotlinx.serialization.json.JsonPrimitive(publicKey),
                ),
            ),
        )
        var last: Exception? = null
        for (host in p.addresses) {
            try {
                val res = Merge.parseObject(clientFactory(host, p.port, p.certFp, id.deviceId, key).post("/v1/pair", body, signed = false))
                require(res.getValue("device_id").jsonPrimitive.content == p.deviceId) { "aparelho inesperado" }
                store.adoptUserIfEmpty(res.getValue("user_id").jsonPrimitive.content)
                dao.putDevice(
                    DeviceRow(
                        id = p.deviceId, user_id = store.init().userId, device_name = p.name, public_key = p.publicKey,
                        pairing_status = "paired", sync_policy = "auto", created_at = Hlc.isoOf(System.currentTimeMillis()),
                        last_sync_at = null, cert_fp = p.certFp, addresses = p.addresses.joinToString(","), port = p.port,
                    ),
                )
                return PairingResult(p.deviceId, p.name, res.getValue("sas").jsonPrimitive.content)
            } catch (e: PeerHttpException) {
                throw IllegalStateException(if (e.code == "invalid_token") "Código expirado ou já usado. Gere um novo no PC." else e.code)
            } catch (e: Exception) {
                last = e
            }
        }
        throw IllegalStateException("Não foi possível falar com o PC: ${last?.message ?: "sem endereço"}")
    }

    suspend fun peers(): List<DeviceRow> = dao.peers()

    /** Sincroniza com um aparelho pareado. */
    suspend fun syncWith(peerId: String): SyncResult {
        val peer = dao.device(peerId) ?: return SyncResult("skipped")
        if (peer.pairing_status != "paired" || peer.cert_fp == null || peer.port == null) return SyncResult("skipped")
        val id = store.init()
        val (key, _) = keys()
        var received = 0
        var sent = 0
        var lastError: Exception? = null
        for (host in peer.addresses.orEmpty().split(',').filter { it.isNotBlank() }) {
            val client = clientFactory(host, peer.port, peer.cert_fp, id.deviceId, key)
            try {
                store.compactPending()
                var remoteVv: Map<String, Long>
                while (true) {
                    val vv = Merge.json.encodeToString(store.versionVector())
                    val page = Merge.parseObject(client.post("/v1/sync/pull", """{"vv":$vv,"limit":${Protocol.PULL_LIMIT}}"""))
                    val ops = page.getValue("ops").jsonArray.map { Merge.json.decodeFromJsonElement<Op>(it) }
                    received += store.receive(ops)
                    remoteVv = page.getValue("vv").jsonObject.mapValues { (_, v) -> v.jsonPrimitive.long }
                    if (!page.getValue("more").jsonPrimitive.boolean || ops.isEmpty()) break
                }
                // antes do envio, para que as associações feitas agora já sigam nesta mesma troca
                if (received > 0) afterReceive()
                val outgoing = store.opsSince(remoteVv)
                for (batch in outgoing.chunked(Protocol.PULL_LIMIT)) {
                    val body = """{"ops":${Merge.json.encodeToString(batch)}}"""
                    client.post("/v1/sync/push", body)
                    store.markSent(batch)
                    sent += batch.size
                }
                // depois do pull + push, o PC tem o que tinha mais tudo o que foi enviado
                store.noteKnown(peerId, remoteVv)
                store.noteKnown(peerId, outgoing.groupBy { it.origin }.mapValues { (_, o) -> o.maxOf { it.seq } })
                val now = Hlc.isoOf(System.currentTimeMillis())
                dao.putDevice(peer.copy(last_sync_at = now))
                record(SyncRun(peerId, now, "ok", received, sent))
                return SyncResult("ok", received, sent)
            } catch (e: PeerHttpException) {
                val status = when (e.code) {
                    "approval_required" -> "approval_required"
                    "pending_confirmation" -> "pending_confirmation"
                    "revoked" -> "revoked"
                    else -> "error"
                }
                if (status == "revoked") dao.putDevice(peer.copy(pairing_status = "revoked"))
                record(SyncRun(peerId, Hlc.isoOf(System.currentTimeMillis()), status, received, sent, e.code))
                return SyncResult(status, received, sent, e.code)
            } catch (e: Exception) {
                lastError = e
            }
        }
        val msg = lastError?.message ?: "sem endereço"
        record(SyncRun(peerId, Hlc.isoOf(System.currentTimeMillis()), "error", received, sent, msg))
        return SyncResult("error", received, sent, msg)
    }

    /** Remove a confiança no PC (PRD §4.5) e avisa, se alcançável. */
    suspend fun revoke(peerId: String) {
        val peer = dao.device(peerId) ?: return
        dao.putDevice(peer.copy(pairing_status = "revoked"))
        val id = store.init()
        val (key, _) = keys()
        for (host in peer.addresses.orEmpty().split(',').filter { it.isNotBlank() }) {
            val cert = peer.cert_fp ?: break
            val port = peer.port ?: break
            if (runCatching { clientFactory(host, port, cert, id.deviceId, key).post("/v1/revoke", "{}") }.isSuccess) break
        }
    }

    suspend fun setPolicy(peerId: String, policy: String) {
        dao.device(peerId)?.let { dao.putDevice(it.copy(sync_policy = policy)) }
    }

    /**
     * Atualiza endereços/porta de um par encontrado na rede (NSD). [hosts] vêm na ordem de
     * preferência (mesma sub-rede primeiro) e passam à frente dos endereços já conhecidos.
     */
    suspend fun seen(peerId: String, hosts: List<String>, port: Int): Boolean {
        val peer = dao.device(peerId) ?: return false
        if (peer.pairing_status != "paired") return false
        val addresses = (hosts + peer.addresses.orEmpty().split(',')).filter { it.isNotBlank() }.distinct().take(4)
        dao.putDevice(peer.copy(addresses = addresses.joinToString(","), port = port))
        return true
    }

    suspend fun runs(): List<SyncRun> =
        store.getMeta("sync.runs")?.let { Merge.json.decodeFromString<List<SyncRun>>(it) } ?: emptyList()

    private suspend fun record(run: SyncRun) {
        store.setMeta("sync.runs", Merge.json.encodeToString((listOf(run) + runs()).take(50)))
    }
}
