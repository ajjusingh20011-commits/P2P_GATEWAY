package com.example.paymentbot;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Floating screenshot button that appears while a banking / UPI app is open.
 * Tapping it captures the screen via {@link MediaProjection} and uploads a
 * JPEG (Base64) to the backend, which relays it to the NGO dashboard over the
 * active socket room.
 *
 * <p>The floating button is draggable; the passive capture flow requires the
 * SYSTEM_ALERT_WINDOW permission plus a one-time MediaProjection consent that
 * {@link MainActivity} obtains.
 */
public class OverlayService extends Service {

    private static final String TAG = "PaymentBot";
    private static final String CHANNEL_ID = "PaymentBotCapture";
    private static final int FGS_ID = 4200;

    private static OverlayService instance;
    private WindowManager windowManager;
    private View floatingBtn;
    private View feedbackView;
    private boolean isVisible = false;
    private boolean foregroundStarted = false;

    // Manual input recording — captures the fields the NGO types while filling a
    // payment form (never screen-reads or records video).
    private boolean isRecording = false;
    private String recordedAccount = "";
    private String recordedIFSC = "";
    private String recordedName = "";
    private String recordedAmount = "";
    private View recordBtn;
    private View recordingPanel;

    private static MediaProjection mediaProjection;
    private static int screenWidth;
    private static int screenHeight;
    private static int screenDensity;

    public static OverlayService getInstance() {
        return instance;
    }

    public static boolean hasProjection() {
        return mediaProjection != null;
    }

    public static void setMediaProjection(MediaProjection mp, int w, int h, int d) {
        mediaProjection = mp;
        screenWidth = w;
        screenHeight = h;
        screenDensity = d;
    }

    /** True while the manual input recorder is active. */
    public static boolean isRecording() {
        return instance != null && instance.isRecording;
    }

    /**
     * Called by {@link PaymentBotService} when it detects the user typed (or
     * pasted) a recognizable payment field while recording is active.
     */
    public static void onFieldCaptured(String fieldType, String value) {
        if (instance == null || !instance.isRecording) {
            return;
        }
        switch (fieldType) {
            case "ACCOUNT":
                instance.recordedAccount = value;
                instance.updateRecordingPanel();
                break;
            case "IFSC":
                instance.recordedIFSC = value;
                instance.updateRecordingPanel();
                break;
            case "NAME":
                instance.recordedName = value;
                instance.updateRecordingPanel();
                break;
            case "AMOUNT":
                instance.recordedAmount = value;
                instance.updateRecordingPanel();
                break;
            default:
                break;
        }
        Log.d(TAG, "Recorded " + fieldType + ": " + value);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        Log.d(TAG, "OverlayService started");
    }

    // ---------------------------------------------------------------------
    // Floating button
    // ---------------------------------------------------------------------
    public void showFloatingButton() {
        if (floatingBtn != null || windowManager == null
                || !android.provider.Settings.canDrawOverlays(this)) {
            return;
        }

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(0xCC000000);
        panel.setPadding(dp(4), dp(4), dp(4), dp(4));

        // RECORD button (toggles input recording).
        TextView record = new TextView(this);
        record.setText("⏺ RECORD");
        record.setTextColor(0xFFFFFFFF);
        record.setTextSize(12);
        record.setGravity(Gravity.CENTER);
        record.setBackgroundColor(0xFF333333);
        LinearLayout.LayoutParams recLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(44));
        recLp.bottomMargin = dp(4);
        record.setLayoutParams(recLp);
        recordBtn = record;

