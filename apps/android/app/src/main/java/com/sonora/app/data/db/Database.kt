package com.sonora.app.data.db

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase

/** Last good response per screen, so the app opens with content when the network is gone. */
@Entity(tableName = "cached_json")
data class CachedJson(@PrimaryKey val key: String, val json: String, val updatedAt: Long)

/** Play events not yet accepted by the server (event_id makes resends idempotent). */
@Entity(tableName = "pending_events")
data class PendingEvent(@PrimaryKey val eventId: String, val json: String, val createdAt: Long)

/** The playback queue, restored after the app or the service is killed. Single row (id = 0). */
@Entity(tableName = "queue_state")
data class QueueState(@PrimaryKey val id: Int = 0, val json: String, val index: Int, val positionMs: Long)

@Dao
interface CacheDao {
    @Query("SELECT * FROM cached_json WHERE `key` = :key")
    suspend fun get(key: String): CachedJson?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(item: CachedJson)

    @Query("DELETE FROM cached_json WHERE updatedAt < :before")
    suspend fun prune(before: Long)

    @Query("DELETE FROM cached_json")
    suspend fun clear()
}

@Dao
interface EventDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun add(event: PendingEvent)

    @Query("SELECT * FROM pending_events ORDER BY createdAt LIMIT :limit")
    suspend fun oldest(limit: Int): List<PendingEvent>

    @Query("DELETE FROM pending_events WHERE eventId IN (:ids)")
    suspend fun remove(ids: List<String>)

    @Query("SELECT COUNT(*) FROM pending_events")
    suspend fun count(): Int
}

@Dao
interface QueueDao {
    @Query("SELECT * FROM queue_state WHERE id = 0")
    suspend fun get(): QueueState?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(state: QueueState)

    @Query("DELETE FROM queue_state")
    suspend fun clear()
}

@Database(entities = [CachedJson::class, PendingEvent::class, QueueState::class], version = 1, exportSchema = true)
abstract class SonoraDatabase : RoomDatabase() {
    abstract fun cache(): CacheDao
    abstract fun events(): EventDao
    abstract fun queue(): QueueDao
}
