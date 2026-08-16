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
        // The committed value here had drifted to 6 while the VPS already
        // advertised 7 (GET /api/apk/latest-version, checked live before this
        // build) — confirms the note above wasn't followed for that release.
        // Set to 8 here, above the server's 7, carrying dfbb00c (the payout
        // evidence capture + content-based SMS push commit this build ships).
        versionCode = 8
        versionName = "1.5-dfbb00c"

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
