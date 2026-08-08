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
    private static final int DB_VERSION = 1;

    private static final String TABLE = "logs";
    private static final String COL_ID = "_id";
    private static final String COL_TIMESTAMP = "timestamp";
    private static final String COL_SOURCE = "source";
    private static final String COL_SENDER = "sender";
    private static final String COL_BODY = "body";
    private static final String COL_CATEGORY = "category";

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
                + COL_CATEGORY + " TEXT)");
        db.execSQL("CREATE INDEX idx_logs_timestamp ON " + TABLE + "(" + COL_TIMESTAMP + ")");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        db.execSQL("DROP TABLE IF EXISTS " + TABLE);
        onCreate(db);
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
                     new String[]{COL_TIMESTAMP, COL_SOURCE, COL_SENDER, COL_BODY, COL_CATEGORY},
                     null, null, null, null,
                     COL_ID + " DESC", String.valueOf(limit))) {
            while (c.moveToNext()) {
                SMSData d = new SMSData(c.getString(2), c.getString(3), c.getLong(0));
                d.source = c.getString(1);
                String category = c.getString(4);
                if (category != null) {
                    d.category = category;
                }
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
