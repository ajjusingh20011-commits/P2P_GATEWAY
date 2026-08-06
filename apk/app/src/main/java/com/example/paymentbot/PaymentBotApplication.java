package com.example.paymentbot;

import android.app.Application;
import android.content.Context;

/**
 * Holds a static, always-available application Context. This app is
 * fundamentally background-service-driven (NotificationService, SMSReceiver,
 * HeartbeatService all run with no UI open most of the time), so anything
 * that needs a Context — like LogStore's on-device persistence — can't rely
 * on MainActivity being alive. A plain static Application Context is the
 * standard, safe way to get one (unlike an Activity Context, it has no
 * lifecycle to leak).
 */
public class PaymentBotApplication extends Application {

    private static Context appContext;

    @Override
    public void onCreate() {
        super.onCreate();
        appContext = getApplicationContext();
    }

    /** Never null once the process has started — Application.onCreate() always runs first. */
    static Context get() {
        return appContext;
    }
}
