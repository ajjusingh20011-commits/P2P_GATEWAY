# APK Capture Pipeline — Reliability Audit & Fixes

Covers 6 areas beyond tonight's ColorOS-specific fix. Findings, what was
already in place, what was built in this pass, and what still needs a real
device to confirm.

**Important note on process:** partway through this pass, `git status` and
file mtimes showed that `ListenerHealthStore.java`, the ColorOS case in
`PermissionActivity.java`, the three-state status badge in `MainActivity.java`,
and `LogStore.java` had *already* been implemented concurrently (timestamps
just before this pass started) — this is exactly the work the previous
investigation-only turn recommended (items 2, 5, 6 from that report). That
work was reviewed and built on, not redone or reverted.

---

## 1. OEM coverage

**Before this pass:** only ColorOS (Oppo/Realme) had a dedicated onboarding
step — a 4th `PermissionActivity` page detecting `Build.MANUFACTURER`
containing "oppo"/"realme" and guiding the user to the OEM's Auto-start
toggle.

**Now:** `PermissionActivity.Oem` is a profile enum covering Xiaomi/Redmi/POCO
(MIUI Autostart manager), Oppo/Realme (ColorOS, unchanged from tonight),
Vivo/iQOO (Permission Manager background-startup whitelist), Huawei/Honor
(Startup Manager / Protected Apps), Samsung (battery "never sleeping apps" —
no stable cross-version deep link, app-details page used directly), and
OnePlus (OxygenOS advanced-optimization battery chain manager). Each profile
carries OEM-specific instructional text and, where one exists, a best-effort
`ComponentName` intent into the OEM's specific settings activity —
`launchOemAutostartSettings()` tries that first, falls back to
`ACTION_APPLICATION_DETAILS_SETTINGS` (a real, stable API on every device) if
the specific activity isn't present on that exact firmware.

**Caveat, stated plainly:** none of these six component-name intents are a
documented, stable public API — dontkillmyapp.com itself only documents them
as best-effort, and they're known to move between firmware versions. Only the
ColorOS case has any real-device confirmation (from tonight). **The other
five need a real-device pass each** — at minimum, confirm the specific intent
still launches the right screen on a current firmware build for that
manufacturer, or confirm it fails gracefully into the app-details fallback if
not. OnePlus is flagged in-code as the single most likely to need correction:
current OnePlus phones ship a ColorOS-based OxygenOS and may need the ColorOS
case instead of their own — `Build.MANUFACTURER` doesn't distinguish this.

---

## 2. Permission auto-reset detection

**Before this pass:** `ListenerHealthStore` + `HeartbeatService.checkListenerHealth()`
already existed (concurrent work) — the notification-listener binding is
checked every 4s heartbeat tick, and a mismatch (permission granted,
listener reported disconnected) triggers `NotificationListenerService.requestRebind()`,
cooldown-limited to once per 60s. This is a full, working fix for exactly
the ColorOS silent-unbind case, and incidentally also catches Android's
unused-app permission auto-reset for the notification-listener permission
specifically, since that revocation shows up the same way (permission grant
gone from `enabled_notification_listeners`).

**What this pass added:** SMS permission (`READ_SMS`/`RECEIVE_SMS`) had no
equivalent check at all. Unlike the notification listener, a revoked runtime
permission has **no programmatic fix** — Android does not let an app silently
re-request a dangerous permission, only the user can via a real dialog or
Settings. `HeartbeatService.checkSmsPermissionHealth()` (piggybacked on the
same tick, throttled to once/60s) now detects this via
`ContextCompat.checkSelfPermission` and raises a persistent, distinct
notification ("SMS permission needed — open the app to re-grant") instead of
the SMS capture path silently going dark with zero indication anywhere, which
was the previous behavior.

**Needs real-device confirmation:** revoke SMS permission manually (Settings
> Apps > MaxPay > Permissions) or wait out Android's auto-reset window, and
confirm the notification actually fires within ~60s and that reopening the
app and re-granting clears it.

---

## 3. Offline-first capture pipeline (the most consequential item)

