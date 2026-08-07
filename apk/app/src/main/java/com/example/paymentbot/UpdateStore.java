package com.example.paymentbot;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Small durable record of auto-update state — separate SharedPreferences
 * file from RegistrationManager's "paymentbot" one, same reasoning as
 * ListenerHealthStore: this is runtime feature state, not pairing identity.
 *
 * Tracks the versionCode of whatever APK is currently sitting downloaded
 * on disk (if any), so UpdateCheckWorker's daily/on-open checks don't
 * re-download the same available update over and over before the user
 * gets around to tapping the install notification.
 */
final class UpdateStore {

    private static final String PREFS = "update_state";
    private static final String KEY_DOWNLOADED_VERSION_CODE = "downloaded_version_code";
    private static final String KEY_DOWNLOADED_FILE_PATH = "downloaded_file_path";

    static void setDownloaded(Context ctx, int versionCode, String filePath) {
        prefs(ctx).edit()
                .putInt(KEY_DOWNLOADED_VERSION_CODE, versionCode)
                .putString(KEY_DOWNLOADED_FILE_PATH, filePath)
                .apply();
    }

    /** 0 if nothing has been downloaded yet (real versionCodes start at 1). */
    static int getDownloadedVersionCode(Context ctx) {
        return prefs(ctx).getInt(KEY_DOWNLOADED_VERSION_CODE, 0);
    }

    static String getDownloadedFilePath(Context ctx) {
        return prefs(ctx).getString(KEY_DOWNLOADED_FILE_PATH, "");
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private UpdateStore() {
    }
}
