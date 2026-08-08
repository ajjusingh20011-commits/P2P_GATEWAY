package com.example.paymentbot;

import androidx.room.Entity;
import androidx.room.PrimaryKey;

/**
 * A locally-captured uncaught-exception report, queued for best-effort
 * upload to the server (see CrashHandler + EventUploadWorker) the same way
 * a payment event is — so a crash on a device with no signal is still
 * durable and shows up once connectivity returns, instead of vanishing
 * with the process. Also stays on-device permanently in the Logs export,
 * independent of whether the upload ever succeeds.
 */
@Entity(tableName = "crash_reports")
public class CrashReport {

    @PrimaryKey(autoGenerate = true)
    public long id;

    public String stackTrace;
    public String deviceInfo;
    public long createdAt;

    public CrashReport() {
    }

    public CrashReport(String stackTrace, String deviceInfo) {
        this.stackTrace = stackTrace;
        this.deviceInfo = deviceInfo;
        this.createdAt = System.currentTimeMillis();
    }
}
