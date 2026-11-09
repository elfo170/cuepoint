package com.elfo170.cuepoint.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow

/**
 * Banco SQLite (Room) do Android. As entidades sincronizadas ficam numa tabela genérica com o
 * registro completo em JSON (idêntico ao do Chrome) e colunas extraídas para consultas/índices.
 */
@Entity(
    tableName = "entities",
    primaryKeys = ["type", "id"],
    indices = [
        Index("type", "track_id"), Index("type", "research_id"), Index("type", "category_id"),
        Index("type", "playlist_id"), Index("type", "soundcloud_url"),
    ],
)
data class EntityRow(
    val type: String,
    val id: String,
    val json: String,
    val deleted: Boolean,
    val track_id: String?,
    val research_id: String?,
    val category_id: String?,
    val playlist_id: String?,
    val soundcloud_url: String?,
    val updated_at: String,
)

@Entity(tableName = "sync_events", indices = [Index(value = ["origin", "seq"], unique = true), Index("hlc"), Index("status")])
data class SyncEventRow(
    @PrimaryKey val op_id: String,
    val origin: String,
    val seq: Long,
    val hlc: String,
    val entity_type: String,
    val entity_id: String,
    val operation: String,
    val timestamp: String,
    /** local_pending | local_sent | received */
    val status: String,
    /** Operação completa em JSON (formato do protocolo). */
    val json: String,
)

@Entity(tableName = "conflicts")
data class ConflictRow(
    @PrimaryKey val id: String,
    val entity_type: String,
    val entity_id: String,
    val field: String,
    val created_at: String,
)

@Entity(tableName = "meta")
data class MetaRow(@PrimaryKey val key: String, val value: String)

@Entity(tableName = "users")
data class UserRow(@PrimaryKey val id: String, val created_at: String)

@Entity(tableName = "devices")
data class DeviceRow(
    @PrimaryKey val id: String,
    val user_id: String,
    val device_name: String,
    val public_key: String?,
    val pairing_status: String,
    val sync_policy: String,
    val created_at: String,
    val last_sync_at: String?,
    /** Fingerprint (SHA-256 SPKI) do certificado TLS do par, fixado no pareamento. */
    val cert_fp: String? = null,
    /** Endereços IP conhecidos do par (separados por vírgula). */
    val addresses: String? = null,
    val port: Int? = null,
)

@Dao
interface CuePointDao {
    @Query("SELECT * FROM entities WHERE type = :type AND id = :id")
    suspend fun entity(type: String, id: String): EntityRow?

    @Query("SELECT * FROM entities WHERE type = :type")
    suspend fun entities(type: String): List<EntityRow>

    @Query("SELECT * FROM entities")
    fun observeAll(): Flow<List<EntityRow>>

    @Query("SELECT * FROM entities WHERE type = :type AND track_id = :trackId")
    suspend fun byTrack(type: String, trackId: String): List<EntityRow>

    @Query("SELECT * FROM entities WHERE type = :type AND category_id = :categoryId")
    suspend fun byCategory(type: String, categoryId: String): List<EntityRow>

    @Query("SELECT * FROM entities WHERE type = :type AND research_id = :researchId")
    suspend fun byResearch(type: String, researchId: String): List<EntityRow>

    @Query("SELECT * FROM entities WHERE type = :type AND playlist_id = :playlistId")
    suspend fun byPlaylist(type: String, playlistId: String): List<EntityRow>

    @Query("SELECT * FROM entities WHERE type = 'track' AND soundcloud_url = :url")
    suspend fun tracksByUrl(url: String): List<EntityRow>

    @Upsert
    suspend fun upsertEntity(row: EntityRow)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertEvent(row: SyncEventRow)

    @Query("SELECT * FROM sync_events ORDER BY hlc")
    suspend fun events(): List<SyncEventRow>

    @Query("SELECT origin, MAX(seq) AS seq FROM sync_events GROUP BY origin")
    suspend fun versionVector(): List<OriginSeq>

    @Query("SELECT COUNT(*) FROM sync_events")
    fun observeEventCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM sync_events WHERE status = 'local_pending'")
    fun observePendingCount(): Flow<Int>

    @Upsert
    suspend fun upsertConflict(row: ConflictRow)

    @Query("DELETE FROM conflicts WHERE id = :id")
    suspend fun deleteConflict(id: String)

    @Query("SELECT * FROM conflicts")
    fun observeConflicts(): Flow<List<ConflictRow>>

    @Query("SELECT value FROM meta WHERE key = :key")
    suspend fun meta(key: String): String?

    @Query("SELECT value FROM meta WHERE key = :key")
    fun observeMeta(key: String): Flow<String?>

    @Upsert
    suspend fun putMeta(row: MetaRow)

    @Upsert
    suspend fun putUser(row: UserRow)

    @Query("SELECT * FROM users WHERE id = :id")
    suspend fun user(id: String): UserRow?

    @Upsert
    suspend fun putDevice(row: DeviceRow)

    @Query("SELECT * FROM devices WHERE id = :id")
    suspend fun device(id: String): DeviceRow?

    @Query("SELECT * FROM devices WHERE id = :id")
    fun observeDevice(id: String): Flow<DeviceRow?>

    @Query("SELECT * FROM devices WHERE pairing_status != 'self'")
    suspend fun peers(): List<DeviceRow>

    @Query("SELECT * FROM devices WHERE pairing_status != 'self'")
    fun observePeers(): Flow<List<DeviceRow>>

    @Query("SELECT * FROM sync_events WHERE origin = :origin AND status = 'local_pending' ORDER BY seq")
    suspend fun pendingOwn(origin: String): List<SyncEventRow>

    @Query("SELECT COUNT(*) FROM sync_events WHERE origin = :origin AND seq >= :fromSeq")
    suspend fun countOwnFrom(origin: String, fromSeq: Long): Int

    @Query("DELETE FROM sync_events WHERE op_id IN (:ids)")
    suspend fun deleteEvents(ids: List<String>)

    @Query("UPDATE sync_events SET status = 'local_sent' WHERE op_id IN (:ids)")
    suspend fun markSent(ids: List<String>)

    @Query("DELETE FROM entities")
    suspend fun clearEntities()

    @Query("DELETE FROM conflicts")
    suspend fun clearConflicts()

    @Query("SELECT COUNT(*) FROM entities")
    suspend fun entityCount(): Int
}

data class OriginSeq(val origin: String, val seq: Long)

@Database(
    entities = [EntityRow::class, SyncEventRow::class, ConflictRow::class, MetaRow::class, UserRow::class, DeviceRow::class],
    version = 2,
    exportSchema = true,
)
abstract class CuePointDatabase : RoomDatabase() {
    abstract fun dao(): CuePointDao

    companion object {
        fun create(context: Context, inMemory: Boolean = false): CuePointDatabase =
            (if (inMemory) Room.inMemoryDatabaseBuilder(context, CuePointDatabase::class.java)
            else Room.databaseBuilder(context, CuePointDatabase::class.java, "cuepoint.db"))
                .addMigrations(MIGRATION_1_2)
                .build()

        /** v2: dados de rede e certificado dos aparelhos pareados. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE devices ADD COLUMN cert_fp TEXT")
                db.execSQL("ALTER TABLE devices ADD COLUMN addresses TEXT")
                db.execSQL("ALTER TABLE devices ADD COLUMN port INTEGER")
            }
        }
    }
}
