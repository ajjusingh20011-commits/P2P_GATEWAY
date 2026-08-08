package com.example.paymentbot;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.Query;

import java.util.List;

@Dao
public interface ParseFailureDao {

    @Insert
    long insert(ParseFailure failure);

    @Query("SELECT * FROM parse_failures ORDER BY createdAt DESC LIMIT 500")
    List<ParseFailure> getRecent();

    @Query("SELECT COUNT(*) FROM parse_failures")
    int count();

    /** Keeps the review log bounded — 90 days of unparsed-format history is
     *  plenty to review from, this isn't a permanent audit trail. */
    @Query("DELETE FROM parse_failures WHERE createdAt < :cutoffMillis")
    void deleteOlderThan(long cutoffMillis);

    /** Retention cap (log-storage audit, item 1) — same trim-after-insert
     *  backstop as QueuedEventDao.trimToMostRecent/LogStore.trim(), for the
     *  case a flood of malformed messages logs failures faster than the
     *  90-day age-based cleanup above would ever catch. */
    @Query("DELETE FROM parse_failures WHERE id NOT IN "
            + "(SELECT id FROM parse_failures ORDER BY id DESC LIMIT :maxRows)")
    void trimToMostRecent(int maxRows);
}
