package com.elfo170.cuepoint.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.elfo170.cuepoint.R
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.core.Protocol
import com.elfo170.cuepoint.media.CurationNotification
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Quando sincronizar (PRD §5.3/§5.4): após alterações (agrupadas), ao abrir o app, ao encontrar
 * o PC na rede (NSD/mDNS) e periodicamente (WorkManager). Pares com política "pedir aprovação"
 * só sincronizam depois de o usuário tocar em "Sincronizar" na notificação (válido por 10 min).
 */
class SyncScheduler(private val context: Context, private val engine: SyncEngine, private val scope: CoroutineScope) {
    private val approvals = ConcurrentHashMap<String, Long>()
    private val mutex = Mutex()
    private var debounce: Job? = null
    private val _lastResult = MutableStateFlow<Map<String, SyncResult>>(emptyMap())
    val lastResult: StateFlow<Map<String, SyncResult>> = _lastResult

    fun onLocalChange() {
        debounce?.cancel()
        debounce = scope.launch {
            delay(3000)
            runCatching { syncAll() }
        }
    }

    fun approve(peerId: String) {
        approvals[peerId] = System.currentTimeMillis() + APPROVAL_TTL_MS
        NotificationManagerCompat.from(context).cancel(peerId.hashCode())
    }

    suspend fun syncAll(force: Boolean = false) = mutex.withLock {
        for (peer in engine.peers().filter { it.pairing_status == "paired" }) {
            if (!force && peer.sync_policy == "ask" && (approvals[peer.id] ?: 0) < System.currentTimeMillis()) {
                askApproval(peer.id, peer.device_name)
                continue
            }
            val r = engine.syncWith(peer.id)
            _lastResult.value = _lastResult.value + (peer.id to r)
        }
    }

    suspend fun syncNow(peerId: String): SyncResult = mutex.withLock {
        approve(peerId)
        engine.syncWith(peerId).also { _lastResult.value = _lastResult.value + (peerId to it) }
    }

    private fun askApproval(peerId: String, name: String) {
        if (!CurationNotification.canPost(context)) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Sincronização", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val approve = PendingIntent.getBroadcast(
            context, peerId.hashCode(),
            Intent(context, SyncApprovalReceiver::class.java).putExtra("peerId", peerId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_cuepoint)
            .setContentTitle("Sincronizar com $name?")
            .setContentText("Há alterações para trocar com este aparelho.")
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .addAction(R.drawable.ic_check, "Sincronizar", approve)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(peerId.hashCode(), n)
        } catch (_: SecurityException) {
        }
    }

    // ------------------------------------------------------------- descoberta (NSD)

    private var discovering = false

    fun startDiscovery() {
        if (discovering) return
        val nsd = context.getSystemService(NsdManager::class.java) ?: return
        discovering = true
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) { Log.i(TAG, "descoberta iniciada: $serviceType") }
            override fun onDiscoveryStopped(serviceType: String) { discovering = false }
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.w(TAG, "descoberta recusada pelo sistema: $serviceType (erro $errorCode)")
                discovering = false
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
            override fun onServiceLost(service: NsdServiceInfo) = Unit
            override fun onServiceFound(service: NsdServiceInfo) {
                Log.i(TAG, "serviço encontrado: ${service.serviceName}")
                @Suppress("DEPRECATION")
                nsd.resolveService(service, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                        Log.w(TAG, "falha ao resolver ${info.serviceName} (erro $errorCode)")
                    }
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        val id = info.attributes["id"]?.toString(Charsets.UTF_8) ?: return
                        // O anúncio traz todos os endereços do PC (inclusive de placas virtuais).
                        val announced = if (Build.VERSION.SDK_INT >= 34) {
                            info.hostAddresses.mapNotNull { it.hostAddress }
                        } else {
                            @Suppress("DEPRECATION")
                            listOfNotNull(info.host?.hostAddress)
                        }
                        val hosts = LanAddresses.preferSameSubnet(announced, LanAddresses.local())
                        Log.i(TAG, "serviço resolvido: ${hosts.joinToString()} (anunciados: ${announced.joinToString()}) porta ${info.port}")
                        if (hosts.isEmpty()) return
                        scope.launch { runCatching { if (engine.seen(id, hosts, info.port)) syncAll() } }
                    }
                })
            }
        }
        runCatching { nsd.discoverServices(Protocol.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener) }
            .onFailure {
                Log.w(TAG, "não foi possível iniciar a descoberta", it)
                discovering = false
            }
    }

    /** Sincronização periódica em segundo plano (mínimo do Android: 15 min, com rede). */
    fun schedulePeriodic() {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        runCatching {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("cuepoint-sync", ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }

    companion object {
        const val CHANNEL = "sync"
        private const val TAG = "CuePointSync"
        const val APPROVAL_TTL_MS = 10 * 60 * 1000L
        @Suppress("unused") private val sdk = Build.VERSION.SDK_INT
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        applicationContext.container.sync.syncAll()
        return Result.success()
    }
}

class SyncApprovalReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val peerId = intent.getStringExtra("peerId") ?: return
        val pending = goAsync()
        val app = context.container
        app.scope.launch {
            try {
                app.sync.syncNow(peerId)
            } finally {
                pending.finish()
            }
        }
    }
}
