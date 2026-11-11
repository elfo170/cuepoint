package com.elfo170.cuepoint.backup

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.data.Store
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/**
 * Backup automático: diário (WorkManager) e a cada N alterações (contadas no log de operações),
 * como no Chrome. Desligado nas configurações, nada é agendado.
 */
class BackupScheduler(
    private val context: Context,
    private val manager: BackupManager,
    private val store: Store,
    private val scope: CoroutineScope,
) {
    fun start() {
        scope.launch { apply(manager.settings()) }
        scope.launch {
            store.changes.collect {
                val s = manager.settings()
                if (s.enabled && s.everyChanges > 0 && manager.changesSinceLast() >= s.everyChanges) enqueueNow()
            }
        }
    }

    /** Aplica as configurações: agenda ou cancela o backup diário. */
    fun apply(settings: BackupSettings) {
        runCatching {
            val wm = WorkManager.getInstance(context)
            if (settings.enabled) {
                val daily = PeriodicWorkRequestBuilder<BackupWorker>(24, TimeUnit.HOURS).build()
                wm.enqueueUniquePeriodicWork(DAILY, ExistingPeriodicWorkPolicy.KEEP, daily)
            } else {
                wm.cancelUniqueWork(DAILY)
            }
        }.onFailure { Log.w(TAG, "não foi possível agendar o backup", it) }
    }

    private fun enqueueNow() {
        runCatching {
            WorkManager.getInstance(context)
                .enqueueUniqueWork(BY_CHANGES, ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<BackupWorker>().build())
        }
    }

    companion object {
        const val TAG = "CuePointBackup"
        const val DAILY = "cuepoint-backup-daily"
        const val BY_CHANGES = "cuepoint-backup-changes"
    }
}

class BackupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val manager = applicationContext.container.backups
        if (!manager.settings().enabled) return Result.success()
        return runCatching { manager.runAuto() }.fold(
            onSuccess = { Result.success() },
            onFailure = {
                Log.w(BackupScheduler.TAG, "backup automático falhou", it)
                if (runAttemptCount < 3) Result.retry() else Result.failure()
            },
        )
    }
}
