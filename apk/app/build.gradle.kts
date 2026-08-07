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
        versionCode = 1
        versionName = "1.0"

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
}