        // SCREENSHOT button.
        TextView shot = new TextView(this);
        shot.setText("📷 SCREENSHOT");
        shot.setTextColor(0xFFFFFFFF);
        shot.setTextSize(12);
        shot.setGravity(Gravity.CENTER);
        shot.setBackgroundColor(0xFF0066CC);
        shot.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(44)));

        panel.addView(record);
        panel.addView(shot);

        floatingBtn = panel;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                dp(150),
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.END;
        params.x = 8;
        params.y = 200;

        // Draggable window; each button taps its own action.
        record.setOnTouchListener(new DraggableTouchListener(
                params, windowManager, panel, this::toggleRecording));
        shot.setOnTouchListener(new DraggableTouchListener(
                params, windowManager, panel, this::takeScreenshotAndUpload));

        try {
            windowManager.addView(floatingBtn, params);
            isVisible = true;
            Log.d(TAG, "Floating buttons shown");
        } catch (Exception e) {
            Log.e(TAG, "Error showing buttons: " + e.getMessage());
            floatingBtn = null;
        }
    }

    public void hideFloatingButton() {
        if (floatingBtn != null && windowManager != null) {
            try {
                windowManager.removeView(floatingBtn);
            } catch (Exception ignored) {
            }
            floatingBtn = null;
            isVisible = false;
        }
        // Stop any active recording along with the buttons.
        isRecording = false;
        hideRecordingPanel();
    }

    // ---------------------------------------------------------------------
    // Input recording
    // ---------------------------------------------------------------------
    private void toggleRecording() {
        if (!isRecording) {
            isRecording = true;
            recordedAccount = "";
            recordedIFSC = "";
            recordedName = "";
            recordedAmount = "";
            updateRecordBtn("🔴 Recording...", 0xFFFF4444);
            showRecordingPanel();
        } else {
            isRecording = false;
            updateRecordBtn("⏺ RECORD", 0xFF333333);
            hideRecordingPanel();
        }
    }

    private void updateRecordBtn(String text, int color) {
        if (!(recordBtn instanceof TextView)) {
            return;
        }
        new Handler(Looper.getMainLooper()).post(() -> {
            ((TextView) recordBtn).setText(text);
            recordBtn.setBackgroundColor(color);
        });
    }

    private void showRecordingPanel() {
        if (recordingPanel != null || windowManager == null) {
            return;
        }

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(0xEE000000);
        panel.setPadding(12, 8, 12, 8);
        panel.setTag("recording_panel");

        TextView title = new TextView(this);
        title.setText("🔴 Capturing inputs...");
        title.setTextColor(0xFFFF4444);
        title.setTextSize(11);
        panel.addView(title);

        panel.addView(fieldLine("acct_text", "Account: -"));
        panel.addView(fieldLine("ifsc_text", "IFSC: -"));
        panel.addView(fieldLine("name_text", "Name: -"));
        panel.addView(fieldLine("amount_text", "Amount: -"));

        recordingPanel = panel;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                dp(150),
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.END;
        params.x = 8;
        params.y = 330;

        try {
            windowManager.addView(recordingPanel, params);
        } catch (Exception e) {
            Log.e(TAG, "Recording panel error: " + e.getMessage());
            recordingPanel = null;
        }
    }

    private TextView fieldLine(String tag, String text) {
        TextView tv = new TextView(this);
        tv.setTag(tag);
        tv.setText(text);
        tv.setTextColor(0xFF888888);
        tv.setTextSize(10);
        return tv;
    }

    private void updateRecordingPanel() {
        if (recordingPanel == null) {
            return;
        }
        new Handler(Looper.getMainLooper()).post(() -> {
            updateField("acct_text", "Account: " + (recordedAccount.isEmpty()
                    ? "-" : "..." + recordedAccount.substring(
                            Math.max(0, recordedAccount.length() - 4))));
            updateField("ifsc_text", "IFSC: " + (recordedIFSC.isEmpty() ? "-" : recordedIFSC));
            updateField("name_text", "Name: " + (recordedName.isEmpty() ? "-" : recordedName));
            updateField("amount_text", "Amount: " + (recordedAmount.isEmpty() ? "-" : "₹" + recordedAmount));
        });
    }

    private void updateField(String tag, String text) {
        if (!(recordingPanel instanceof LinearLayout)) {
            return;
        }
        LinearLayout panel = (LinearLayout) recordingPanel;
        for (int i = 0; i < panel.getChildCount(); i++) {
            View child = panel.getChildAt(i);
            if (tag.equals(child.getTag()) && child instanceof TextView) {
                ((TextView) child).setText(text);
                ((TextView) child).setTextColor(0xFFFFFFFF);
                break;
            }
        }
    }

    private void hideRecordingPanel() {
        if (recordingPanel != null && windowManager != null) {
            try {
                windowManager.removeView(recordingPanel);
            } catch (Exception ignored) {
            }
            recordingPanel = null;
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    public boolean isVisible() {
        return isVisible;
    }

    // ---------------------------------------------------------------------
    // Screenshot capture
    // ---------------------------------------------------------------------
    private void takeScreenshotAndUpload() {
        Log.d(TAG, "Taking screenshot...");
        showFeedback("Capturing...");

        if (mediaProjection == null) {
            Log.e(TAG, "No media projection!");
            showFeedback("Enable screenshot permission");
            return;
        }

        // MediaProjection capture requires an active foreground service (of type
        // mediaProjection) on Android 10+.
        ensureForeground();

        new Thread(() -> {
            ImageReader imageReader = null;
            VirtualDisplay virtualDisplay = null;
            try {
                imageReader = ImageReader.newInstance(
                        screenWidth, screenHeight, PixelFormat.RGBA_8888, 2);

                // Android 14+ requires a registered callback before capture.
                try {
                    mediaProjection.registerCallback(new MediaProjection.Callback() {
                    }, new Handler(Looper.getMainLooper()));
                } catch (Exception ignored) {
                }

                virtualDisplay = mediaProjection.createVirtualDisplay(
                        "screenshot",
                        screenWidth, screenHeight, screenDensity,
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                        imageReader.getSurface(),
                        null, null);

                Thread.sleep(300);

                Image image = imageReader.acquireLatestImage();
                if (image != null) {
                    Image.Plane[] planes = image.getPlanes();
                    ByteBuffer buffer = planes[0].getBuffer();
                    int pixelStride = planes[0].getPixelStride();
                    int rowStride = planes[0].getRowStride();
                    int rowPadding = rowStride - pixelStride * screenWidth;

                    Bitmap bitmap = Bitmap.createBitmap(
                            screenWidth + rowPadding / pixelStride,
                            screenHeight,
                            Bitmap.Config.ARGB_8888);
                    bitmap.copyPixelsFromBuffer(buffer);
                    image.close();

                    // Crop off the row padding so the JPEG is exactly screen width.
                    if (rowPadding != 0) {
                        Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, screenWidth, screenHeight);
                        bitmap.recycle();
                        bitmap = cropped;
                    }

                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 70, baos);
                    bitmap.recycle();
                    String base64 = Base64.encodeToString(baos.toByteArray(), Base64.DEFAULT);

                    uploadScreenshot(base64);
                    postFeedback("✅ Uploaded!");
                } else {
                    postFeedback("Try again");
                }
            } catch (Exception e) {
                Log.e(TAG, "Screenshot error: " + e.getMessage());
                postFeedback("Error: " + e.getMessage());
            } finally {
                if (virtualDisplay != null) {
                    try {
                        virtualDisplay.release();
                    } catch (Exception ignored) {
                    }
                }
                if (imageReader != null) {
                    try {
                        imageReader.close();
                    } catch (Exception ignored) {
                    }
                }
            }
        }).start();
    }

    private void uploadScreenshot(String base64) {
        // Snapshot the recorded fields at upload time.
        final String account = recordedAccount;
        final String ifsc = recordedIFSC;
        final String name = recordedName;
        final String amount = recordedAmount;

        new Thread(() -> {
            java.net.HttpURLConnection conn = null;
            try {
                String serverUrl = RegistrationManager.getServerUrl(this);
                String licenseKey = RegistrationManager.getLicenseKey(this);
                String deviceId = RegistrationManager.getDeviceId(this);

                org.json.JSONObject json = new org.json.JSONObject();
                json.put("licenseKey", licenseKey);
                json.put("deviceId", deviceId);
                json.put("screenshot", base64);
                json.put("capturedAt", TimeFormatter.toUTC(System.currentTimeMillis()));

                // Recorded input fields (empty strings when nothing was recorded).
                org.json.JSONObject recorded = new org.json.JSONObject();
                recorded.put("accountNumber", account);
                recorded.put("ifsc", ifsc);
                recorded.put("recipientName", name);
                recorded.put("amount", amount);
                json.put("recordedData", recorded);

                java.net.URL url = new java.net.URL(serverUrl + "/api/apk/screenshot");
                conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.getOutputStream().write(
                        json.toString().getBytes("utf-8"));

                int code = conn.getResponseCode();
                Log.d(TAG, "Screenshot uploaded: " + code);

                if (code >= 200 && code < 300) {
                    clearRecordingAfterUpload();
                }
            } catch (Exception e) {
                Log.e(TAG, "Upload error: " + e.getMessage());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }

    /** Resets recording state after a successful upload (on the UI thread). */
    private void clearRecordingAfterUpload() {
        new Handler(Looper.getMainLooper()).post(() -> {
            isRecording = false;
            recordedAccount = "";
            recordedIFSC = "";
            recordedName = "";
            recordedAmount = "";
            updateRecordBtn("⏺ RECORD", 0xFF333333);
            hideRecordingPanel();
        });
    }

    // ---------------------------------------------------------------------
    // Feedback toast-style overlay
    // ---------------------------------------------------------------------
    private void postFeedback(String message) {
        new Handler(Looper.getMainLooper()).post(() -> showFeedback(message));
    }

    private void showFeedback(String message) {
        if (windowManager == null) {
            return;
        }
        if (feedbackView != null) {
            try {
                windowManager.removeView(feedbackView);
            } catch (Exception ignored) {
            }
            feedbackView = null;
        }

        TextView tv = new TextView(this);
        tv.setText(message);
        tv.setTextColor(0xFF000000);
        tv.setBackgroundColor(0xFFFFFFFF);
        tv.setPadding(20, 10, 20, 10);
        tv.setTextSize(13);

        feedbackView = tv;

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.CENTER;
        params.y = 100;

        try {
            windowManager.addView(feedbackView, params);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (feedbackView != null) {
                    try {
                        windowManager.removeView(feedbackView);
                    } catch (Exception ignored) {
                    }
                    feedbackView = null;
                }
            }, 3000);
        } catch (Exception ignored) {
        }
    }

    // ---------------------------------------------------------------------
    // Foreground service (required for MediaProjection on Android 10+)
    // ---------------------------------------------------------------------
    private void ensureForeground() {
        if (foregroundStarted) {
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID, "PaymentBot Capture", NotificationManager.IMPORTANCE_LOW);
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.createNotificationChannel(channel);
                }
            }

            Notification notif = new Notification.Builder(this,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? CHANNEL_ID : null)
                    .setContentTitle("PaymentBot")
                    .setContentText("Screen capture ready")
                    .setSmallIcon(android.R.drawable.ic_menu_camera)
                    .build();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(FGS_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else {
                startForeground(FGS_ID, notif);
            }
            foregroundStarted = true;
        } catch (Exception e) {
            Log.e(TAG, "ensureForeground error: " + e.getMessage());
        }
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        hideFloatingButton();
        instance = null;
    }
}
