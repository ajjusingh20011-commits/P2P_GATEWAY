# MaxPay Android App — UI/UX Redesign Specification

**Status:** Audit + design spec only. No code was changed to produce this document.
**Scope:** `apk/` — the on-device trader-owned Android app (package `com.example.paymentbot`, app-facing name "MaxPay"). Every screen, service, overlay, notification, and navigation path in the current codebase was read in full before writing this.

---

## How to read this document

Every recommendation below is grounded in what the app actually does today — not a generic mobile-app checklist. Three findings surface repeatedly enough to state once, up front, rather than re-explain in every section:

1. **The entire UI is hand-built in Java** — every screen is `new LinearLayout(this)` / `new TextView(this)` calls, with hex colors and `dp()` conversions repeated inline in almost every file. There is no XML layout system in active use, no Jetpack Compose, no shared component library, and no single source of truth for color or type. `RegistrationActivity`, `PermissionActivity`, and `MainActivity` each independently define `0xFF1565C0` as "the blue" in three separate places. This is the single biggest reason the app looks the way it does, and it's the precondition for almost everything in this spec.
2. **The app has no product surface today** — no dashboard, no order list, no account management, no notification center, no profile screen. What exists is a pairing/permission flow and a 3-tab shell (Home / Logs / Settings) where "Home" is a single centered word ("Working") and a button. Sections 4–9 below are not redesigns of existing screens in most cases — they're new product surfaces this app has never had.
3. **There is already leftover/dead design work in the repo** — a fully-built second onboarding flow (`OnboardingActivity`) that is never launched from anywhere, and an orphaned XML layout (`activity_main.xml`) from what appears to be an earlier "hacker terminal" visual identity (black background, neon green `#00FF88`, red status text) that predates the current white/blue/green look. Both are cited in the relevant sections below — a redesign is also a chance to delete them.

---

# 1. Complete Screen Flow

## 1.1 What actually exists and launches today

```
SplashActivity  (LAUNCHER)
  │  2s branded splash, then checks RegistrationManager.isRegistered()
  │
  ├─ not registered ─────────────────────────────────────────┐
  │                                                            ▼
  │                                              PermissionActivity (page 1/4)
  │                                              Notification access
  │                                                            │ (auto-advance on grant)
  │                                                            ▼
  │                                              PermissionActivity (page 2/4)
  │                                              Battery optimization exemption
  │                                                            │ (auto-advance on grant)
  │                                                            ▼
  │                                              PermissionActivity (page 3/4)
  │                                              SMS permissions (system dialog)
  │                                                            │
  │                                    ┌───────── no OEM match ┴─ OEM match (6 profiles) ─┐
  │                                    ▼                                                   ▼
  │                          RegistrationActivity                          PermissionActivity (page 4/4)
  │                          Enter pairing code                            OEM autostart instructions
  │                                    ▲                                                   │
  │                                    └───────────────────────────────────────────────────┘
  │                                    │ code verified
  │                                    ▼
  │                          SetDeviceNameActivity
  │                          Name this device
  │                                    │ confirm → success dialog
  │                                    ▼
  └─ already registered ──────────────► MainActivity
                                        (confirmed live server-side first — see 1.2)
                                                │
                          ┌─────────────────────┼─────────────────────┐
                          ▼                     ▼                     ▼
                      Home tab              Logs tab              Settings tab
                   "Working" + button    Capture feed cards    Device info, toggles,
                                                                logout, export

     (background, no dedicated screen)
     OverlayService / PaymentOverlayService — floating widgets while a
     banking app is in the foreground (see Section 3)

     (background, no dedicated screen)
     System notifications — persistent "Active", re-pairing prompt, SMS-
     permission prompt, update-available prompt (see Section 7)
```

**Not part of the live flow — reachable only by directly instantiating the Activity, which nothing in the app does:**
- `OnboardingActivity` — a complete, separately-designed 4-page dark-themed `ViewFlipper` wizard (Welcome → SMS → Notification → Battery) with dot-indicator + "N of 4" progress chrome. Declared in the manifest, fully functional, **zero callers**. Confirmed by grepping the whole `apk/` tree for `OnboardingActivity` — the only two hits are its own class declaration and the manifest `<activity>` entry.

## 1.2 How navigation actually happens

- **Forward navigation** is exclusively `startActivity()` + `finish()` — a plain Activity stack, no `Fragment`, no Navigation Component, no shared ViewModel. Every screen re-reads its own state from `SharedPreferences` (`RegistrationManager`) on create.
- **Auto-advance** exists only in `PermissionActivity`: `onResume()` polls the real permission state for pages 1–2 and silently calls `showPage(next)` if already granted (so backgrounding the app to grant a permission and returning skips forward automatically). Page 3 advances via the `onRequestPermissionsResult` callback. Page 4 (OEM autostart) has **no** programmatic way to verify success — Android exposes no API for it — so it requires a manual "I've enabled it" tap.
- **Re-entry gate**: `SplashActivity` is the *only* entry point that re-validates registration against the server (`GET /api/apk/status/:deviceId`) before trusting the locally-stored license key — this is what makes a deleted-from-trader-panel device correctly bounce back to pairing instead of trusting stale local state. `MainActivity` itself performs no such check on its own `onCreate`.
- **Bottom nav is not real navigation** — `showHome()`/`showLogs()`/`showSettings()` just toggle `View.VISIBLE`/`View.GONE` on three sibling `LinearLayout`s that are all inflated at once inside the same Activity. There's no back-stack entry per tab, no deep-linking, no state restoration beyond whatever the Activity itself retains in memory.
- **Overlays are not part of the Activity graph at all** — `OverlayService` and `PaymentOverlayService` add/remove raw `View`s directly to the `WindowManager` from a background `Service`, entirely independent of whatever Activity (if any) is in the foreground. This is why they can appear over a *different app* (Paytm, PhonePe, etc.) — see Section 3.

---

# 2. Screen Inventory

Legend for **States**: every current screen is audited against whether it actually implements Loading / Empty / Error / Success states, since most don't.

## SplashActivity

