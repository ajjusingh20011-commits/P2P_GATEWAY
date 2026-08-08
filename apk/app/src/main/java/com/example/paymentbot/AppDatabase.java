package com.example.paymentbot;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

/**
 * Single on-device database backing three independent concerns:
 *   - queued_events   (item 3: offline-first capture -> delivery queue)
 *   - parse_failures  (item 5: unparseable-but-relevant messages, for review)
 *   - crash_reports   (item 4: local, permanent crash history)
 *
 * One database keeps this to a single file/connection rather than three,
 * which is all this app needs — none of these tables are large or related.
 * fallbackToDestructiveMigration() is deliberate: there is no install base
 * with existing rows worth preserving across a schema change yet (all three
 * tables are new in this change), and every row here is either transient
 * (delivered-then-deleted) or safely regenerable — losing a queued/parse/
 * crash table on a future schema bump is an acceptable tradeoff against the
 * complexity of hand-written Room migrations for data that isn't the
 * system of record (the server is).
 */
@Database(
        entities = {QueuedEvent.class, ParseFailure.class, CrashReport.class},
        version = 1,
        exportSchema = true
)
public abstract class AppDatabase extends RoomDatabase {

    public abstract QueuedEventDao queuedEventDao();

    public abstract ParseFailureDao parseFailureDao();

    public abstract CrashReportDao crashReportDao();

    private static volatile AppDatabase instance;

    public static AppDatabase get(Context context) {
        if (instance == null) {
            synchronized (AppDatabase.class) {
                if (instance == null) {
                    instance = Room.databaseBuilder(
                                    context.getApplicationContext(),
                                    AppDatabase.class,
                                    "paymentbot.db")
                            .fallbackToDestructiveMigration()
                            .build();
                }
            }
        }
        return instance;
    }
}
