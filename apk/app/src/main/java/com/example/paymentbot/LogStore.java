package com.example.paymentbot;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/**
 * On-device persistence for the Logs tab's capture feed. Previously
 * {@code MainActivity.allMessages} was an in-memory-only static ArrayList —
 * every capture was lost the instant the process died (OS memory pressure,
 * force-stop, crash), which for a background-service-driven app is routine,
 * not rare. This backs the same feed with real SQLite storage so history
 * survives process death and stays exportable (shareLogs() / .txt export)
 * even if the phone has no connectivity at all — everything here is written
 * locally, independent of whether the server POST in NotificationService/
 * SMSReceiver ever succeeded.
 */
final class LogStore extends SQLiteOpenHelper {

    private static final String TAG = "PaymentBot";
    private static final String DB_NAME = "paymentbot_logs.db";
    // 2: added the source app columns below. Without them a capture lost its
    // app identity the moment the process died — the feed would show the real
    // icon and name while the app stayed open, then fall back to the generic
    // badge for the same rows after a restart, which is worse than being
    // consistently generic.
    private static final int DB_VERSION = 2;

    private static final String TABLE = "logs";
    private static final String COL_ID = "_id";
    private static final String COL_TIMESTAMP = "timestamp";
    private static final String COL_SOURCE = "source";
    private static final String COL_SENDER = "sender";
    private static final String COL_BODY = "body";
    private static final String COL_CATEGORY = "category";
    // The real Android package the notification came from, its resolved app
    // name, and the action labels it carried — see SMSData.
    private static final String COL_PACKAGE = "package_name";
    private static final String COL_APP_NAME = "app_name";
    private static final String COL_ACTIONS = "actions";
    /**
     * Action labels are few and short, so a delimited column beats a second
     * table. Unit Separator rather than a comma or pipe: a real action label
     * ("Pay & settings", "All payments") can contain either of those.
     */
    private static final String ACTIONS_SEPARATOR = "\u001F";

    // Retention cap on the persisted table — generous relative to the
    // in-memory feed's 200-row rolling window (MainActivity.MAX_ENTRIES),
    // since the whole point of this store is to hold more history than the
    // live feed does, while still not growing the on-device DB unbounded.
    private static final int MAX_ROWS = 5000;

    private static LogStore instance;

    static synchronized LogStore get(Context ctx) {
        if (instance == null) {
            instance = new LogStore(ctx.getApplicationContext());
        }
        return instance;
    }

    private LogStore(Context ctx) {
        super(ctx, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE " + TABLE + " ("
                + COL_ID + " INTEGER PRIMARY KEY AUTOINCREMENT, "
                + COL_TIMESTAMP + " INTEGER NOT NULL, "
                + COL_SOURCE + " TEXT, "
                + COL_SENDER + " TEXT, "
                + COL_BODY + " TEXT, "
                + COL_CATEGORY + " TEXT, "
                + COL_PACKAGE + " TEXT, "
                + COL_APP_NAME + " TEXT, "
                + COL_ACTIONS + " TEXT)");
        db.execSQL("CREATE INDEX idx_logs_timestamp ON " + TABLE + "(" + COL_TIMESTAMP + ")");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Additive migration rather than the previous drop-and-recreate: this
        // table is the trader's own capture history and the only local record
        // that a payment was ever seen, so an app update must not wipe it just
        // to add three columns. Older rows simply have them null, and the feed
        // falls back to the generic badge for those.
        if (oldVersion < 2) {
            try {
                db.execSQL("ALTER TABLE " + TABLE + " ADD COLUMN " + COL_PACKAGE + " TEXT");
                db.execSQL("ALTER TABLE " + TABLE + " ADD COLUMN " + COL_APP_NAME + " TEXT");
                db.execSQL("ALTER TABLE " + TABLE + " ADD COLUMN " + COL_ACTIONS + " TEXT");
            } catch (Exception e) {
                // A partially-applied upgrade would otherwise leave the store
                // unusable; recreating loses history, but only as a last
                // resort rather than as the routine path.
                Log.e(TAG, "LogStore upgrade to v2 failed, recreating: " + e.getMessage());
                db.execSQL("DROP TABLE IF EXISTS " + TABLE);
                onCreate(db);
            }
        }
    }

    /** Synchronous write — call from a background thread, never the UI thread. */
    void insert(SMSData data) {
        if (data == null) return;
        try {
            SQLiteDatabase db = getWritableDatabase();
            ContentValues values = new ContentValues();
            values.put(COL_TIMESTAMP, data.timestamp);
            values.put(COL_SOURCE, data.source);
            values.put(COL_SENDER, data.sender);
            values.put(COL_BODY, data.body);
            values.put(COL_CATEGORY, data.category);
            values.put(COL_PACKAGE, data.packageName);
            values.put(COL_APP_NAME, data.appName);
            values.put(COL_ACTIONS, data.actions == null || data.actions.length == 0
                    ? null : android.text.TextUtils.join(ACTIONS_SEPARATOR, data.actions));
            db.insert(TABLE, null, values);
            trim(db);
        } catch (Exception e) {
            Log.e(TAG, "LogStore.insert failed: " + e.getMessage());
        }
    }

    /** Drops the oldest rows once the table exceeds MAX_ROWS. */
    private void trim(SQLiteDatabase db) {
        try {
            db.execSQL("DELETE FROM " + TABLE + " WHERE " + COL_ID + " NOT IN ("
                    + "SELECT " + COL_ID + " FROM " + TABLE
                    + " ORDER BY " + COL_ID + " DESC LIMIT " + MAX_ROWS + ")");
        } catch (Exception e) {
            Log.e(TAG, "LogStore.trim failed: " + e.getMessage());
        }
    }

    /** Loads up to {@code limit} most recent entries, newest first. */
    List<SMSData> loadRecent(int limit) {
        List<SMSData> out = new ArrayList<>();
        try (SQLiteDatabase db = getReadableDatabase();
             Cursor c = db.query(TABLE,
                     new String[]{COL_TIMESTAMP, COL_SOURCE, COL_SENDER, COL_BODY, COL_CATEGORY,
                             COL_PACKAGE, COL_APP_NAME, COL_ACTIONS},
                     null, null, null, null,
                     COL_ID + " DESC", String.valueOf(limit))) {
            while (c.moveToNext()) {
                SMSData d = new SMSData(c.getString(2), c.getString(3), c.getLong(0));
                d.source = c.getString(1);
                String category = c.getString(4);
                if (category != null) {
                    d.category = category;
                }
                d.packageName = c.getString(5);
                d.appName = c.getString(6);
                String actions = c.getString(7);
                d.actions = actions == null || actions.isEmpty()
                        ? null : actions.split(ACTIONS_SEPARATOR);
                out.add(d);
            }
        } catch (Exception e) {
            Log.e(TAG, "LogStore.loadRecent failed: " + e.getMessage());
        }
        return out;
    }

    /** Loads every persisted row, newest first — used for full export. */
    List<SMSData> loadAll() {
        return loadRecent(MAX_ROWS);
    }

    /** Wipes the entire persisted history — backs the Logs tab's clear/trash
     *  action. Call from a background thread, never the UI thread. */
    void clearAll() {
        try {
            getWritableDatabase().delete(TABLE, null, null);
        } catch (Exception e) {
            Log.e(TAG, "LogStore.clearAll failed: " + e.getMessage());
        }
    }
}