**Confirmed before fixing:** all four capture→delivery paths
(`NotificationService`, `SMSReceiver`'s debit path, `PaymentBotService`'s
outgoing and inbound screen captures via `APIClient`) did a single direct
`HttpURLConnection` POST with no persistence — a failure just logged and the
event was gone. **This is now fully replaced.**

**What was built:**
- `QueuedEvent` (Room entity) + `QueuedEventDao` — a generic
  endpoint-path + JSON-payload queue table, so any of the four (now five,
  with crash reports) POST shapes can be queued without a schema change.
- `EventQueue.enqueue(...)` — the single entry point every capture engine now
  calls. Writes to Room on a background thread (all four original call sites
  run on the main thread — BroadcastReceiver/NotificationListenerService/
  AccessibilityService callbacks — and Room forbids main-thread writes), then
  triggers immediate delivery.
- `EventUploadWorker` (WorkManager `Worker`) — two triggers: an immediate,
  network-constrained one-time job right after every capture (so on a
  connected device delivery is still effectively instant, same as before),
  and a 15-minute periodic safety net (WorkManager's minimum interval) that
  survives app kill and device reboot independently of this app's own
  process, because WorkManager persists its own queue separately. Both are
  constrained to `NetworkType.CONNECTED` — no busy-polling while offline.
  Per-row retry with a classification pass (HTTP 400 = permanent/malformed,
  dropped+logged; everything else — 401, 5xx, timeouts — transient, retried
  up to 50 attempts / ~12.5 hours at the periodic floor, then dropped+logged
  as a safety valve against a truly stuck row).
- `NotificationService`, `SMSReceiver`, `PaymentBotService`, and `APIClient`
  were all refactored to build the exact same JSON payloads as before, but
  hand them to `EventQueue` instead of opening a connection directly.

**Net effect:** a payment event captured while the phone has no signal, or
during a brief server outage, is now durable from the instant it's captured —
it survives the app being killed, the phone rebooting, and an extended
offline period, and delivers automatically the moment connectivity returns.

**Minor UX tradeoff, worth flagging:** the old `APIClient`'s "✓ Sent to
server" / "⚠ Server offline" lines that used to appear in the Logs feed after
each screen capture are gone — delivery is now asynchronous (could be
instant or, if offline, minutes/hours later via the periodic job), so there's
no single synchronous point to report success/failure from anymore. A queue-
depth indicator was added to Settings instead (see below) as the replacement
signal — less granular per-event, but honest about the new asynchronous
reality rather than a misleading synchronous-looking status line.

**Testable without hardware:** the logic (queueing, classification,
retry/backoff, uniqueness policy) was reviewed carefully against the
WorkManager/Room APIs and is internally consistent, but **this entire
pipeline has not run on a real device or emulator** — see the build-
verification section at the end for why, and what's specifically unverified
as a result (Room's generated code, WorkManager's actual scheduling
behavior, and the real HTTP round-trip against `ngo-backend` are the three
things that only a real run confirms).

---

## 4. Crash reporting

**Confirmed before fixing:** no crash-reporting dependency of any kind — an
uncaught exception just killed the process with nothing recorded anywhere
durable.

**What was built — and an honest note on what "or equivalent" means here:**
standing up real Firebase Crashlytics requires creating an actual Firebase
project and dropping in a genuine `google-services.json` — both external,
account-holder actions I can't perform from this session, and the
`com.google.gms.google-services` Gradle plugin actively **fails the build**
if that file is missing, so adding it without a real project would have
broken compilation for anyone building this repo. Instead:
- `CrashHandler` — a global `Thread.UncaughtExceptionHandler`, installed in
  `PaymentBotApplication.onCreate()`. It **always chains to the previous
  default handler** so a crash behaves exactly as it would have without this
  — recording must never mask or suppress the actual crash.
- `CrashReport` (Room entity) — a **permanent** local record (stack trace +
  device manufacturer/model/OS version), written synchronously and directly
  (not via the async `EventQueue`, deliberately — see the code comment: the
  process is about to die, and a background-executor write isn't guaranteed
  to land in time, so this one path bypasses the queue's async pattern for
  reliability). Exportable via the existing Logs export path.
- The same crash is also queued (synchronously persisted as a `QueuedEvent`
  for the same reason) for best-effort upload to a new **`POST /api/apk/crash`**
  endpoint on `ngo-backend`, gated by the same `devicetoken` header every
  other ingestion route uses, storing into a new `CrashLog` Mongo model.
  A `GET /api/apk/crashes` (admin-only) route lets the dev team actually
  review these remotely — real field visibility, not just an on-device log.

**To later upgrade to real Crashlytics:** add the
`com.google.gms:google-services` + `com.google.firebase:firebase-crashlytics`
plugin/dependencies, generate a real `google-services.json` from a Firebase
console project, and call `FirebaseCrashlytics.getInstance().recordException(ex)`
inside `CrashHandler.recordCrash()` alongside (or instead of) the current
local+backend path.

**Needs real-device confirmation:** deliberately trigger an uncaught
exception and confirm (a) the app still shows normal Android crash behavior
(handler chaining works), (b) the `CrashReport` row is present in the local
DB/Logs export afterward, and (c) — if the device has connectivity at crash
time or shortly after — the crash actually lands in `ngo-backend`'s
`CrashLog` collection.

---

## 5. Per-bank notification/SMS format resilience

**Confirmed before fixing:** all three capture engines already had outer
`try/catch` around their parsing — a single malformed message cannot crash
the listener. What was missing was **visibility**: an empty extraction on a
message that clearly passed the relevance gate just silently `return`ed.

**What was built:** `ParseFailure` (Room entity) + `ParseFailureLogger` —
logs source/sender/raw-text/reason whenever a message that already passed
the bank-sender or allowed-app gate yields no amount (SMS debit, notification,
inbound screen capture) or no amount+UTR (notification). Deliberately
**local-only** — raw bank-message text shouldn't leave the device
automatically; a developer plugs in the phone and reviews it via the Logs
export, then adds a pattern for that format. Wired into all three engines
(`SMSReceiver.handleDebit`, `NotificationService.onNotificationPosted`,
`PaymentBotService`'s outgoing and inbound success-screen paths). A count is
now also visible directly in Settings (see below) without needing adb at all.

**Needs real-device confirmation:** capture a real payment from each of the
banks/apps in production use and spot-check that (a) well-formed messages
don't spuriously log a parse failure, and (b) a deliberately malformed/
unusual-format message actually gets logged as expected.

---

## 6. Hidden/redacted notification content — findings (documentation, not code)

**`NotificationListenerService` receives the full, unredacted notification
object regardless of lock-screen visibility settings.** `Notification.visibility`
(`VISIBILITY_PRIVATE`/`VISIBILITY_SECRET`) only controls what's rendered
*on the lock screen itself* — a bound listener always gets the real
`Notification.extras` bundle. This means OS-level redaction is **not**
actually a gap for this app's capture path, contrary to what the "hidden
notification content" framing might suggest — worth stating plainly since
it rules out an entire category of concern.

**The real gap is app-design, not OS redaction — two distinct cases:**

1. **Apps that never put amount/UTR in the notification text at all**, by
   their own design or the user's notification-privacy setting within that
   app (some banking apps show only "You have a new transaction — open the
   app" regardless of device lock state). For these, notification capture
   yields nothing useful no matter what this app does — SMS is the only
   possible fallback, *if* the underlying transaction also generates a
   traditional bank SMS.

2. **Wallet-internal transfers that never generate a bank SMS at all**,
   because no traditional bank account is involved in that leg of the
   transaction. Cross-checking `NotificationService.ALLOWED_PACKAGES`
   against `SMSReceiver.isValidBankSender()`'s sender-ID list surfaces the
   concrete candidates: **FreeCharge (`com.freecharge.android`) and MobiKwik
   (`com.mobikwik_new`)** are both in the notification allow-list but have
   **no corresponding entry** in the bank-sender-ID list — because they're
   semi-closed wallets; a wallet-balance-to-wallet-balance transfer doesn't
   touch a bank account and so never produces a bank SMS. **For these two
   apps specifically, if the notification is generic/redacted-by-design for
   a given transaction, there is no fallback at all — SMS won't have it
   either.** This is now a documented, known limitation rather than a silent
   gap: worth deciding whether FreeCharge/MobiKwik wallet transfers are
   actually in scope for this deployment, and if so, whether the
   accessibility screen-reader engine (`PaymentBotService`, which reads the
   actual on-screen success text rather than relying on a notification) is
   the intended third fallback for exactly this case — it already covers
   both apps in `PAYMENT_APPS`/`WATCHED_PACKAGES`, so the real coverage story
   for these two is "notification may fail, SMS will fail, screen capture is
   the one that should catch it" — worth confirming that's actually true in
   practice on a real device rather than assumed.

**Needs real-device confirmation:** trigger a real FreeCharge and MobiKwik
wallet-to-wallet transfer and confirm what each of the three engines (SMS,
notification, screen) actually captures, to verify the "screen capture is
the real fallback for these two" conclusion above rather than assuming it.

---

## Build verification — what was and wasn't possible in this environment

Attempted a real `gradlew compileDebugJavaWithJavac` to catch compile errors
before finalizing. Blocked by an environment issue, not a code issue:
Gradle's JVM (the Android-Studio-bundled JBR) fails SSL handshake against
`dl.google.com`/Maven Central when resolving the two new dependencies (Room,
WorkManager) — confirmed via `curl` that raw HTTPS access to the exact same
URLs works fine outside the JVM, so this is a Java-truststore/cacerts
mismatch specific to this sandbox, not a real network block. Two workarounds
(`-Djavax.net.ssl.trustStoreType=Windows-ROOT`, retrying with `GRADLE_OPTS`)
did not resolve it in the time available.

**What was done instead, as the next-best verification:**
- Confirmed `apk/app/src/main/AndroidManifest.xml` already registers
  `PaymentBotApplication` (needed for `CrashHandler`/`EventUploadWorker`
  init) — no manifest change was needed.
- Manually reviewed every new/changed Java file against the real Room 2.6.1
  and WorkManager 2.9.0 APIs (entity/DAO annotations, `Worker` constructor
  signature, `Result` returns, `Constraints`/`WorkRequest` builder chains).
- Verified no file left a dangling reference to an import it no longer uses
  (checked directly — the four refactored capture paths no longer reference
  `HttpURLConnection`/`OutputStream`/`StandardCharsets` after removing those
  imports).
- Brace-balance-checked every touched file as a structural sanity check.
- The two backend JS changes (`CrashLog.js`, `apk.js`) were verified with
  `node --check` — genuinely valid syntax confirmation, not just a proxy.

**What this does NOT confirm, and genuinely needs a real build:**
- That `androidx.room:room-compiler`'s annotation processor generates
  `AppDatabase_Impl`/DAO implementations without error against these exact
  entity/DAO definitions (Room's compile-time validation is fairly strict
  about things like missing `@PrimaryKey` or type mismatches — reviewed by
  eye, not compiler-verified).
- That `WorkManager`'s scheduling actually behaves as designed on a real
  device (periodic job survives reboot, immediate job actually races ahead
  of the periodic one under `ExistingWorkPolicy.REPLACE`, constraints
  actually gate execution on connectivity).
- That the full round-trip — capture → Room write → WorkManager trigger →
  real HTTP POST → `ngo-backend`'s routes — actually delivers a real event
  end-to-end.

**Recommended before shipping:** run `./gradlew assembleDebug` in a normal
network environment (not this sandbox) as the first step — that alone will
surface any Room/WorkManager compile issue immediately. Then install on a
real device (or emulator) and walk through: airplane-mode capture → re-enable
network → confirm delivery; force-kill the app → confirm the periodic worker
still delivers anything left queued; trigger a crash → confirm it's visible
in `ngo-backend`'s new `/api/apk/crashes`.
