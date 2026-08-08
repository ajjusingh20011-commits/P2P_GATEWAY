package com.example.paymentbot;

import androidx.room.Dao;
import androidx.room.Delete;
import androidx.room.Insert;
import androidx.room.Query;
import androidx.room.Update;

import java.util.List;

@Dao
public interface QueuedEventDao {

    @Insert
    long insert(QueuedEvent event);

    /** Oldest-first, so delivery preserves capture order where it matters. */
    @Query("SELECT * FROM queued_events ORDER BY createdAt ASC")
    List<QueuedEvent> getAll();

    @Query("SELECT COUNT(*) FROM queued_events")
    int count();

    @Update
    void update(QueuedEvent event);

    @Delete
    void delete(QueuedEvent event);

    /** Safety valve only — see EventUploadWorker for why rows are normally
     *  deleted individually on success/permanent-failure, not by age. Keeps
     *  a stuck row from growing the DB forever if something truly wedges. */
    @Query("DELETE FROM queued_events WHERE createdAt < :cutoffMillis")
    void deleteOlderThan(long cutoffMillis);

    /** Retention cap (log-storage audit, item 1) — drops the oldest rows once
     *  the table exceeds maxRows, same trim-after-insert pattern as
     *  LogStore.trim(). Independent of deleteOlderThan/attempt-count drops
     *  above: those trigger on delivery outcome, this is the hard backstop
     *  for the case delivery never runs at all (server down for days, or the
     *  device stays logged out for an extended period). */
    @Query("DELETE FROM queued_events WHERE id NOT IN "
            + "(SELECT id FROM queued_events ORDER BY id DESC LIMIT :maxRows)")
    void trimToMostRecent(int maxRows);
}
