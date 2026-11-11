package com.elfo170.cuepoint.backup

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.elfo170.cuepoint.core.BackupFile
import com.elfo170.cuepoint.core.Backups
import com.elfo170.cuepoint.core.Hlc
import com.elfo170.cuepoint.core.Merge
import com.elfo170.cuepoint.data.Store
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Serializable
data class BackupSettings(
    /** Backup automático diário (WorkManager). */
    val enabled: Boolean = true,
    /** Faz backup também a cada N alterações (0 = desligado). Mesmo padrão do Chrome. */
    val everyChanges: Int = 100,
)

@Serializable
data class BackupRecord(
    val at: String,
    val filename: String,
    val ops: Int,
    val sha256: String,
    val bytes: Int,
    /** auto | manual | pre-restore */
    val reason: String,
    /** Onde foi gravado (nome da pasta escolhida ou "armazenamento do app"). */
    val destination: String,
)

/** Onde os arquivos de backup são gravados. */
interface BackupDestination {
    val label: String
    suspend fun write(filename: String, bytes: ByteArray)
}

/** Pasta própria do app no armazenamento externo (Android/data/…/files/backups). Apagada se o app for desinstalado. */
class DirectoryDestination(private val dir: File, override val label: String = "armazenamento do app") : BackupDestination {
    override suspend fun write(filename: String, bytes: ByteArray) = withContext(Dispatchers.IO) {
        dir.mkdirs()
        val target = File(dir, filename)
        check(!target.exists()) { "já existe um backup chamado $filename" }
        val tmp = File(dir, "$filename.partial")
        tmp.writeBytes(bytes)
        check(tmp.renameTo(target)) { "não foi possível gravar $filename" }
    }
}

/** Pasta escolhida pelo usuário (SAF). Sobrevive à desinstalação do app. */
class TreeDestination(private val context: Context, private val tree: Uri) : BackupDestination {
    override val label: String =
        DocumentsContract.getTreeDocumentId(tree).substringAfter(':').ifBlank { "pasta escolhida" }

    override suspend fun write(filename: String, bytes: ByteArray) = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        // grava com nome provisório e renomeia no fim: um arquivo pela metade nunca tem o nome final
        val doc = DocumentsContract.createDocument(resolver, parent, "application/octet-stream", "$filename.partial")
            ?: error("A pasta de backup não está acessível. Escolha a pasta de novo.")
        try {
            resolver.openOutputStream(doc, "w")!!.use { it.write(bytes) }
            DocumentsContract.renameDocument(resolver, doc, filename) ?: error("não foi possível renomear $filename")
        } catch (e: Exception) {
            runCatching { DocumentsContract.deleteDocument(resolver, doc) }
            throw e
        }
        Unit
    }
}

/**
 * Backups do celular no formato comum `cuepoint-backup` v1 (o mesmo do Chrome). Backups antigos
 * nunca são apagados. A restauração valida tudo antes, faz um backup de segurança e substitui a
 * biblioteca numa única transação.
 */