| | |
|---|---|
| **Purpose** | Branded launch screen; silently decides whether to route to pairing or straight into the app, re-validating registration against the server. |
| **Current UI** | Black-outline logo circle (₹ glyph), "MaxPay" wordmark, tagline, indeterminate spinner. Fixed 2s delay before the registration check even starts. |
| **Problems** | The 2-second delay is arbitrary and adds latency on every cold start regardless of network speed. No visual difference between "checking" and "about to navigate" — the spinner spins the same way whether the check is instant or timing out at 5s. No error/offline messaging: a network error is treated as "unknown" and silently proceeds (correct behavior, but the user is never told anything different happened). |
| **Recommended redesign** | Keep the fixed-minimum-branding-time pattern (splash screens shouldn't flash), but drive it off `SplashScreen` API (Android 12+ `core-splashscreen`) instead of a hand-built layout, and shorten/skip the artificial delay once the status check already resolves. No user-facing change needed to the decision logic itself — it's correct. |
| **Backend data** | `GET /api/apk/status/:deviceId` |
| **Buttons** | None (fully automatic) |
| **States** | Loading (spinner, generic) · No empty/error state surfaced — masked by design (see note above) |

## PermissionActivity (pages 1–4)

| | |
|---|---|
| **Purpose** | Sequentially request the permissions the app cannot function without: notification access, battery-optimization exemption, SMS, and (conditionally) OEM-specific autostart. |
| **Current UI** | Four near-identical full-screen pages: 64sp emoji, bold 20sp title, 15sp grey description, one primary button (page 4 adds a secondary text-button). White background throughout. A "✕" close button top-left on every page (closes the whole flow — a real risk, see Problems). |
| **Problems** | (1) The "✕" lets a user abandon required-permission setup entirely with no confirmation and no explanation of what breaks. (2) No progress indicator at all — contrast with the *dead* `OnboardingActivity`, which has dot indicators and "N of 4" and this live flow doesn't. (3) Page 4's OEM instructions are dense paragraph text with no visual hierarchy (no numbered steps, no highlighted app name). (4) Every page is a full Activity transition (default OS animation) rather than an in-place step transition — feels heavier than a 4-step wizard should. |
| **Recommended redesign** | Bring over `OnboardingActivity`'s progress-dot pattern (it already exists in the codebase, unused). Replace the bare "✕" with a "Skip for now" that visibly explains the consequence ("SMS and notification-based payment detection won't work until you grant this"). Number OEM steps explicitly ("1. Open Auto-start settings → 2. Find MaxPay → 3. Turn it on") instead of one paragraph. Use a lightweight in-place crossfade/slide between pages instead of full Activity transitions. |
| **Backend data** | None — purely on-device permission state |
| **Buttons** | Allow / Disable / Grant / Open [autostart] settings / I've enabled it / Skip (page-dependent) |
| **States** | No loading state needed (instant, local). No error state (an OS permission dialog can't itself "fail"). |

## RegistrationActivity

| | |
|---|---|
| **Purpose** | Enter the short pairing code generated by the trader panel to claim this device. |
| **Current UI** | Back arrow, title, Android ID shown for reference, single underlined text input, inline status text, "Continue" button (disabled until ≥4 chars typed). |
| **Problems** | Status text is the *only* feedback mechanism — errors ("Invalid code", "Code expired", "This device is already registered") and the loading state ("Verifying code...") all render as the same small colored text in the same position, easy to miss. No numeric keypad hint on the input (codes are alphanumeric hex, but nothing constrains/formats entry). No resend/generate-new-code affordance if a code expires while the user is mid-entry. |
| **Recommended redesign** | Promote the status line to a proper inline banner (icon + colored background), not just colored text. Auto-uppercase and space-group the code as typed (like a 2FA input) since codes are always uppercase hex. Add a visible countdown once a code is known to expire in 5 minutes (matches the server's `licenseExpiresAt`), so "Code expired" isn't a surprise. |
| **Backend data** | `POST /api/apk/register-device` |
| **Required API** | Same |
| **Buttons** | Continue |
| **States** | Loading ("Verifying code...") · Error (invalid/expired/already-registered — currently all rendered identically) · Success (routes to SetDeviceNameActivity) |

## SetDeviceNameActivity

| | |
|---|---|
| **Purpose** | Name the device as it will appear in the trader panel's device list. |
| **Current UI** | Back arrow, title, underlined text input, helper text ("shown in your Trader Cabinet"), "Confirm" button (disabled until non-empty). |
| **Problems** | No character limit shown or enforced client-side. The confirm button has no loading spinner while the network call is in flight — just goes from enabled to (implicitly) unresponsive. Success is a blocking `AlertDialog` — an extra tap required for something that could just transition directly. |
| **Recommended redesign** | Add a max-length counter (trader panels usually truncate long names in lists anyway). Replace the blocking dialog with a brief success toast/snackbar + automatic transition — one less tap in a flow the user just spent several screens completing. |
| **Backend data** | `POST /api/apk/update-device-name` |
| **Buttons** | Confirm |
| **States** | Loading (none currently — should add) · Success (dialog → MainActivity) |

## MainActivity — Home tab

| | |
|---|---|
| **Purpose** | The "you're set up and running" landing view. |
| **Current UI** | Top bar (device name + status badge) is shared across all 3 tabs. Home's own content: centered grey "Working" text and a single "Enable payment mode" button pinned to the bottom. That's the entire screen. |
| **Problems** | This is not a dashboard — it's a placeholder. No visibility into anything the device is actually doing: no today's-capture-count, no recent activity, no account/pool status, no link to the trader panel for order detail. A trader has to tap into Logs to see *any* evidence the app is working. See Section 4 for the full redesign. |
| **Recommended redesign** | See Section 4 in full. |
| **Required backend data** | None currently fetched — this is the core gap. A redesigned Home needs read access to device/order/account summary data that today only the *web* trader panel has (via `ngo-backend`'s `/api/apk/devices`, and `backend`'s orders/payment-details endpoints — none of which this app currently calls). |
| **Buttons** | Enable payment mode |
| **States** | None implemented — no loading/empty/error because there's no data being fetched yet |

## MainActivity — Logs tab

| | |
|---|---|
| **Purpose** | Live feed of every captured SMS/notification/screen event, for the trader to visually confirm capture is working and to export a record. |
| **Current UI** | A single `ScrollView` of dark cards (`#18181B` bg), newest-first, color-coded left border by source (SMS blue / Notification green) or category (payment/debit/OTP/alert/bank/other). Each card: sender+category header row, monospace body text, relative + absolute timestamp. Empty state: centered "Waiting for banking SMS and notifications...". |
| **Problems** | It's a raw technical debug log, not a product feature — full unredacted SMS/notification text (including whatever a bank sends) sits in a plain scrollable list. No search, no filter by source/category/date, no way to tap a card for detail or to mark/dismiss anything. No pagination — relies on a hard 200-row in-memory cap plus a background SQLite store (see `LogStore`), but the UI itself has no "load more" or date grouping, just an ever-growing single list. Dark cards on an otherwise all-white app is a jarring visual mismatch — this screen looks like it belongs to a different app. |
| **Recommended redesign** | Reframe as an "Activity" or "Capture history" screen matching the rest of the app's light theme, with real filter chips (SMS / Notification / Screen · Payment / Debit / OTP / Alert), a search box, and date-grouped sections ("Today", "Yesterday", "Earlier"). Consider redacting full raw text behind a "Show details" tap rather than always-on-screen — this is sensitive financial data sitting on an unlocked screen. |
| **Backend data** | None — entirely local (`LogStore`, on-device SQLite) |
| **Buttons** | None on the list itself; Settings tab has the export actions |
| **States** | Empty ("Waiting for banking SMS and notifications...") · No loading state (synchronous local read) · No error state |

## MainActivity — Settings tab

| | |
|---|---|
| **Purpose** | Device identity display, capture-engine permissions, log export, and account logout. |
| **Current UI** | A vertical stack of read-only label/value rows (Device name, Server URL, License key [masked], App version [**hardcoded "1.0.0" string, not wired to the real `BuildConfig.VERSION_NAME`**], Android ID), followed by a conditional "Enable screenshot capture" button (only shown if MediaProjection consent isn't already granted), "Download logs" (share sheet), "Export logs as .txt" (Storage Access Framework save), and a red "Log out / deactivate device" button behind a confirm dialog. |
| **Problems** | It's an info-dump, not a settings screen — no grouping (identity vs. permissions vs. data vs. account are all one undifferentiated list), no icons, no section headers. "Server URL" is displayed but not editable anywhere in the app (confirmed by code audit — the only two `EditText`s in the whole app are the pairing code and device name inputs), so showing it as a prominent row is slightly misleading about what's configurable. None of the toggles a real settings screen would have exist yet: no dark mode, no notification preferences, no sound/haptic, no language — see Section 9. |
| **Recommended redesign** | See Section 9 for the full settings redesign; keep every existing row/action (nothing here should be removed), just organized into labeled sections with real Material list-item styling, and wire "App version" to `BuildConfig.VERSION_NAME` instead of the hardcoded string. |
| **Backend data** | Local (`RegistrationManager`, `LogStore`) + `GET /api/apk/latest-version` (auto-update, background) |
| **Buttons** | Enable screenshot capture (conditional) · Download logs · Export logs as .txt · Log out / deactivate device |
| **States** | No loading/error states on any row (all synchronous local reads) |

---

# 3. Overlay System

This app runs **two independent floating-UI systems**, both driven by `PaymentBotService` (the `AccessibilityService`) detecting a payment app in the foreground. They do not share a visual language, a shared "overlay manager," or any coordination beyond both being started/stopped from the same trigger.

## 3.1 `OverlayService` — manual screenshot capture

- **Appears when:** a payment app (17-package allow-list, shared with `NotificationService`'s notification allow-list) is detected in the foreground by the accessibility engine.
- **Appears as:** a `150dp`-wide, 2-row vertical panel — "⏺ RECORD" (dark grey `#333333`) above "📷 SCREENSHOT" (blue `#0066CC`) — pinned `TOP | END`, `x=8, y=200`. Both rows are `44dp` tall, black `#CC000000`-tinted panel background, `4dp` padding.
- **Disappears when:** the accessibility engine detects the foreground app leave the payment-app allow-list, or the service is destroyed.
- **Animation:** none. `WindowManager.addView`/`removeView` — an instant pop-in/pop-out, no fade or slide in either direction.
- **Screen occupied:** ~150×92dp corner widget; expands to a second `150dp`-wide panel (`RECORD` mode: 4 field rows showing masked Account/IFSC/Name/Amount as they're captured) positioned directly below at `y=330` while recording is active.
- **Floating button / drag:** yes — both the RECORD and SCREENSHOT rows are wrapped in `DraggableTouchListener`, a real drag implementation (10px move threshold to distinguish drag from tap, <300ms tap window). **No bounds clamping** — the panel can be dragged fully or partially off-screen with nothing preventing it. No snap-to-edge, no fling/inertia — raw 1:1 finger tracking only.
- **Permission flow:** requires `SYSTEM_ALERT_WINDOW` (requested from `MainActivity.ensureOverlayPermission()`) *and*, separately, a one-time `MediaProjection` screen-capture consent (the "Enable screenshot capture" Settings button) before the SCREENSHOT button will actually do anything — tapping it before consent is granted just shows a 3-second feedback toast ("Enable screenshot permission").
- **Notification interaction:** none directly — screenshot capture success/failure surfaces via the same in-overlay feedback toast (`showFeedback`), a small black/white pill, `TOP | CENTER, y=100`, auto-dismissing after 3s. Not a system notification at all.

## 3.2 `PaymentOverlayService` — fully-automatic capture UI

Three distinct floating elements, none of which are draggable (`FLAG_NOT_TOUCHABLE` on the badge and purpose panel; the success card has two real buttons but the card itself doesn't move):

1. **Passive badge** — "👁 PaymentBot • \<AppName>", green-on-black pill, `TOP | START, x=16, y=40`. Shown the entire time a payment app is foregrounded; purely informational.
2. **Success notification card** — appears the instant an outgoing-payment success screen is detected and parsed. `650dp` wide, `BOTTOM | CENTER, y=80`, black `#EE000000` card: "✅ Payment Captured!" title, amount+recipient+app line, UTR line if present, "Add Purpose" + "✕ Dismiss" buttons. **Auto-dismisses after 8 seconds** if untouched.
3. **Purpose picker** — opened from "Add Purpose": `700dp` wide, same position, 7 stacked category buttons (Volunteer Payment / Field Work / Teaching / Transport / Medical Aid / Food Supply / Other) + "Skip".

- **Animation:** none, same as `OverlayService` — instant add/remove.
- **Notification interaction:** entirely separate from the system notification tray — these are `WindowManager` overlays, not `NotificationCompat` notifications, despite visually resembling a notification card.

## 3.3 Problems, taken together

- **Two different visual systems for what is conceptually one feature** ("something happened while you were in a payment app") — different corner radii (none, actually — neither uses `GradientDrawable` corner rounding at all, both are hard-edged rectangles), different opacity values (`CC`/`EE`/`EE` used inconsistently), different widths chosen ad hoc (150/650/700dp), no shared component.
- **Zero entrance/exit animation anywhere in the overlay system** — every single one of these six overlay views (floating button, recording panel, feedback toast, badge, success card, purpose picker) pops instantly. This is the single most noticeable "unfinished" visual signal in the whole app when actually watching it run.
- **No drag bounds** on the one overlay that IS draggable — can be lost off-screen.
- **Auto-dismiss timing is inconsistent** with no stated reasoning (3s feedback toast, 8s success card, and the badge/recording panel never auto-dismiss at all).

## 3.4 Suggested redesign

- **Unify into one `PaymentOverlay` component family** sharing a single rounded-card style (12dp corners, consistent `Scrim`/elevation via a subtle shadow rather than flat opacity), the app's real color tokens (Section 12), and one animation contract: **150ms fade+scale-in, 150ms fade-out**, applied uniformly.
- **Snap-to-edge + bounds clamping** on the draggable floating button — never allow it fully off-screen; snap to the nearest edge on release (a very common floating-action pattern, e.g. Facebook Messenger's chat heads).
- **Route the success/failure confirmation through a real system notification** *in addition to* (not instead of) the in-context overlay card — right now, if the trader isn't looking at the phone screen at the exact moment a payment is auto-captured, there is no record of it having happened beyond the Logs tab. A notification gives it persistence.
- **Consistent auto-dismiss**: badge stays for the app-foreground duration (correct, keep), feedback/confirmation cards standardize to a single duration (recommend 5s, with a manual dismiss always available — never force 8s on something the user might want to act on for longer, like Add Purpose).

---

# 4. Dashboard (Home tab redesign)

## 4.1 Current state

**Widgets:** none. **Cards:** none. **Information shown:** a static string ("Working") and one button. This is, functionally, a splash-screen-after-the-splash-screen, not a dashboard.

## 4.2 What a premium dashboard needs — and what it needs from the backend

The APK is device-local; almost everything meaningful about "is this trader's setup healthy right now" lives server-side (order state, account health, routing). A real dashboard means the app finally becoming a **read client** of the trader panel's own data — today it's write-only (it posts capture events, it never reads order/account state back). This is the single largest net-new piece of scope in this whole spec, and it should be Phase 1 (see Section 18) precisely because everything else (Live Orders, Account Management) depends on the same new read-API work.

### Large cards (top of screen, full-width or half-width pair)

| Card | Content | Data source |
|---|---|---|
| **Today's volume** | ₹ total processed today, small trend vs. yesterday | New: order aggregate endpoint, scoped to this device's trader |
| **Capture health** | The 3-state indicator this app *already computes* (`Active` / `Not capturing` / `Permission needed` — built in the notification-listener reliability pass) promoted from a small top-bar badge to a full card with the actual reason and a fix-it action | Already exists on-device (`ListenerHealthStore`) — just needs a bigger home |

### Small cards / stat row (2–4 across)

- **Success rate** (today) — settled ÷ (settled + failed/expired), as a ring or simple percentage
- **Pending orders** — count currently `under_review`/`claimed_paid` and awaiting this device's confirmation
- **Device status** — online/offline (existing heartbeat signal) + last-seen
- **Pool status** — how many payment accounts on this device are active vs. paused

### Health indicators

- Device online/offline (exists: `HeartbeatService` + server `isOnline()`)
- Notification-listener capturing (exists: Section 4's capture-health card)
- SMS permission granted (exists: `checkSmsPermissionHealth`, currently notification-only — surface it here too)
- Battery-optimization exemption still granted (checkable live via `PowerManager.isIgnoringBatteryOptimizations` — not currently monitored post-onboarding at all; a user can re-enable battery optimization for the app weeks later with zero warning)

### Recent orders (list, 3–5 rows, "View all" → Live Orders screen)

Compact rows: amount, status pill, relative time, UPI/account used.

### Quick actions

- Turn payment mode on/off (the one thing Home already does — keep, but move to a smaller persistent control now that the screen has real content)
- Jump to Live Orders
- Jump to Notifications
- Jump to Support

## 4.3 Layout suggestion

```
┌─────────────────────────────────────┐
│ Top bar (device name, status badge)  │  ← already exists
├─────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐     │
│ │ Today's      │ │ Capture      │     │  large cards, 2-up
│ │ volume       │ │ health       │     │
│ └─────────────┘ └─────────────┘     │
│ ┌──────┐┌──────┐┌──────┐┌──────┐   │
│ │Success││Pending││Device││ Pool │   │  small stat row, 4-up
│ │ rate  ││orders ││status││status│   │  (2x2 on small phones)
│ └──────┘└──────┘└──────┘└──────┘   │
│ Recent orders ───────────────  ▸    │
│  ₹500  •  Settled  •  2m ago        │
│  ₹1,200 • Under review • 8m ago     │
│  ₹300  •  Settled  •  14m ago       │
├─────────────────────────────────────┤
│ [Home] [Live Orders] [Notif] [More]  │  ← bottom nav, expanded (Sec. 11)
└─────────────────────────────────────┘
```

---

# 5. Live Orders

**This screen does not exist today in any form.** The APK has no concept of an "order" at all in its own UI — orders live entirely in the `backend` MySQL database and are only ever visible in the *web* trader panel (`frontend/trader`'s Trades page). Designing this means bringing order visibility on-device for the first time.

## 5.1 Status set (from the real backend model)

Matches `backend/src/models/order.model.js`'s actual `STATUSES` exactly — do not invent new ones: `pending`, `checkout_open`, `claimed_paid`, `under_review`, `success`, `failed`, `rejected`, `disputed`, `cancelled`. For the trader-facing app, group these into the tabs the prompt asked for:

| Tab | Maps to real status(es) |
|---|---|
| Pending | `pending`, `checkout_open` |
| Verification | `claimed_paid`, `under_review` (this is where the trader's own Confirm action applies — see `traderConfirm` in `orderController.js`) |
| Completed | `success` |
| Cancelled | `cancelled`, `failed` |
| Expired | orders whose `expires_at` has passed while still `pending`/`checkout_open` |
| Rejected | `rejected` |
| Disputed | `disputed` |

## 5.2 Screen structure

- **Top:** search (by amount, UTR, or short order ID) + filter row (status chips, matching the tabs above, horizontally scrollable).
- **List:** order cards — amount (large, tabular-nums), status pill (colored per Section 12/14), UPI/account line, relative time, and — only for `Verification`-tab items — a prominent "Confirm" action (this already exists server-side as `POST /:id/trader-confirm`, just never surfaced on-device).
- **Bottom sheet** (tap a card): full order detail — UTR, customer ref, timestamps (created/claimed/confirmed), payment detail used, match tier/engine (`confirm_engine` — genuinely useful debug info for a trader wondering *why* something settled), and the Confirm/Dispute actions.
- **Swipe actions:** swipe-right on a `Verification`-tab card = quick-confirm (with an undo snackbar, never silent); swipe-left = view detail. Reserve full swipe-to-execute only for the lowest-risk, most-frequent action (confirm) — anything destructive (dispute) requires the bottom sheet, never a swipe.
- **Animations:** list-item entrance stagger on initial load (60–80ms per row, capped), a card that changes status (e.g. a live-updating `Pending` → `Success` via socket, since the trader panel already has real-time socket events for this) cross-fades its status pill rather than jump-cutting.
- **Empty states:** per-tab, not generic — "No pending orders right now" reads very differently from "No disputes — nothing needs attention," and the tone should reflect that (the empty Disputed tab is good news, say so).

## 5.3 Backend requirements

New for the app (all already exist server-side, just never called from `apk/`): `GET /api/orders` (role-scoped, already returns exactly this trader's orders), `POST /:id/trader-confirm`, real-time socket events (`order:claimed_paid`, `order:confirmed`, `order:completed` — already emitted via `emitToTrader`, the app just isn't a socket client today).

---

# 6. Account Management

**Also does not exist on-device today.** Payment-account management (UPI/bank/QR, capacity, limits) lives entirely in the trader web panel (`Offers.jsx`). The APK only ever *pairs* a device to accounts server-side — it never displays them.

## 6.1 What to surface

Given the phone *is* the capture device for these accounts, a read-first (not necessarily full-edit) view is the right initial scope:

- **Account list**, grouped by provider (the trader panel already solved provider-grouping/canonicalization this session — reuse the same canonical grouping logic, don't re-derive it)
- Per account: **UPI ID** (or bank details), **connection type** (APK relay vs. Web Login — this app only cares about the APK ones, since it's the receiver), **status** (live / paused / disconnected, with the *reason* — `statusReason` already models `manual`/`otp_required`/`session_expired`), **today's used vs. daily limit** as a progress bar, **success rate**, **online/offline** for this specific account's device pairing.
- **Capacity/limits**: `minAmount`/`maxAmount` per transaction, `maxPerHour`/`maxPerDay`/`maxPerWeek`/`maxPerMonth` counts, optional amount caps — all already modeled server-side (`payment_details` table / `Account` schema), none currently visible to the trader from their phone.

## 6.2 Layout

Card per account: provider icon + UPI ID, status pill, a slim progress bar (today's used / daily limit), success-rate chip, tap → detail sheet with the full limit breakdown. A toggle to pause/resume the account inline (already a real backend action: `is_active_detail`), since a trader stepping away is a very plausible one-tap phone action.

## 6.3 Scope note

Full account *creation*/editing should stay on the web trader panel for now (it involves encrypted credential entry for Web Login accounts — not something to build twice, and not something to do on a phone keyboard by choice). The app's job here is **visibility + the one or two actions (pause/resume) a trader genuinely needs in-the-moment while away from a desktop.**

---

# 7. Notifications

## 7.1 Current state — system notifications, no in-app center

Everything today is a one-off `NotificationCompat.Builder` call, scattered across 4 files, with **3 notification channels covering 5 distinct notification purposes**:

| Channel | ID | Purpose | Persistent? |
|---|---|---|---|
| `PaymentBot` | 1001 | "💳 PaymentBot Active" (`KeepAliveService`) | Yes, ongoing |
| `PaymentBot` (same channel) | 1002 | "⚠ needs re-pairing" (`HeartbeatService`) | No |
| `PaymentBot` (same channel) | **1003** | "SMS permission needed" (`HeartbeatService`) | No |
| `PaymentBotCapture` | 4200 | MediaProjection foreground-service notice (`OverlayService`) | Yes, while capturing |
| `PaymentBotUpdates` | **1003** | "Update available — tap to install" (`ApkDownloadWorker`) | No |

**Concrete bug worth flagging directly:** the SMS-permission-needed notification and the update-available notification **share notification ID 1003**. Whichever posts second silently replaces the other in the tray — a trader could dismiss what they think is the update prompt and actually be dismissing an unresolved SMS-permission problem, or vice versa. This is exactly the kind of thing a real notification center (with distinct, listed entries) makes impossible instead of relying on every future call site remembering a mental ID registry.

There is **no in-app list of past notifications at all** — once a system notification is dismissed or the tray is cleared, there's no record anywhere in the app that it ever fired.

## 7.2 Redesign: an actual Notification Center tab/screen

- **Priority**: surface `Critical` (device offline >X min, permission revoked, listener disconnected) above `Info` (update available, capture confirmed) — don't let a "your SMS access was revoked" sit at the same visual weight as "new version available."
- **Unread state**: a real badge count on the bottom-nav icon, cleared on open (not on dismiss-from-tray — those are two different actions today, unify them).
- **Categories**, matching what the app already generates events for: **System** (repair/rebind, permission health), **Payment** (order confirmed/completed), **Device** (paired/unpaired, online/offline transitions), **Order** (claimed_paid → needs your confirm), **Warning** (battery optimization re-enabled, listener degraded).
- **Filter + search** by the same categories.
- Every entry that has a real action today (tap-to-install update, tap-to-reopen-app for permission) keeps that action when tapped from the in-app list, not just from the system tray.

## 7.3 Channel cleanup (design-level; implementation is a later phase)

Give **each distinct purpose its own channel** so a trader can independently mute what they don't want (e.g. mute "Update available" without muting "needs re-pairing"): `PaymentBot.Persistent` (ongoing "Active"), `PaymentBot.Alerts` (re-pairing, SMS-permission, listener-degraded — user-critical, should stay loud), `PaymentBot.Capture` (unchanged, low-importance foreground-service notice), `PaymentBot.Updates` (app updates). And, obviously, give the update-available notification its own unique ID.

---

# 8. Profile

**Does not exist as a dedicated screen today** — device identity is buried in Settings' flat list (Section 2/9). A real Profile screen separates *who/what this is* from *how it behaves*.

## 8.1 Content

- **Header**: device name (editable inline — the rename flow already exists server-side via `PATCH /api/apk/devices/:id`, just needs a UI entry point beyond the one-time SetDeviceNameActivity), device model, paired-since date.
- **Device**: model, Android version, app version (real `BuildConfig.VERSION_NAME`, not the current hardcoded string), Android ID (kept, useful for support debugging).
- **License / Plan**: license key (masked, as today), pairing status, — if the platform ever tiers traders/devices, this is the natural home for it (currently no plan concept exists server-side; don't invent one, just reserve the slot).
- **Logout**: keep exactly as built (confirm dialog → `RegistrationManager.clearRegistration()` → back to pairing) — this was purpose-built recently and is correct.
- **Support**: a real contact path (currently none exists anywhere in the app — no support email, no chat link, nothing). Even a `mailto:`/WhatsApp deep link is better than the current zero.
- **FAQ**: static content, on-device (no backend dependency) — common questions like "why did capture stop," "what does 'not capturing' mean," directly answering the exact failure modes this app's own reliability work has been fixing all week.
- **About**: version, build date, links to terms/privacy if they exist elsewhere in the product.

---

# 9. Settings

## 9.1 Keep (already built, just needs to move into sections below)

Device name · Server URL (display-only) · License key (masked) · App version · Android ID · Enable screenshot capture · Download logs · Export logs as .txt · Log out / deactivate device.

## 9.2 Net-new (none of this exists today)

- **Appearance**: Dark mode (system/light/dark — the whole app is hardcoded light today, zero dark-mode support anywhere, including the overlay system's own already-dark aesthetic, which is at least accidentally dark-mode-ready).
- **Notifications**: per-category toggles matching Section 7's categories, plus sound/haptic on-off.
- **Language**: not currently localized at all — every string in the codebase is a hardcoded English literal (no `strings.xml` usage beyond the app name). Real localization is a larger effort than a toggle; scope this as "reserve the setting, ship English-only first, extract strings as a prerequisite" rather than promising translated content in an early phase.
- **Animation**: a "reduce motion" toggle, honored by whatever motion system Section 15 introduces — cheap to add if the motion system is built with this in mind from the start, expensive to retrofit.
- **Overlay settings**: let the trader choose overlay position/corner (today hardcoded per-overlay, inconsistent even with each other — see Section 3), and a master "disable floating overlays" switch for a trader who finds them intrusive (capture keeps working either way — the overlay is a convenience layer, not the capture mechanism itself).
- **Developer mode**: hidden behind a tap-version-7-times gesture (standard Android pattern), surfacing the queue-depth / parse-failure counters that (per the concurrent offline-first work already in this codebase) currently sit permanently visible in main Settings — those are genuinely developer/support diagnostics, not something every trader needs staring at them by default.

## 9.3 Structure

Group into labeled sections (Account, Appearance, Notifications, Capture & Overlay, Data & Storage, About), each a card with icon-leading list rows — not one undifferentiated column like today.

---

# 10. Permission Wizard

The wizard's **logic** is already the most sophisticated part of this app (6-OEM detection with per-manufacturer deep links and documented fallback behavior — see `PermissionActivity.Oem`). The **presentation** hasn't kept pace with the logic. Ideal UX, page by page:

| Step | Today | Ideal |
|---|---|---|
| Overlay/Notification | Emoji + title + description + button | Same content, + progress dots (already built in the dead `OnboardingActivity` — reuse it), + a short "why" reframed around outcome ("so MaxPay can read payment confirmations the instant they arrive") rather than permission-speak |
| Battery Optimization | Same pattern | Add a one-line visual of *why this matters specifically for a 24/7 background monitor* — a simple before/after ("without this: capture can silently stop") rather than assuming the user already understands OEM battery-killing behavior |
| Accessibility | *(Not currently a `PermissionActivity` page at all — `PaymentBotService`'s accessibility grant has no dedicated onboarding step, it's just assumed granted separately)* | Should get its own page in the wizard — it's one of the three capture engines and currently has zero onboarding presence |
| Auto Start (manufacturer-specific) | Dense paragraph, one generic button | Numbered steps, app-name highlighted inline, and — for the two profiles (Samsung, ColorOS) with no specific deep link — visually distinguish "we're taking you to a general settings screen, you'll need to find the toggle yourself" from the other four profiles' "we're taking you straight to the right screen" |
| Background / manufacturer-specific | Covered by Auto Start step above | — |

**General wizard-level recommendation**: a persistent, tappable "why do you need this?" affordance on every page (not just denser body text) — this is a legitimate trust concern for an app requesting notification/SMS/accessibility access, and the current copy doesn't address it directly.

---

# 11. Bottom Navigation vs Sidebar

**Recommendation: Bottom Navigation, expanded from 3 to 5 tabs**, using the real Material `BottomNavigationView` (the `material:1.11.0` dependency is already in `build.gradle.kts` and completely unused — the current 3-tab bar is a hand-rolled `LinearLayout` of `TextView`s).

**Why bottom nav, not a drawer:**
- This is a **task-focused, single-persona app** — one trader, one device, a small fixed set of top-level destinations (Home, Live Orders, Notifications, Logs, Settings/Profile). A drawer earns its cost when there are many peer-level destinations or nested sub-sections to organize; 5 flat destinations is exactly bottom-nav's sweet spot, not a drawer's.
- **Thumb reach** matters more here than on the web panels — this is a phone held one-handed while a trader is doing something else (unlike the desktop trader panel, where a sidebar is the right call because screen width is abundant and mouse reach is free).
- Consistency with **Android platform convention** — bottom nav is what every payments/banking-adjacent app on Android uses (GPay, PhonePe, the very apps this tool watches); a drawer would feel like a step backward in familiarity for this exact user.

**Why not tabs (top) or hybrid:** top tabs are for switching *views of the same content* (e.g. Pending/Completed within Live Orders — which IS the right place for tabs, see Section 5), not for top-level app navigation. A hybrid (bottom nav + drawer) is justified only once destination count exceeds ~5–6, which this app isn't close to even after the full redesign.

**Suggested 5 tabs**: Home · Live Orders · Notifications (badge) · Logs · Profile (with Settings nested inside Profile rather than as its own 6th tab — Settings is a destination you configure once, not one you visit as often as the other four).

---

# 12. Color System

**Per your instruction: this section does not propose new branding.** The three web panels each already carry a real, distinct accent (confirmed directly from their CSS token files):

| Panel | Accent (light) | Accent (dark) |
|---|---|---|
| Trader (`frontend/trader`) | `#4f46e5` (indigo) | `#4f46e5` |
| Merchant (`frontend/merchant`) | `#15803d` (green) | `#34d399` |
| Admin (`frontend/admin`) | `#e5484d` (red) | `#fb7185` |

**The APK should adopt the Trader panel's palette specifically** — not invent a fourth one, and not average the three. The device pairs *to* a trader, appears *in* the trader panel's device list, and every screen this spec proposes (Live Orders, Account Management, Dashboard) mirrors trader-panel concepts directly. The app is, functionally, the trader panel's mobile arm.

**Concrete finding**: the app's *current* palette (`colors.xml`'s `blue_primary #1565C0` / `green_primary #1B5E3B`, plus per-file inline hex duplicating those same two values across `MainActivity`, `PermissionActivity`, `RegistrationActivity`, `SetDeviceNameActivity`) matches **none** of the three real brand accents. It's a fourth, undocumented color scheme that exists only because the app was never connected to the shared design language in the first place. Adopting Trader's indigo isn't a redesign of branding — it's *finally applying* branding that already exists elsewhere in the product.

**Token set to adopt directly** (same names, same values as `frontend/trader/src/index.css`, so a future shared-token file could serve both):

```
Light                                    Dark
--bg:          #f6f7fb                   #0c111d
--card:        #ffffff                   #111827
--surface2:    #f9fafb                   #182230
--cardborder:  #e4e7ec                   #293242
--text:        #101828                   #f9fafb
--muted:       #667085                   #98a2b3
--subtle:      #98a2b3                   #667085
--accent:      #4f46e5                   #4f46e5
--accent-soft: rgba(79,70,229,.08)       rgba(79,70,229,.16)
```

**Semantic colors** (status pills, health indicators — kept separate from the accent, per the dataviz/design-system principle that semantic meaning shouldn't compete with brand color): success green, warning amber (the app already independently invented a reasonable amber — `#B26A00` on `#FFF3E0` — for the "Not capturing" badge; keep that pairing, it's sound), error red, info blue — pick one consistent set and reuse across order-status pills, health cards, and notification priority, rather than each screen inventing its own (which is exactly what's happened so far: the "Active" badge, the debit-SMS red cards, and the repair notification all use unrelated reds/greens today).

---

# 13. Typography

The web panels standardize on **Inter** at a 14px base (`frontend/trader/src/index.css`). Android should mirror this with `Inter` as a bundled variable font (or the closest Google Fonts static weights: Regular/Medium/SemiBold/Bold) rather than the system default `Typeface.DEFAULT`/`Typeface.DEFAULT_BOLD` the app uses everywhere today — this alone is a large share of why the app doesn't visually read as "the same product" as the web panels.

| Role | Size (sp) | Weight | Notes |
|---|---|---|---|
| Heading (screen titles) | 22–24 | Bold (700) | e.g. "Live Orders", "Settings" |
| Subtitle (section headers) | 16–17 | SemiBold (600) | e.g. "Recent orders", "Appearance" |
| Body | 14–15 | Regular (400) | Default reading text, matches web's 14px base |
| Caption (metadata, timestamps) | 12 | Regular (400), `--muted` color | Relative time, helper text |
| Button | 15–16 | SemiBold (600) | No `ALL CAPS` (the app already correctly sets `setAllCaps(false)` everywhere — keep this) |
| Status (pills/badges) | 11–12 | Bold (700), tight letter-spacing | Order status, health badges |
| Table / tabular data (amounts) | 15–16 | Medium (500), tabular figures | Use a monospace-numeral feature or a numeric-friendly weight so amount columns align — the Logs feed already uses `Typeface.MONOSPACE` for body text, which is the wrong instinct (it should be reserved for genuinely code-like content, not currency) |

---

# 14. Components

A shared component library is the actual prerequisite for most of this spec — without it, every screen redesign re-invents its own card/button/badge, which is the exact problem this whole audit keeps surfacing.

- **Cards**: single elevation system (a soft shadow, not the flat-color overlay cards used in Logs today), 12–14dp corner radius (matches the web panels' `14px` card radius exactly), consistent internal padding.
- **Buttons**: Primary (filled, accent), Secondary (outline/text, accent-colored — `PermissionActivity`'s page-4 "Open settings" link is already close to this, formalize it), Destructive (red, for Logout/disconnect actions — already correctly used for Logout).
- **Inputs**: replace the underline-only text fields (`RegistrationActivity`, `SetDeviceNameActivity`) with a real Material `TextInputLayout` (outlined or filled), with proper error-state styling instead of a separate status `TextView`.
- **Bottom sheets**: net-new — needed for Live Orders' detail view (Section 5) and Account Management's limit breakdown (Section 6).
- **Dialogs**: keep using `AlertDialog` for genuinely blocking confirmations (Logout already does this correctly) — don't over-use bottom sheets where a real yes/no dialog is clearer.
- **Snackbars**: net-new — replace several current `Toast` uses (which are dismiss-only, no action) with snackbars carrying an action where one makes sense (e.g. "Order confirmed — Undo").
- **Progress**: linear progress bars for capacity/limit usage (Account Management), a real Material circular spinner for loading states (currently only the Splash screen has any spinner at all).
- **Charts**: net-new for Dashboard — keep genuinely minimal (a small trend sparkline on the "Today's volume" card is enough; this is a phone screen, not the analytics-heavy admin panel).
- **Status badges**: standardize one badge component (rounded pill, colored bg+text pair from the semantic palette in Section 12) used everywhere a status currently renders as ad hoc colored text (order status, device online/offline, capture health, debit-SMS verified/unverified).
- **Icons**: the app currently uses **emoji as icons throughout** (🔔💳🔋🚀👁📷⏺✅✕) — charming in the onboarding wizard, inconsistent and unprofessional in system chrome (notification small icons already correctly use real `android.R.drawable` vector icons — extend that standard to in-app iconography too, via Material Symbols).

---

# 15. Motion

**Current state: there is effectively no intentional motion in this app.** Every screen transition is the OS default Activity transition; every overlay pops in/out instantly; the only two `Animation`s in the entire codebase are `OnboardingActivity`'s slide-in/slide-out (the unused flow) and `ApkDownloadWorker`'s system-managed download/notification behavior.

- **Screen transitions**: adopt Android's Material shared-axis or fade-through transitions for top-level tab switches (currently instant `VISIBLE`/`GONE` toggling — even a 150ms crossfade would read as dramatically more polished for near-zero cost).
- **Loading**: skeleton screens (Section 17) rather than blank-then-pop content, once real network data exists to load (Dashboard, Live Orders).
- **Refresh**: standard `SwipeRefreshLayout` pull-to-refresh on list screens (Live Orders, Logs) — doesn't exist anywhere today.
- **Success/failure**: a consistent micro-animation for "order confirmed" (a brief checkmark scale-in on the status pill) vs. "action failed" (a shake or red flash) — currently all feedback is either a `Toast` or nothing.
- **Overlay animation**: per Section 3.4 — 150ms fade+scale for every overlay element, uniformly.
- **Respect "reduce motion"**: once Section 9's animation toggle exists, every motion above should check it and fall back to instant/near-instant transitions.

---

# 16. Responsive

- **Phone (standard, ~360–420dp width)**: primary target, everything above is designed for this first.
- **Small phone (<360dp)**: the 4-up stat row (Section 4) should collapse to 2×2 below a defined width breakpoint rather than compressing 4 cards into an unreadably narrow row — the app's current fixed-`dp()` hand-built layouts don't have any breakpoint logic at all today, this needs to be designed in from the start with `ConstraintLayout` guidelines or ratio-based flex, not more hardcoded `dp()` math.
- **Tablet**: the single-column phone layout should gain a second column at a `sw600dp` breakpoint (Android's standard tablet qualifier) — e.g. Dashboard's stat cards flow into a genuine grid instead of a single vertical stack, Live Orders gains a master-detail split (list left, detail right, replacing the bottom sheet) rather than stretching a phone layout uncomfortably wide.
- **Landscape**: at minimum, the bottom nav + content should not force awkward vertical scrolling for content that could reflow horizontally (stat cards side-by-side rather than stacked). Given this is fundamentally a background-service phone app, landscape is a low-priority but not-zero case (a trader might genuinely rotate to read a wide log line).
- **Foldables**: no special handling needed at launch scope, but avoid layout choices (fixed pixel overlay widths, hardcoded absolute positioning) that would break outright on a fold/unfold — the tablet breakpoint work above happens to cover most of this for free, since a foldable's unfolded state is effectively a small tablet.

---

# 17. Performance

- **Skeleton loading**: once Dashboard/Live Orders/Account Management pull real network data (all three are net-new — see Section 18 phasing), every one of them needs a skeleton state from day one, not retrofitted later — this app has literally never had a network-loading UI state before (every current screen either reads instantly from local prefs/SQLite or is a one-shot form submission with no list to skeleton).
- **Lazy loading**: Live Orders' list should paginate (the backend `GET /api/orders` already supports `page`/`limit` — just needs an app-side infinite-scroll or "load more" to use it) rather than fetching everything at once.
- **Caching**: Dashboard summary data should cache-then-revalidate (show last-known stats instantly on open, refresh in the background) rather than blank-then-load every time — especially relevant since this is a background-service-heavy app that may be reopened many times a day.
- **Offline mode**: the app already has a genuinely strong offline story on the *write* side (the Room-backed `EventQueue`/`EventUploadWorker` pipeline queues every capture durably). The *read* side (Dashboard, Live Orders, Account Management, once built) needs the same philosophy applied in reverse — cache the last successful fetch and show it with a clear "offline — showing cached data from [time]" banner rather than a blank error screen when the phone has no connectivity, which is a routine state for a field device, not an edge case.
- **Image optimization**: minimal image usage expected in this app (icon-driven, not photo-driven), but if provider logos (Paytm/PhonePe/GPay icons for Account Management, Section 6) are added, serve them as vector drawables bundled in-app rather than fetched network images — there's no reason to pay a network round-trip for a fixed, small icon set.

---

# 18. Final Deliverable — Phased Redesign Plan

**Prioritization principle**: fix the foundation (design system + component library) before anything else, then build net-new screens in the order the *trader* would actually feel the absence of them — visibility into what the device is doing (Dashboard, Notifications) before deeper management tooling (Account Management), and cosmetic/settings polish last.

## Phase 1 — Foundation (no new screens, makes every later phase cheaper)
- Extract a real design-token system (Section 12/13) — one source of truth for color/type, referenced everywhere instead of per-file hex literals.
- Build the shared component library (Section 14): Card, Button (3 variants), TextInput, Badge, Snackbar, BottomSheet, Dialog.
- Decide and migrate the UI construction approach — either standardize on well-structured XML layouts + view binding, or adopt Jetpack Compose outright, rather than continuing hand-built `LinearLayout` trees. This is the single change that makes every other phase faster and more consistent.
- Delete the two confirmed-dead artifacts (`OnboardingActivity` — after porting its progress-dot pattern into the live `PermissionActivity`, per Section 10 — and `activity_main.xml`), or consciously decide to actually wire `OnboardingActivity` in and delete `PermissionActivity`'s duplicate flow instead. Either is fine; having both unreconciled is not.
- Fix the two concrete bugs surfaced in this audit as part of the same pass: the `1003` notification-ID collision (Section 7.1) and `App version` row's hardcoded string vs. real `BuildConfig.VERSION_NAME` (Section 2/8).

## Phase 2 — Visibility (the biggest experience gap)
- Dashboard / Home redesign (Section 4) — requires the new read-API work (device/order/account summary endpoints) that Phases 3–4 also depend on, so build that API surface once, here.
- Notification Center (Section 7) — in-app list + channel cleanup.
- Permission Wizard polish (Section 10) — cheap relative to the above, high perceived-quality payoff, do alongside.

## Phase 3 — Management
- Live Orders (Section 5) — full screen, states, actions.
- Account Management (Section 6) — read-first scope as defined above.
- Bottom nav migration to real `BottomNavigationView`, 5-tab structure (Section 11).

## Phase 4 — Depth & polish
- Profile (Section 8) — including support/FAQ content.
- Settings expansion (Section 9) — dark mode, notification prefs, overlay settings, developer mode.
- Motion system (Section 15) end-to-end, applied retroactively to Phases 2–3's screens.
- Overlay system unification (Section 3.4).
- Responsive breakpoints (Section 16) and performance work (Section 17) — validate against everything built in Phases 2–3, not designed in isolation.

**Nothing in this document has been coded.** This is the specification to review, adjust, and prioritize before any implementation work begins.
