plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.paymentbot"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.paymentbot"
        minSdk = 24
        targetSdk = 34
        // Bump BOTH of these for every build handed to a device, and set the
        // VPS's APK_LATEST_VERSION_CODE / APK_LATEST_VERSION_NAME to match
        // (see ngo-backend routes/apk.js GET /latest-version). An install
        // whose versionCode is not higher than the one already on the phone
        // cannot be installed over it at all — Android refuses a downgrade —
        // and the in-app update check compares these exact numbers.
        //
        // These sat at 1 / "1.0" while builds 2, 3 and 4 went out, so the
        // committed values did not describe any APK anyone was running. The
        // versionName carries the commit the build's behaviour comes from, so
        // a phone in the field can be traced back to source.
        //
        // Set to 9 here, above the server's live 8 (GET /api/apk/latest-version
        // on ngo-api.adminmaxedge.com, checked before this build), carrying
        // 970d1ba — this build ships BUG-53 (appVersion now reads
        // BuildConfig.VERSION_NAME) plus the IST on-device timestamp fix.
        //
        // 10 / "1.7-wip" — local dev-only bump, NOT yet committed and NOT
        // pushed to the server's latest-version config (this is a device
        // test build, not a release). Carries, on top of 970d1ba: the
        // OverlayService removal, the PhonePe self-generated-event
        // foreground-tracking fix, the Record/Screenshot feedback-check
        // reorder, and the overlay drag-direction fix. Re-bump with a real
        // commit hash once this lands.
        //
        // 11 / "1.8-diag-paytm-notif" — adds, on top of 1.7-wip: BUG-54's
        // Unicode-digit + comma amount-parsing fixes, and a TEMPORARY
        // diagnostic-only payload (see NotificationService/CaptureTiming) for
        // the Paytm Business investigation — full notification-extras dump +
        // group-summary flag, routed through the existing CaptureTiming
        // server upload so a remote tester with no adb access can still
        // produce usable evidence. Strip the diagnostic block back out once
        // the real field is confirmed; do not let this versionName ship as a
        // permanent release.
        //
        // 12 / "1.9-bug57-remoteviews" — a local test build, superseded by
        // 13 below; left in this history for the record, not reused.
        //
        // 13 / "2.0-5fab730" — the real combined release: built from the
        // actual committed tip of trader-ui-integration (5fab730), not a
        // hand-picked subset. Confirmed ancestors, all on this branch:
        // OverlayService removal + drag fix + feedback reorder + the
        // MaxPayDesign overlay visual migration (5b345cb), the PhonePe
        // self-generated-event fix (8e86a1d), BUG-54's amount-parsing fixes
        // (3141f21), PayoutLock 409-handling (8dfdb75), BUG-57's Paytm
        // Business custom-layout fix (acf060d) and its still-live
        // confirmation-signal fields on CaptureTiming, BUG-56's BharatPe
        // "<number> Rupees" fix (86fcf3f) — plus BUG-58 and the
        // Notifications pagination/filter rewrite, both landed on this
        // branch by a parallel session since. Major version bumped to 2.0
        // deliberately — this supersedes every "1.x-*" test/diagnostic
        // build from tonight, not an increment of them. versionName carries
        // the exact commit, same convention as every prior bump here.
        // 19 / 2.6-tap-only — CRITICAL anti-fraud: removed the passive/automatic
        // success-screen reading (it auto-captured any success screen, incl. an
        // OLD transaction scrolled to). Outgoing/payout fields are now extracted
        // ONLY at the trader's Capture tap (SuccessScreenParser), with the full
        // field list (time, sender bank, last-4s, recipient, txn id, UTR, amount)
        // saved alongside the screenshot and uploaded with the evidence bundle.
        //
        // 20 / 2.7-match-gate — two changes: (1) the Capture tap now UPLOADS the
        // evidence immediately (reason="capture"), so the trader panel can gate
        // "I have transferred" on the amount/last-4 match and the gateway can
        // enforce it, BEFORE the click (bank payouts only). (2) A debit SMS that
        // arrives during an active payout is still forwarded as a normal debit
        // (no longer swallowed), so every captured SMS — credit AND debit — stays
        // visible on the trader's Notifications page.
        versionCode = 20
        versionName = "2.7-match-gate"

        // Room schema export — not used for migrations yet (the app is
        // pre-install-base, so destructive fallback is acceptable), but
        // keeping the exporter on avoids a Gradle warning and gives us a
        // real schema history the moment migrations start to matter.
        javaCompileOptions {
            annotationProcessorOptions {
                arguments["room.schemaLocation"] = "$projectDir/schemas"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    // AGP 8 stopped generating BuildConfig by default — auto-update's
    // version check compares the server's reported versionCode against
    // BuildConfig.VERSION_CODE (the actual installed build), so this needs
    // to be back on.
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")

    // Offline-first capture queue (item 3): every captured event is saved
    // here FIRST, then WorkManager delivers it — nothing is lost to a
    // network hiccup or an offline device at the moment of capture.
    implementation("androidx.room:room-runtime:2.6.1")
    annotationProcessor("androidx.room:room-compiler:2.6.1")

    // Network-constrained, auto-retrying background delivery of queued
    // events (and crash reports) — survives process death/reboot because
    // WorkManager persists its own work queue independently of our Room DB.
    implementation("androidx.work:work-runtime:2.9.0")

    // Local JVM unit tests for the pure SMS bank-sender gate (SMSReceiver
    // .evaluateSender). Runs via `gradlew testDebugUnitTest` — no APK build,
    // no device. The gate methods touch no Android APIs, so no Robolectric.
    testImplementation("junit:junit:4.13.2")
}