class BackupManager(
    private val context: Context,
    private val store: Store,
    private val now: () -> Long = System::currentTimeMillis,
    private val destinationOverride: BackupDestination? = null,
) {
    private val mutex = Mutex()
    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running

    suspend fun settings(): BackupSettings =
        store.getMeta(KEY_SETTINGS)?.let { runCatching { Merge.json.decodeFromString<BackupSettings>(it) }.getOrNull() } ?: BackupSettings()

    suspend fun saveSettings(value: BackupSettings) = store.setMeta(KEY_SETTINGS, Merge.json.encodeToString(value))

    suspend fun history(): List<BackupRecord> =
        store.getMeta(KEY_HISTORY)?.let { runCatching { Merge.json.decodeFromString<List<BackupRecord>>(it) }.getOrNull() }.orEmpty()

    suspend fun treeUri(): Uri? = store.getMeta(KEY_TREE)?.takeIf { it.isNotEmpty() }?.let(Uri::parse)

    /** Guarda a pasta escolhida no seletor do sistema (com permissão persistente). */
    suspend fun setTree(uri: Uri?) {
        val previous = treeUri()
        if (uri != null) {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        if (previous != null && previous != uri) {
            runCatching { context.contentResolver.releasePersistableUriPermission(previous, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
        }
        store.setMeta(KEY_TREE, uri?.toString() ?: "")
    }

    /** A pasta escolhida continua acessível? (o usuário pode revogar ou apagar a pasta). */
    suspend fun treeAccessible(): Boolean {
        val tree = treeUri() ?: return false
        return context.contentResolver.persistedUriPermissions.any { it.uri == tree && it.isWritePermission }
    }

    suspend fun destination(): BackupDestination {
        destinationOverride?.let { return it }
        val tree = treeUri()
        if (tree != null && treeAccessible()) return TreeDestination(context, tree)
        return DirectoryDestination(File(context.getExternalFilesDir(null) ?: context.filesDir, "backups"))
    }

    /** Operações registradas desde o último backup. */
    suspend fun changesSinceLast(): Int {
        val last = store.getMeta(KEY_LAST_OPS)?.toIntOrNull() ?: 0
        return store.db.dao().eventCount() - last
    }

    /** Backup automático: só grava se houve alteração desde o último. */
    suspend fun runAuto(): BackupRecord? = if (changesSinceLast() != 0 || history().isEmpty()) run("auto") else null

    suspend fun run(reason: String): BackupRecord = mutex.withLock {
        _running.value = true
        try {
            val backup = store.exportBackup()
            val bytes = Backups.encode(backup).toByteArray(Charsets.UTF_8)
            val at = now()
            // nunca sobrescreve um backup anterior (dois no mesmo segundo ganham sufixo)
            val used = history().map { it.filename }.toSet()
            val base = filename(at, reason)
            val filename = generateSequence(2) { it + 1 }.map { base.removeSuffix(".json") + "-$it.json" }
                .let { sequenceOf(base) + it }.first { it !in used }
            val dest = destination()
            dest.write(filename, bytes)
            val record = BackupRecord(
                at = Hlc.isoOf(at),
                filename = filename,
                ops = backup.getValue("counts").jsonObject.getValue("ops").jsonPrimitive.int,
                sha256 = backup.getValue("sha256").jsonPrimitive.content,
                bytes = bytes.size,
                reason = reason,
                destination = dest.label,
            )
            store.setMeta(KEY_HISTORY, Merge.json.encodeToString(listOf(record) + history().take(199)))
            store.setMeta(KEY_LAST_OPS, record.ops.toString())
            store.setMeta(KEY_LAST_AT, record.at)
            record
        } finally {
            _running.value = false
        }
    }

    /** Lê e valida um arquivo de backup (do Chrome ou do celular) sem mexer em nada. */
    suspend fun read(uri: Uri): BackupFile = withContext(Dispatchers.IO) {
        val text = context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
            ?: error("Não foi possível abrir o arquivo.")
        Backups.parse(text)
    }

    /** Restaura um backup validado: backup de segurança antes, depois substituição em uma transação. */
    suspend fun restore(backup: BackupFile): BackupRecord {
        val safety = run("pre-restore")
        store.restore(backup)
        // o próximo backup automático compara com o conteúdo restaurado
        store.setMeta(KEY_LAST_OPS, backup.ops.size.toString())
        return safety
    }

    companion object {
        const val KEY_SETTINGS = "backup.settings"
        const val KEY_HISTORY = "backup.history"
        const val KEY_TREE = "backup.treeUri"
        const val KEY_LAST_OPS = "backup.lastOps"
        const val KEY_LAST_AT = "backup.lastAt"

        /** Mesmo nome do Chrome: `cuepoint-backup-AAAAMMDD-HHMMSS.json` (o de segurança ganha um sufixo). */
        fun filename(at: Long, reason: String = "auto"): String {
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(at))
            val suffix = if (reason == "pre-restore") "-antes-de-restaurar" else ""
            return "cuepoint-backup-$stamp$suffix.json"
        }
    }
}
