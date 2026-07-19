# Payment Bot — Android APK

Passive Android client for the P2P UPI Payment Gateway. It runs on the **trader's own
device** and detects **their own** incoming UPI payments using three independent
engines, merges the results, shows them for review, and reports confirmations to the
backend. This mirrors the backend's `smartMerge` detection engines and confidence
weights.

> Install and use only on a device you own/operate, with the account holder's consent.

## Stack
- **Language:** Java only (no Kotlin)
- **Package:** `com.example.paymentbot`
- **Min SDK:** 24 · **Target/Compile SDK:** 34
- **Build:** Gradle (Kotlin DSL), Android Gradle Plugin 8.2.0, JDK 17
- **Networking:** `HttpURLConnection` + `AsyncTask` (no third-party libs)

## Detection engines
| Engine | Component | Signal | Confidence weight |
|--------|-----------|--------|-------------------|
| SMS | `SMSReceiver` (BroadcastReceiver) | Bank/UPI SMS alerts | 30% |
| Notification | `NotificationService` (NotificationListenerService) | UPI app notifications | 40% |
| Screen | `PaymentBotService` (AccessibilityService) | On-screen text in UPI apps | 30% |

`PaymentMerger` combines whatever the engines capture, picks the best value per field
(screen > notification > SMS) and sums the weights (capped at 100%). `PaymentParser`
holds the shared Indian-UPI regex (₹/Rs/INR amounts, "from/by/paid by" senders,
UTR/RRN/Txn ID, `@`-based UPI ids, status, mode).

## Structure
```
apk/
├── settings.gradle.kts · build.gradle.kts · gradle.properties
├── gradle/wrapper/gradle-wrapper.properties
└── app/
    ├── build.gradle.kts · proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/example/paymentbot/
        │   ├── MainActivity.java          # UI, live feed, confirm/edit/reject, status
        │   ├── PaymentData.java           # model + isValid() + toString()
        │   ├── PaymentParser.java         # shared UPI regex
        │   ├── PaymentMerger.java         # smart merge + confidence
        │   ├── APIClient.java             # JSON POST (fails silently offline)
        │   ├── PaymentBotService.java     # AccessibilityService (screen)
        │   ├── NotificationService.java   # NotificationListenerService
        │   └── SMSReceiver.java           # BroadcastReceiver (SMS)
        └── res/
            ├── layout/activity_main.xml   # dark #0A0A0A / #00FF88 accent
            ├── values/themes.xml · strings.xml
            └── xml/accessibility_config.xml
```

## Configure the server
Set your endpoint in `APIClient.java`:
```java
public static final String SERVER_URL = "https://your-server.onrender.com/api/payment";
```
The client POSTs each `PaymentData` as JSON. If the server is unreachable it logs the
failure and keeps the payment in the on-screen feed — it never crashes.

## Build & run
1. Open the `apk/` folder in **Android Studio** and let it sync. It will generate the
   Gradle wrapper (`gradlew`, `gradle-wrapper.jar`) automatically — or run
   `gradle wrapper --gradle-version 8.7` if you have a local Gradle.
2. Run on a **real device** (accessibility/notification/SMS access is limited on
   emulators without those apps installed).
3. In the app, tap **Enable Bot Now** and grant, in order:
   - **Notification access** (opens the listener settings screen)
   - **Accessibility** (enable "Payment Bot Screen Reader")
   - Allow the **SMS** permission when prompted.
4. Status shows **ACTIVE** (green) once accessibility + notification access are on.
   Incoming payments appear as cards with a confidence % and the engines that captured
   them, each with **CONFIRM & CLOSE / EDIT / REJECT**.

All events are logged to Logcat under the tag **`PaymentBot`** and to the in-app feed.
