# Max Pay — Full Payment Flow Architecture

**Scope:** the customer Checkout frontend, both order-creation paths, the trader/UPI/device assignment engine, the Android detection APK, the payment-matching engine, screenshot/proof handling, and auto-confirmation vs. manual review — traced end to end to real code and real database effects.
**Method:** every Checkout source file was read directly. The Android APK (27 Java files, manifest, build config) and the `ngo-backend` service (all of `src/`) were each traced in full by a dedicated read-only research pass; their findings are incorporated here with the same file/line rigor as everything read directly, and are marked `[APK agent]` / `[ngo-backend agent]` where a claim rests on that pass rather than a direct read in this conversation. No source file was modified, no code was written.
**Rule followed throughout:** nothing here is trusted from a file name, button label, comment, or UI string without being traced to the actual code path — several of this document's most important findings exist specifically *because* a comment or label turned out to be wrong or stale.

---

## 1. Executive Summary

Max Pay is not one payment-confirmation system. It is **two independently-built systems that happen to share one order record**, connected by a single, thin, unauthenticated, best-effort HTTP callback — and the seam between them is where most of this document's critical findings live.

**System A — the MySQL backend (`backend/`).** A genuinely well-engineered "Order System v2": a real routing/assignment engine with DB-level race protection, a real weighted-confidence auto-confirmation engine (`smartMerge.js`) with a real settlement service that correctly moves trader/merchant USDT balances, and a real HMAC-signed merchant webhook system. It also contains a *complete, parallel* payment-detection ingestion pipeline (`deviceController.js`, `paymentController.js`, four "engines": SMS/notification/screen/manual) built to feed that confidence engine.

**System B — `ngo-backend` (MongoDB, a separate Node service).** This is where the real Android APK actually reports to. Its own comment trail confirms it: `backend/src/models/paymentDetail.model.js` explicitly documents that the MySQL `Smartphone` model "which nothing real populates" was superseded by `ngo_device_id`, a pointer to a Mongo `Device._id` — and the `ngo-backend` research pass confirmed every Android detection endpoint (`/api/apk/register-device`, `/heartbeat`, `/event`, `/debit-sms`, `/overlay-capture`, `/outgoing-payment`, `/screenshot`) lives here, not in the MySQL backend. This service has its own matching engine, its own hash-chained ledger, its own payout-verification pipeline — and it is architecturally a **donation/NGO-matching product** (its core domain models are literally `NGO` and `Campaign`) that has been repurposed to also serve as Max Pay's payment-verification backend, with the MySQL `Merchant.id` reused as a Mongo `NGO._id`.

**The consequence, stated plainly:** System A's detection pipeline (Engines 1–3 + `smartMerge.js`) is real, correct code that the real Android app **never calls**. System B's detection pipeline is what the real app calls, but its matching engine is far cruder than System A's (amount + time-window only — no UTR, no account/UPI-ID gate, no confidence score) and its one bridge back into System A (`notifyP2PBackend` → `POST /orders/verify-payment`) **bypasses System A's real settlement function entirely** — the order flips to `success` for reporting purposes, but the merchant's balance is never credited and no merchant webhook ever fires for that order. A second, independently-confirmed gap compounds this: the checkout page's own "I Paid" flow (`claimPaid` → ngo-backend's `POST /api/checkout/verify`) **never triggers ngo-backend's matching engine at all** — so for any trader account whose detection relies on the Paytm-dashboard scraper rather than a physical APK device, a customer's claimed payment may have no code path that ever calls `notifyP2PBackend` in the first place.

**What this document is not:** a claim that nothing works. Individual pieces — the routing engine's same-amount DB-level lock, the checkout page's status machine, `smartMerge`'s confidence math, `ledgerService`'s hash-chained integrity — are each genuinely well-built. The problem is the seam, not any one side of it.

---

## 2. Complete System Diagram

```
┌─────────────┐        ┌──────────────────────────────────────────────────────────┐
│  Merchant   │───(A)──▶  POST /api/orders/create  (API key)                       │
│  (API/App)  │        │  POST /api/merchant/orders (JWT, dashboard "Create Order") │
└─────────────┘        │              ↓ orderService.createOrder                   │
                        │      routingEngine.findAvailableTrader (trader+account)  │
                        │              ↓                                          │
                        │        Order row created (status: pending)               │  MYSQL BACKEND
                        │              ↓                                          │  ("System A")
┌─────────────┐        │      checkout_url returned to merchant                    │
│  Customer   │◀───────┼──────────────┘                                            │
│  (Checkout) │───(B)──▶  GET /orders/:id/checkout, PUT checkout-opened,           │
│  React SPA  │        │  POST claim-paid, socket subscribe:order                  │
└──────┬──────┘        │              ↓                                          │
       │                │   claimPaid best-effort POSTs to ngo-backend ───────────┼──┐
       │                │   /api/checkout/verify                                  │  │
       │                └──────────────────────────────────────────────────────────┘  │
       │                                                                              │
       │  (socket: order:confirmed/expired/cancelled/paid only — NOT                   │
       │   rejected/disputed/completed — see §5, §31)                                  │
       │                                                                              ▼
┌──────┴──────┐        ┌──────────────────────────────────────────────────────────────┐
│  Trader's   │───(C)──▶  POST /api/apk/register-device, /heartbeat (4s),             │
│  Android    │        │  /event (SMS/notif/screen), /debit-sms, /outgoing-payment,   │  NGO-BACKEND
│  APK        │        │  /overlay-capture, /screenshot                               │  (MongoDB,
│  ("MaxPay") │        │              ↓                                              │  "System B" —
└─────────────┘        │        RawEvent / DebitSMS / OverlayCapture / OutgoingPayment │  the REAL
                        │              ↓ (if category:PAYMENT)                        │  APK pipeline)
                        │        matchingEngine.checkMatch (amount + time window only) │
┌─────────────┐        │              ↓                                              │
│  Paytm       │◀──(D)─┼──  webScraper.js (Playwright) logs into Paytm dashboard,     │
│  merchant    │        │  polls every 60s, writes Transaction docs                   │
│  dashboard   │        └──────────────────────────────────────────────────────────────┘
└─────────────┘                       │
                                       │ if a pending Webhook (donor intent) matches
                                       ▼
                        ledgerService.createEntry (hash-chained Mongo Ledger)
                                       │
                                       ▼
                        notifyP2PBackend → POST {MySQL}/api/orders/verify-payment
                        (unauthenticated, best-effort, no retry)
                                       │
                                       ▼
                        MySQL orderController.verifyPayment: order.status = 'success'
                        directly — DOES NOT call balanceService.settleOrder (§28, critical bug)
                                       │
                                       ▼
                        Merchant balance UNCHANGED · no webhook fires for this path
```

**Parallel, independent path (real, correct, but never reached by the real APK):**
```
[a MySQL-registered device] → POST /api/device/sms|notification|screen (device-token auth)
        → paymentController.ingest → Transaction row → smartMerge.mergePaymentData
        → confidence ≥ 85 → smartMerge.confirmOrder → balanceService.settleOrder (CORRECT,
          full settlement) → webhookService.sendWebhook('payment.success')
```
This path is fully implemented and fully correct — it is simply orphaned, because nothing in the real Android app calls `POST /api/device/register` or any `POST /api/payment/*` endpoint (all confirmed by the APK agent's endpoint inventory in §16–18).

---

## 3. Project Structure

```
frontend/checkout/src/
├── App.jsx                 # renders <CheckoutPage/> — no router, no other routes at all
├── main.jsx
├── index.css                # "co-*" tokens, teal accent, light-only
├── pages/CheckoutPage.jsx   # 500 lines — the entire product: state machine, all 9 screens
├── components/UpiApps.jsx  # 4 static brand tiles (PhonePe/GPay/Paytm/BHIM) — decorative only
├── hooks/useOrderSocket.js  # anonymous per-order socket subscription
├── services/api.js          # fetch-based client: fetchOrder, fetchCheckout, claimPaid, cancelOrder, requestNewUpi
└── utils/
    ├── order.js              # UPI deep-link builder, timer formatter, demo-order fallback (unused in practice — see §14)
    └── i18n.js               # English + Hindi strings — Hindi is entirely unreachable (§14)

apk/app/src/main/
├── AndroidManifest.xml      # 4 services, 3 receivers, 6 activities, cleartext+backup enabled (§34)
├── res/xml/accessibility_config.xml
└── java/com/example/paymentbot/   # 27 files, ~5,600 lines — branded "MaxPay" in-app despite the package name
    ├── SplashActivity / PermissionActivity / RegistrationActivity / SetDeviceNameActivity / MainActivity
    ├── OnboardingActivity        # a SECOND, fully-built onboarding flow nothing in the live nav graph reaches — dead
    ├── BootReceiver / WatchdogReceiver / AlarmHelper / KeepAliveService   # keep-alive chain (§15)
    ├── HeartbeatService           # 4s loop — NOT restarted on boot (§15, real gap)
    ├── SMSReceiver / SMSData / DebitSMSData / BankSenderTags   # SMS detection (§16)
    ├── NotificationService        # NotificationListenerService — the endpoint the code itself says matters most (§17)
    ├── PaymentBotService           # AccessibilityService — REAL screen-text scraping (§18)
    ├── OverlayService / PaymentOverlayService / DraggableTouchListener  # floating UI + manual screenshot capture
    ├── PaymentParser / PaymentMerger / PaymentData             # device-side parsing + (unused-cross-engine) merge
    └── APIClient / RegistrationManager / Config / TimeFormatter

backend/src/                  # "System A" — see ADMIN_ARCHITECTURE.md / MERCHANT_ARCHITECTURE.md for full panel context
├── controllers/orderController.js, merchantController.js, deviceController.js, paymentController.js, adminController.js
├── services/orderService.js, routingEngine.js, smartMerge.js, balanceService.js, webhookService.js, upiService.js,
│            depositTypeChecker.js, orderIdGenerator.js, usageWindows.js, telegramService.js
├── jobs/orderExpiry.js, staleClaimSweep.js, heartbeatCheck.js, settlementJob.js
└── models/order.model.js, transaction.model.js, paymentDetail.model.js, smartphone.model.js, notificationLog.model.js, …

ngo-backend/src/               # "System B" — the real APK pipeline (MongoDB)
├── routes/apk.js, checkout.js, webhook.js, ngo.js, merchant.js, admin.js, public.js, auth.js
├── services/matchingEngine.js, ledgerService.js, webScraper.js, scraperEngine.js (mostly dead), payoutVerifier.js,
│            ngoService.js, SessionStore.js, proxyManager.js, authService.js
├── utils/hashChain.js, encryption.js, timeHelper.js
└── models/Device.js, RawEvent.js, DebitSMS.js, OverlayCapture.js, OutgoingPayment.js, Transaction.js, Webhook.js,
           Ledger.js, Payout.js, NGO.js, Campaign.js, Account.js, User.js
```

---

## 4. Checkout Routes and Pages

There is **no router** in the Checkout app — `App.jsx` renders exactly one component, `<CheckoutPage/>`, unconditionally. The "route" is entirely a query parameter: `getOrderIdFromUrl()` reads `?order=<id>` from `window.location.search` (`utils/order.js:25-31`). There is no `/success`, `/expired`, etc. — every state is a conditional render inside one component, driven by a local `step` state variable, not the URL. A page refresh always re-derives state from the backend (`fetchCheckout`), so refreshing is safe, but the browser's back/forward buttons do nothing meaningful (there's nothing to navigate between).

If `?order=` is absent, `orderId` is `null`/falsy, `useEffect` immediately sets `errorMsg:'No order ID found in URL'` and `step: ERROR` — there is no demo/mock order shown to a visitor who lands on the checkout with no order id, despite `utils/order.js` still exporting a `DEMO_ORDER`/`getOrder()` fallback (`order.js:7-46`) that **is never imported or called anywhere in `CheckoutPage.jsx`** — dead code left over from an earlier, backend-less version of this page.

---

## 5. Checkout Status Lifecycle

**Checkout's internal `STEP` enum** (`CheckoutPage.jsx:8-18`): `PAYMENT, PROCESSING, SUCCESS, EXPIRED, FAILED, REJECTED, DISPUTED, UNAVAILABLE, ERROR`.

**Backend `Order.STATUSES`** (`order.model.js:6`): `pending, checkout_open, claimed_paid, under_review, success, failed, rejected, disputed, cancelled`.

**Mapping** (`applyOrder`, `CheckoutPage.jsx:369-380`):

| Backend status | Checkout step | Notes |
|---|---|---|
| `success` | `SUCCESS` | |
| `failed` | `EXPIRED` | Deliberate: `failed` (system-timeout/reject-adjacent) reuses the "expired" copy — the `FAILED` step exists in the enum and has its own screen but **no code path ever sets it**; it is dead. |
| `rejected` | `REJECTED` | |
| `disputed` | `DISPUTED` | |
| `claimed_paid` / `under_review` | `PROCESSING` | |
| `pending` / `checkout_open` (with `hasUpi`) | `PAYMENT` | |
| `pending` / `checkout_open` (no `hasUpi`) | `UNAVAILABLE` | Should be rare — see §11 |
| `cancelled` | *(none)* | Not in the mapping at all — a cancelled order that somehow gets re-fetched would fall through to `UNAVAILABLE` via the function's final fallback, not a dedicated "you cancelled this" screen. |

**Real-time vs. what the socket actually carries — a confirmed mismatch.** `useOrderSocket.js` registers listeners for exactly four backend event names: `order:confirmed`, `order:expired`, `order:cancelled`, `order:paid` (`useOrderSocket.js:30-33`). `CheckoutPage.jsx`'s own socket callback (`CheckoutPage.jsx:424-431`) contains branches for `status === 'rejected'` and `status === 'disputed'` — **but no `order:rejected` or `order:disputed` listener exists to ever invoke those branches.** The backend does emit `emitToOrder(order.uuid, 'order:rejected', ...)` and `'order:disputed'` (admin reject/dispute actions, `adminController.js`), and separately `emitToOrder(order.uuid, 'order:completed', ...)` for the NGO-verification success path (`orderController.verifyPayment`) — **`order:completed` is also not listened for.** Net effect: a customer whose order is rejected, disputed, or auto-verified via the NGO path will **not** see the page update in real time; they will only find out on the next 3-second poll (`CheckoutPage.jsx:405-412`), which does correctly re-fetch and re-map status regardless of the socket gap. So the *system* is eventually consistent (poll covers it within ~3s), but the socket layer's coverage does not match what the backend actually emits — a precise, code-confirmed gap, not a hypothetical one.

---

## 6. Customer Payment Journey

```
Customer opens checkout URL (?order=<uuid>)
  → orderId parsed from URL; if absent → ERROR screen immediately, no fallback
  → PUT /orders/:id/checkout-opened  (best-effort — failure never blocks the page, CheckoutPage.jsx:399)
  → GET /orders/:id/checkout          (real order fetch)
      success → applyOrder() picks the screen per §5's table
      failure → ERROR screen, errorMsg = e.message
  → LOADING spinner shown only for this initial fetch window
  → PAYMENT screen (if hasUpi): QR code (react-qr-code, encoding qrData/upiLink), full UPI ID with
    copy button, payee name, bank name, a "Download QR" (client-side SVG blob download), and three
    proof-method radios (UTR / screenshot / no_proof)
  → countdown timer runs client-side (setInterval, 1s tick) from the server's `remaining` seconds;
    hitting 0 sets step=EXPIRED locally — this is a CLIENT-SIDE expiry, immediately correctable by the
    next 3s poll if the server disagrees (server is the source of truth; client timer is UX-only)
  → customer picks a UPI app / scans QR / copies the ID and pays OUTSIDE this page (no in-page payment
    execution — Checkout only ever displays payment instructions, it never processes money itself)
  → customer returns to the tab, picks a proof method, optionally types a UTR (client validates only
    "12+ chars, no whitespace" — no checksum/format validation beyond length), optionally "picks" a
    screenshot file (§25 — this control does nothing)
  → clicks "Submit Confirmation" → onContinue():
      submittingRef.current = true; step → PROCESSING (immediately, optimistically, before the network
      call even resolves)
      → POST /orders/:id/claim-paid {utr_number, confirmation_type, customer_confirmed:true}
      → on failure: swallowed silently — "Backend will still reflect via polling; keep processing"
        (CheckoutPage.jsx:451-453) — the customer is never told the submit failed
  → order enters claimed_paid (backend) → PROCESSING screen persists
  → poll (3s) and/or socket (§5's coverage) eventually flips to SUCCESS / REJECTED / DISPUTED / EXPIRED
  → SUCCESS: shows amount, UTR (customer's own typed value or the server's utrNumber), order id,
    and either a "Return to merchant" link (if the order carries a redirect_url) or a page reload button
```

**Specific behaviors requested for analysis:**

- **Invalid order id:** `GET /orders/:id/checkout` 404s → `fetchCheckout`'s `req()` helper throws `HTTP 404` → caught → `ERROR` screen with a generic `Unable to load payment` title and the raw `HTTP 404` string as the subtitle (not a friendly message).
- **Already-completed order:** re-opening a `success` order's URL correctly re-renders `SUCCESS` from a fresh fetch — safe and idempotent.
- **Expired order:** correctly renders `EndScreen` with a "Try Again" button that just does `window.location.reload()` — reloading an already-expired order simply re-fetches and re-shows the same expired state; "Try Again" cannot actually revive an expired order (there is no re-checkout/new-order flow from this screen).
- **Cancelled order:** no dedicated mapping (§5) — falls through to `UNAVAILABLE`, whose copy ("P2P payment is unavailable for this order right now. Please contact the merchant.") is misleading for an order the *customer themselves* cancelled moments earlier.
- **QR code:** `QRCode` (`react-qr-code`) encodes `order.qrData` if the backend supplied one, else a client-built `upiLink()` fallback (`utils/order.js:53-70`) — in practice `checkout()`'s backend response (`upiService.paymentPayload`) always supplies `qr_data`, so the fallback path is a defensive-only branch.
- **UPI deep links / "Pay with app" buttons:** `UpiApps.jsx` renders four static brand tiles (PhonePe/GPay/Paytm/BHIM) — **these are purely decorative; none of them are wired to a click handler, an `<a href>`, or the scheme-specific deep links (`phonepe://`, `tez://`, `paytmmp://`) that `upiLink()` already knows how to build.** `upiLink()`'s multi-scheme support (`order.js:62-68`) is dead code — `CheckoutPage.jsx` never imports or renders `UpiApps` at all (confirmed: no `import` of `components/UpiApps` anywhere in `CheckoutPage.jsx`). A customer can only pay by scanning the QR or manually copying the UPI ID into whichever app they open themselves — the "tap to open PhonePe directly" UX implied by having four branded app icons in the codebase does not exist on the live page.
- **Copy UPI / Copy amount:** UPI-ID copy is real (`navigator.clipboard.writeText`, 1.5s "Copied!" flash). There is no dedicated "copy amount" control — the amount is display-only text.
- **Exact-amount instructions:** the amount is shown once, in the header summary line and inside the QR/UPI-details card; there is no explicit "pay exactly this amount, not more, not less" warning copy anywhere on the page (the underlying same-amount-lock architecture, §22, makes exact-amount payment structurally important, but the UI never explains why).
- **"I Paid" / double-click behavior:** the button has no `disabled` state while the request is in flight, but `onContinue` sets `step → PROCESSING` synchronously as its first action, which unmounts the `PaymentScreen` (and its button) immediately — so a genuine double-click on the same render pass is possible but a second click after the state update is not, because the button no longer exists once `PROCESSING` renders. No idempotency key is sent with the `claim-paid` POST; the backend's own handler is naturally idempotent for this case (`claimPaid` no-ops if the order isn't still `pending`/`checkout_open`, `orderController.js:178-180`), so a race here is defensively covered server-side even without a client-side guard.
- **Retry/refresh behavior:** refreshing mid-flow is always safe (state is re-derived from the server on mount). There is no explicit "retry" affordance on the `PROCESSING` screen itself — only the terminal `EXPIRED`/`FAILED`/`ERROR` screens have a "Try Again" (reload) button.
- **Back-button behavior:** `TopBar`'s "Exit" control does `window.history.back()` if there's history, else reloads — this is the only back-navigation affordance; the browser's native back button has no special handling and would simply leave the page (checkout is typically opened as the terminal step of a merchant redirect, so "back" usually returns to the merchant's own site).
- **Browser close/reopen:** no persisted client-side state at all (no `localStorage`/`sessionStorage` use anywhere in this app) — reopening the same URL is functionally identical to a fresh load; correct given the backend is authoritative.
- **Mobile responsiveness:** the layout is a single centered `max-w-md` card (`Shell`, `CheckoutPage.jsx:56-67`) — this is a mobile-first design by construction (fixed max width, no sidebar/chrome), and was not visually verified further as this is a documentation-only pass, but the structural approach itself is sound for a checkout page primarily opened on phones.
- **Low network / socket disconnect:** the 3-second poll (`fetchCheckout`) is a genuine fallback independent of socket state — if the socket never connects or drops, the page still advances via polling, just with up to ~3s of added latency versus the socket path. This is a correctly-designed resilience pattern.
- **Customer support:** a static WhatsApp deep link (`SUPPORT_WHATSAPP`, a hardcoded number + pre-filled message, `utils/order.js:80`) is present on every non-payment screen (loading excluded) — always available, never contextual (it doesn't include the order id in the pre-filled message, which would materially speed up support triage).

---

## 7. Order-Creation Paths

Both paths converge on the exact same shared function, `orderService.createOrder(merchant, body)` — confirmed identical logic, not merely similar:

| | **A. Merchant API** | **B. Merchant Dashboard** |
|---|---|---|
| Entry | `POST /api/orders/create` | `POST /api/merchant/orders` |
| Auth | `apiKeyAuth` middleware — `X-API-Key`/`X-API-Secret` headers, plaintext-compared against `Merchant.api_key`/`api_secret` | `verifyToken` + `checkRole('merchant')` — JWT |
| Controller | `orderController.create` | `merchantController.createOrder` |
| Shared service | `orderService.createOrder(merchant, req.body)` — byte-for-byte the same call in both controllers | |

**`orderService.createOrder` trace, field by field:**

| Field | How it's produced |
|---|---|
| `amount` | `Number(body.amount_inr ?? body.amount)` — validated `> 0` |
| `deposit_type` (claimed) | `String(body.deposit_type \|\| 'STD').toUpperCase()`, must be `FTD`/`STD` |
| `customer_ref` | required, no format validation beyond non-empty |
| `merchant_order_id` | optional; if present, checked for **per-merchant** uniqueness (`Order.findOne({merchant_id, merchant_order_id})`) — 409 on duplicate |
| **FTD/STD detection** | `depositTypeChecker.validateDepositType(merchant.id, customerRef, depositTypeIn)` — server-computed `actualDepositType` **always wins** over the claimed value; a mismatch is only logged, never rejected (§13) |
| **Trader + account assignment** | `routingEngine.findAvailableTrader(amount, actualDepositType)` — §8 |
| Race guard | `routingEngine.acquireAmountLock(paymentDetail.id, amount, orderKey)` (30s Redis/in-memory lock) around the create, plus a live re-check `hasSameAmountActiveOrder` immediately before insert |
| `gateway_order_id` | `orderIdGenerator.generateGatewayOrderId()` → `PG_YYYYMMDD_NNNNN`, sequence = 1 + highest existing sequence for today (queried by `id DESC`, not string sort) |
| **Exchange-rate snapshot** | `rateService.getBaseRate()` (the live `base_exchange_rate` setting) → `traderRate = baseRate × (1 + trader_margin/100)`, both persisted on the order (`exchange_rate`, `trader_rate`) |
| **Fee snapshot** | Not fully snapshotted at creation — only the base/trader rate is stored; the merchant-side fee breakdown (`merchant_fee_usdt`, `admin_rate`, etc.) is computed later, at settlement time, by `balanceService.computeFees`/`rateService.calculateSettlement` — i.e., **the fee the merchant will actually receive is not fixed at order-creation time**, it floats with whatever `admin_default_margin`/the merchant's `payin_fee_percent` is *at settlement*, not at creation. |
| `amount_usdt` | `amount / traderRate`, rounded to 8dp — this is the trader-facing figure; the merchant-facing `amount_usdt` returned in the API response is recomputed the same way, not the eventual settlement figure |
| `expires_at` | `now + config.platform.orderExpiryMinutes` (default 10 min) |
| `status` | `'pending'` |
| **Routing reason (on success)** | Not persisted as a distinct field — only implicitly reconstructable from `trader_id`/`payment_detail_id` |
| **Failure reason** | Not an order-row field at all (no row is created on failure) — surfaced only in the HTTP response: `{success:false, error:'no_provider_available', message, deposit_type}` (503) |
| Checkout URL | `${CHECKOUT_BASE}/?order=${order.uuid}` |
| Socket events | `emitToTrader(trader.id, 'order:new', {...})`, `emitToMerchant(merchant.id, 'order:created', {...})` |

**Merchant response shape differs slightly between the two paths** (both correct, just not identical field names — `orderController.create` includes both `amount` and `amount_inr`; `merchantController.createOrder` includes only `amount_inr`) — a minor API-consistency wrinkle, not a bug.

---

## 8. Assignment Engine

Implemented entirely in `backend/src/services/routingEngine.js`. There is **no separate "country" concept anywhere in the schema or this engine** — Max Pay is INR/UPI-only by construction; "determine country" (from the task's expected conceptual flow) does not exist as a real step because there is only ever one country in scope.

**Actual sequence** (`findAvailableTrader`, called from `orderService.createOrder`):

```
1. eligibleTraders(depositType):
     Trader.findAll({ is_online:true, balance_usdt > 0 },
                     include: User(status:'active'), PaymentDetail(is_active:true, required))
     .filter(t => traderAcceptsType(t, depositType))     ← FTD/STD gate, §13
     order: id ASC  (NOT round-robin, NOT least-used — see §9)
2. for each trader (in id-ascending order):
     if trader.daily_limit > 0 AND current_daily_used + amount > daily_limit → skip
     pickEligibleAccount(trader, amount):
       for each of the trader's payment details (in load order — not explicitly sorted):
         is_active? is_active_detail? (two SEPARATE flags, both must pass)
         amount within [min_amount, max_amount]?
         hasSameAmountActiveOrder(account.id, amount)? → skip if true (same-amount lock, §22)
         legacy daily_limit/today_used check
         if any hour/day/week/month count OR amount cap is configured:
             computeWindowUsage(account.id, ...) — ONE live query, count+sum since each window start
             check max_per_hour/day/week/month (counts) and hourly/daily/weekly/monthly_limit_amount (sums)
         → first account that survives every check wins
     if an account survived → RETURN {trader, account}   (first trader AND first account both win — no
                                                            ranking/scoring across the full candidate set)
3. if no trader/account survives → return null → orderService throws 503 no_provider_available
```

**Locking & transaction handling:** `acquireLock`/`releaseLock` use Redis `SET NX EX` when available, else an in-process `Map` fallback (meaning the amount-lock guarantee is **weaker on a multi-process deployment without Redis** — the in-memory fallback only protects against races within a single Node process). The *durable* guarantee is not the lock at all — it's a MySQL **generated-column unique index** added specifically as a backstop (`migrations/20260722000001-add-active-amount-lock-index.js`): a `VIRTUAL` column `active_amount_lock_key = CONCAT(payment_detail_id, ':', amount_inr)` when the order's status is active, `NULL` otherwise (MySQL/MariaDB treats multiple `NULL`s as non-conflicting), with a `UNIQUE` index on it. This is a genuinely strong piece of engineering — even if Redis is down *and* the app runs as multiple processes *and* the application-level race-guard is somehow bypassed, the database itself will reject a second simultaneously-active same-account-same-amount order at the `INSERT`. This is the single most production-grade correctness mechanism found anywhere in this audit.

### Answers to the specific assignment questions

1. **How is a trader selected?** First trader, in ascending `id` order, that is online + active + funded + accepts the deposit type + hasn't hit its daily limit + has at least one eligible account. **Not** round-robin, **not** least-recently-used, **not** weighted by success rate or risk score.
2. **How is a payment account selected?** First account under the selected trader (in whatever order Sequelize loaded them — not explicitly sorted) that passes active/type/amount-range/same-amount-lock/window-limit checks.
3. **How is a smartphone selected?** **It isn't, at assignment time.** Neither `Order` nor the assignment logic ever chooses a specific device. `PaymentDetail.ngo_device_id` binds an account to one Mongo `Device` at *account-setup* time (trader-side pairing, outside this flow), but `pickEligibleAccount` never reads or checks that field. The device that ends up detecting the payment is simply whichever phone happens to be paired to the chosen account.
4. **Does the system require the device to be online?** **No.** `eligibleTraders`/`pickEligibleAccount` check `Trader.is_online` (a trader-level flag) and `PaymentDetail.is_active`/`is_active_detail` — never `Smartphone.is_online`, and never the real, currently-relevant liveness signal (Mongo `Device.isOnline()`, a 15-second `lastSeen` freshness window `[ngo-backend agent]`). A trader with one dead phone among several could remain `is_online:true` (kept fresh by a *different*, working phone's heartbeat) while orders keep routing to the dead phone's account, each one silently expiring after 10 minutes with no detection ever possible.
5. **How is trader capacity calculated?** `Trader.daily_limit` vs. `current_daily_used` (a stored counter incremented at settlement, `smartMerge.confirmOrder`) — a simple running total, not a live query.
6. **How are daily limits enforced?** Two independent layers: the legacy `PaymentDetail.daily_limit`/`today_used` pair (updated at settlement, reset by the nightly `settlementJob`), and the newer live-computed `computeWindowUsage` hour/day/week/month count+amount caps — **the same shared function also backs the trader-panel's own usage badge**, so what's enforced and what's displayed can't drift apart (explicitly by design, per the code comment in `usageWindows.js`).
7. **How are merchant limits enforced?** `Merchant.daily_limit_inr` exists on the model **but is never checked anywhere in `orderService.createOrder`, `routingEngine.js`, or any order-creation path read in this audit** — a merchant-level cap field that appears to be dead/unenforced.
8. **How are FTD/STD rules enforced?** See §13 — server-detected, always overrides the claimed value.
9. **How are country rules enforced?** Not applicable — single-country system, no such concept exists.
10. **Is load distributed fairly?** No.
11. **Is round-robin used?** No — strict ascending-ID first-fit.
12. **Is least-used selection used?** No.
13. **Is success rate considered?** No — no success-rate field is read anywhere in the routing path.
14. **Is risk score considered?** No — no risk-scoring concept exists anywhere in the schema.
15. **Are recently-failed accounts avoided?** No — a payment detail that just had an order expire/fail is immediately eligible again for the next order (nothing tracks recent-failure recency as an eligibility input).
16. **Can two simultaneous orders receive the same account incorrectly?** Structurally prevented for the *same amount* (the DB-level unique index, above) — but two simultaneous *different-amount* orders can and correctly do land on the same account (that's intended: an account can hold many concurrently-active orders as long as no two share an exact amount).
17. **How is same-amount collision prevented?** Layered: (a) live `hasSameAmountActiveOrder` check during eligibility, (b) a short Redis/in-memory lock bridging the check→insert race, (c) the DB-level generated-column unique index as the ultimate backstop.
18. **What happens when no trader is available?** At order-creation time: the order is **never created**; the caller gets a 503. At reassignment time (`assignTraderToOrder`, used by "Get new UPI" and the 30s retry sweep): the *existing* order is left with `trader_id:null, status:'pending'` and pushed onto a Redis list (`queue:orders`) for the sweep to retry.
19. **What happens when no account is available (trader itself is fine)?** No distinct failure mode — the trader is simply skipped and the loop moves to the next trader; only exhausting *all* eligible traders produces the overall "unavailable" outcome.
20. **What exact error reaches the Merchant and Checkout?** Merchant (API/dashboard): `503 {success:false, error:'no_provider_available', message:'No {FTD|STD} payment provider available right now', deposit_type}`. **Checkout/customer: nothing — this error can only occur before an order (and therefore a checkout URL) exists**, so a customer never sees it. The only related customer-facing state is `UnavailableScreen`, reachable only via the rarer "reassignment also failed" path (§11), which is a structurally different situation from "no provider at order-creation time."

### Assignment decision tree

```
findAvailableTrader(amount, depositType)
 │
 ├─ eligibleTraders(depositType) empty? ──────────────────────────► 503 no_provider_available
 │
 └─ for trader in [ascending id]:
      ├─ daily_limit exceeded? ─────────────────────────────► skip, next trader
      └─ pickEligibleAccount(trader, amount):
           for account in trader.paymentDetails:
             ├─ !is_active OR !is_active_detail? ───────────► skip, next account
             ├─ amount outside [min,max]? ──────────────────► skip, next account
             ├─ same-amount active order exists? ───────────► skip, next account
             ├─ legacy daily cap exceeded? ──────────────────► skip, next account
             ├─ hour/day/week/month count OR amount cap exceeded? ► skip, next account
             └─ ALL PASS → return account
           no account survived → return null
      ├─ account found → ASSIGN (trader, account) → create order → DONE
      └─ no account → next trader
 all traders exhausted → 503 no_provider_available
```

---

## 9. Trader Selection

Covered fully in §8. To restate the single most consequential fact: selection is **strict ascending-`id` first-fit** with no fairness, load-balancing, or performance weighting of any kind. In a system with many eligible traders, the lowest-ID (earliest-registered) trader who is online/funded/type-accepting will be tried first for literally every order, forever — meaning trader #1's accounts will systematically see far more routing attempts than trader #50's, independent of either trader's actual capacity or quality, unless #1 exhausts their own limits first.

---

## 10. Payment-Account Selection

Covered fully in §8. Two independent activation flags must both be true (`is_active` — presumably admin/system-controlled, and `is_active_detail` — the trader's own on/off toggle), and the live window-usage computation (`usageWindows.computeWindowUsage`) is shared verbatim between enforcement (routing) and display (trader panel usage badge), which is a deliberate and sound design choice specifically aimed at preventing the two from silently diverging (per its own code comment, citing prior incidents with stale reset-cron counters as the reason this was rebuilt as a live query).

---

## 11. Smartphone/APK Selection

There is no smartphone/APK "selection" step in the order-assignment flow at all — this is worth restating as its own section because the task's expected conceptual flow assumes one exists. What actually happens:

1. At **account setup** time (trader-side, outside the order flow), a `PaymentDetail` is paired to exactly one `ngo_device_id` (a Mongo `Device._id` string) via the trader panel's device-pairing UI.
2. At **order-assignment** time, `pickEligibleAccount` selects an *account*, never a *device* — the device is implied transitively by whichever account was chosen.
3. At **detection** time, whichever physical phone is running the APK, paired to that account, and has the relevant permission (SMS/notification-listener/accessibility) live is the one that will actually produce a detection event — but nothing in the assignment path ever confirmed that phone was online, reachable, or even still the phone actually paired to that account in ngo-backend's `Device` collection.

This is the clearest example in the whole audit of the two systems (MySQL routing, Mongo detection) not being aware of each other: routing happily assigns an account whose real-world detecting device might be dead, and has no mechanism to find out before committing a customer to a 10-minute countdown against it.

---

## 12. Limit and Capacity Rules

| Limit | Scope | Enforced where | Live or cached |
|---|---|---|---|
| `Trader.daily_limit` vs `current_daily_used` | per trader, per day | `findAvailableTrader` | Cached counter, incremented at settlement (`smartMerge.confirmOrder`), reset nightly (`settlementJob`) |
| `PaymentDetail.min_amount` / `max_amount` | per account, per order | `pickEligibleAccount` | Structural (not time-windowed) |
| `PaymentDetail.daily_limit` / `today_used` (legacy) | per account, per day | `pickEligibleAccount` | Cached counter |
| `max_per_hour/day/week/month` (counts) | per account | `pickEligibleAccount` via `computeWindowUsage` | **Live** query, in-flight (non-failed/rejected) orders count immediately on creation |
| `hourly/daily/weekly/monthly_limit_amount` (sums) | per account | same | Same live query |
| `Merchant.daily_limit_inr` | per merchant, per day | **nowhere found** | Dead field |

**Notable design point:** the live window-usage check counts an order the moment it's *created* (any non-`failed`/`rejected` status), not the moment it *settles* — i.e., capacity is reserved immediately, before the customer has even paid, which is the correct conservative choice for preventing over-commitment of an account's limits.

---

## 13. FTD/STD Rules

`depositTypeChecker.js` — a 32-line file implementing the entire rule: a `(merchant_id, customer_ref)` pair is **FTD** until that pair has at least one order with `status:'success'`, after which every subsequent order for that same pair is **STD**. This is queried fresh on every order creation (`Order.findOne({merchant_id, customer_ref, status:'success'})`) — not cached, not denormalized onto a customer record (there is no customer/donor entity in the MySQL schema at all; `customer_ref` is just a string the merchant supplies).

The **server-detected value always wins** — `orderService.createOrder` computes `actualDepositType` from this check and uses it for routing/persistence regardless of what the merchant claimed in `deposit_type`; a mismatch only produces a log line (`logger.info(...auto-correct...)`), never a validation error or a response field telling the merchant their claim was wrong (the response does return the corrected `deposit_type`, so a careful integrator *could* notice, but nothing calls it out explicitly).

---

## 14. Checkout UI/UX Analysis

Control-by-control classification (per the task's required taxonomy):

| Control | Classification | Why |
|---|---|---|
| QR code | **Fully working** | Real `qr_data` from backend, correctly rendered |
| Full UPI ID + copy | **Fully working** | |
| "Download QR" | **Fully working** | Client-side SVG blob, no backend involvement needed |
| Payee name / bank name | **Fully working** | Real, from `paymentDetail` |
| UTR text input | **Partially working** | Submits correctly; validation is length-only (≥12 chars), no format/checksum check |
| **Screenshot file picker** | **UI only / dead / misleading** | `<input type="file">` has no `onChange`, no upload call, no reference anywhere in `onContinue` — selecting a file does nothing; the backend never receives it. The code's own comment admits it: *"Screenshot picker (placeholder — no file backend yet)."* Presented to the customer as materially stronger evidence ("Visual proof of payment") than "no_proof," but functionally identical to it. |
| "I paid but can't provide proof" | **Fully working** (honestly labeled) | Correctly submits `confirmation_type:'no_proof'` |
| "Get new UPI ID" | **Backend fully implemented, not exposed in the live UI** | `services/api.js` exports `requestNewUpi()` and the backend's `routingEngine.getNewUpiId` is real and complete, but `CheckoutPage.jsx` never calls it and no button in the rendered UI triggers it — despite `i18n.js` having a translated string for it (`getNewUpi`) and `UnavailableScreen`'s own scenario existing partly *because* this flow can fail. It appears to have been removed from the UI after being built. |
| **"Pay with app" / UPI-app buttons** | **Dead / not rendered at all** | `UpiApps.jsx` exists, is fully coded, and is never imported by the page (§6) |
| Cancel payment | **Fully working** | Confirms via native `window.confirm`, calls `cancelOrder`, correctly blocked server-side once claimed |
| Countdown timer | **Fully working, client-side only** | Correctly reconciled by the next poll if it drifts from server state |
| Support link | **Fully working, static** | Not order-aware (doesn't include the order id) |
| Language | **UI only / dead** | `const lang = 'en'` is hardcoded (`CheckoutPage.jsx:360`) — there is no language switcher anywhere and no locale auto-detection, so the entire Hindi translation set in `i18n.js` (57 fully-translated strings) is unreachable dead weight |
| "Searching for banking details…" strings | **Dead** | `i18n.js` still defines `searchingTitle`/`searchingSub` (leftover from a pre-v2 architecture where a trader was found *after* checkout opened, per code comments elsewhere) — `CheckoutPage.jsx` never references either string; under the current v2 design a trader is always assigned before the checkout URL exists, so this screen concept no longer applies but its strings weren't removed |
| Demo/mock order fallback (`utils/order.js`) | **Dead** | Fully coded, never imported by the live page (§4) |

---

## 15. APK Architecture

*(Full detail from the dedicated APK research pass; summarized and cross-referenced here — `[APK agent]` throughout this section and §16–18.)*

The app is branded **"MaxPay"** in its own UI (splash screen, service labels) despite the Java package remaining `com.example.paymentbot`. Live navigation: `SplashActivity` → (if unregistered) `PermissionActivity` → `RegistrationActivity` → `SetDeviceNameActivity` → `MainActivity`. A second, fully-built onboarding flow (`OnboardingActivity`) exists in the codebase but is unreachable from this graph — dead, parallel code, evidence of at least one prior redesign (further confirmed by `MainActivity`'s own Javadoc admitting some methods are "compatibility shims kept so the accessibility engine and APIClient still compile" after a UI overhaul).

**Keep-alive chain:** `KeepAliveService` (foreground, `START_STICKY`) + `AlarmHelper` (15-minute exact alarm) + `WatchdogReceiver` (restarts `KeepAliveService`, reschedules the next alarm) form a self-perpetuating loop, started from both `MainActivity.onCreate` and `BootReceiver`. **`HeartbeatService` is *not* part of this chain** — it is started only from `MainActivity.onCreate`, so after a device reboot, heartbeats stop firing until the trader manually reopens the app UI, even though the rest of the keep-alive machinery survives the reboot fine. This is a real, specific reliability gap: a rebooted phone can look "kept alive" (foreground notification present, watchdog cycling) while silently not heartbeating.

**Registration:** `POST /api/apk/register-device {licenseKey, deviceId (Android ID), deviceModel, androidVersion, appVersion}` — no auth on this bootstrap call (there's nothing to authenticate with yet). Returns a `deviceToken`, persisted in plain (unencrypted) `SharedPreferences`. `RegistrationManager.isRegistered()` is a **local-only** check (does a license key exist in prefs) — never re-validated against the server, so a revoked/deleted device would still believe itself registered indefinitely.

**Heartbeat:** every **4 seconds** (not minutes), `POST /api/apk/heartbeat {licenseKey, deviceId, status:'active', timestamp}` — no auth header, no retry on failure (a failed heartbeat is just logged and the next one fires 4s later regardless).

**No retry/queue logic exists anywhere in the app.** Every network call across every file is fire-and-forget: on failure, the event is logged locally and discarded — never queued, never retried. This is explicit both in the code's own comments and in the absence of any persistent or in-memory queue structure anywhere in the 27 files.

Full endpoint inventory, auth per endpoint, and the version/update-mechanism findings are in §16–18 alongside the detection-source detail they belong to.

---

## 16. SMS Detection

**Gate (not `BankSenderTags`):** `SMSReceiver.isValidBankSender(sender)` — a case-insensitive substring match against a hardcoded list: `HDFC, SBIN, SBI, ICICI, AXIS, KOTAK, PNB, PAYTM, PYTM, PHONEPE, YESBNK, BOB, UNION, CANARA, INDBNK, AUBANK, CENTBK, IDFCBK, AIRTEL, IDBI, FEDERAL, KARUR, SOUTH, INDIAN, NAINITAL` `[APK agent]`. Any SMS whose sender contains one of these is captured; everything else is dropped. `BankSenderTags.KNOWN_BANK_TAGS` (a separate, 24-entry map of 6-character DLT entity tags) is **informational/logging only** — it does not gate anything, per an explicit code comment.

**Classification:** debit keywords (`debited, debit, paid, sent, withdrawn`) checked first; a stricter transactional-sender shape check (`^[A-Z]{2}-[A-Z]{6}-T$`) additionally gates whether a debit SMS is actually **forwarded to the backend** at all (`isTransactionalSender`).

**Extraction:** regex arrays, first match wins — amount pattern only matches `rs`/`inr` text prefixes (**not the `₹` symbol**), UTR pattern matches `upi ref`/`utr`/`ref` labels followed by 6+ alphanumeric characters, last-4-digits pattern matches several "a/c ...(\d{4})" shapes.

**Backend submission:** only debit SMS that also passes the transactional-sender check is posted, to `POST /api/apk/debit-sms {deviceId, type:'DEBIT_SMS', sender, body, last4Digits, amount, utr, receivedAt, isTransactionalSender, isVerifiedBank, bankTag}` — **no auth header at all**. Per the APK's own code comments, this endpoint feeds `payoutVerifier.matchDebitWithOverlay` (the *outgoing*-payment verification pipeline, §30/§7 of the "outgoing" flow, not incoming-order matching).

**Non-debit SMS never reaches the backend** — it's shown in the on-device log only. **Deduplication:** none at the SMS-receiver level.

**Reliability limitations (documented, not exploited):** unparseable debit SMS still gets forwarded with blank amount/UTR fields; multipart SMS is concatenated correctly; delayed SMS is not specially handled (there's no "how old is this SMS" check — a 10-minute-late SMS is processed identically to an instant one, which interacts with ngo-backend's own 10-minute match window, §24); default-SMS-app status is not required (the app uses `RECEIVE_SMS`/`READ_SMS` as a listener, not as the default SMS handler) — if the permission is denied, detection silently stops with no crash and no visible warning to the trader beyond the permission screen itself.

---

## 17. Notification Detection

**`NotificationService extends NotificationListenerService`.** Package allowlist (16 entries) `[APK agent]`: `com.phonepe.app`, `com.google.android.apps.nbu.paisa.user` (GPay), `com.google.android.apps.nbu.paisa.merchant` (GPay Business — flagged *unverified* in code comments), `net.one97.paytm`, `com.bharatpe.merchant`, `com.bharatpe.app`, `com.paytm.business` (unverified), `com.phonepe.app.business` (unverified), `in.amazon.mShop.android.shopping`, `com.freecharge.android`, `com.airtelpeymentsbank`, `com.snapwork.hdfc`, `com.csam.icici.bank.imobile`, `com.sbi.SBIFreedomPlus`, `com.axis.mobile`, `com.dreamplug.androidapp`, `com.mobikwik_new`. Anything outside this list is ignored outright.

**Promo filter** rejects notifications containing "loan offer/cashback offer/apply now/pre-approved/…" or generic "offer" language without a payment keyword — reduces false positives from marketing notifications for the same banking apps.

**Classification quirk (real, code-confirmed):** the service does not actually distinguish credit from debit when building the server payload — it **hardcodes `category:'PAYMENT'` regardless of the notification's real content**, meaning an outgoing-payment notification from an allowlisted app could be submitted with the same category label as an incoming one; the receiving matching engine treats all `category:'PAYMENT'` `RawEvent`s identically (§20).

**Extraction reuses `SMSReceiver`'s regex arrays** (`AMOUNT_PATTERNS`, `UTR_PATTERNS`) — a second call site for the same patterns, not `PaymentParser` (which is reserved for the accessibility/screen path).

**Submission:** `POST /api/apk/event {type:'NOTIFICATION', sender, body, category:'PAYMENT', amount, utr, utcTimestamp}` with header `devicetoken: <token>` — **this is the one endpoint in the entire APK that attaches real authentication**, and per the code's own comments (echoed independently in both the APK and ngo-backend research passes) is asserted to be **the endpoint that actually feeds `matchingEngine.checkMatch` server-side** — i.e., the single most functionally important network call this app makes.

**Grouped/updated/cleared notifications:** removed notifications are ignored entirely (`onNotificationRemoved` is a no-op); there is no de-duplication against a notification being re-posted (e.g., a progress-style update firing `onNotificationPosted` twice for the same logical event would be treated as two independent detections).

---

## 18. Web/Scraper Detection

**"Scraper" means two structurally different things in this codebase, and conflating them would misrepresent the architecture:**

**(a) On-device accessibility-based screen scraping (`PaymentBotService`, in the APK).** This is real: `AccessibilityService` with `canRetrieveWindowContent="true"`, walking the entire on-screen `AccessibilityNodeInfo` tree of 13 named payment apps (PhonePe, GPay, Paytm, BharatPe Merchant, Amazon, FreeCharge, Airtel Payments Bank, ICICI iMobile, SBI, Axis, Kotak, MobiKwik, HDFC) and concatenating all visible text. Two behaviors:
  - If the aggregated text matches an "outgoing success" heuristic (explicitly excludes "received"/"credited" language) → auto-extracts amount/name/last-4/UTR and **auto-POSTs**, no user action required, to `/api/apk/outgoing-payment` (the *outbound*-payment proof pipeline, §30).
  - For a 4-app subset (Paytm, PhonePe, BharatPe Merchant, GPay), if the text looks *inbound* → runs `PaymentParser`, wraps via `PaymentMerger.single()`, sends via `APIClient` → `/api/apk/event` (the inbound-matching pipeline).
  Separately, a manual "RECORD" toggle enables clipboard monitoring and live keystroke capture (account number/IFSC/name/amount shape-detection) while the trader is actively filling a payment form — explicitly opt-in, not automatic.
  Also separately, `OverlayService` performs genuine on-demand full-screen JPEG capture via `MediaProjection` (one screenshot per manual button tap, base64-encoded, POSTed to `/api/apk/screenshot`) — this is real screen *capture*, but manual and image-based, distinct from the always-on accessibility *text* reading above.

**(b) Server-side browser automation of the Paytm merchant dashboard (`ngo-backend/src/services/webScraper.js`).** This is a **Playwright**-driven headless (or headed, per config) Chromium session that logs into `dashboard.paytm.com` using an AES-encrypted-at-rest stored email/password, handles an OTP step, and — once authenticated — calls Paytm's own **internal dashboard APIs directly from inside the browser page context** (`POST /api/v3/order/list`, `POST /api/v4/order/detail`) to pull transaction rows (amount, payer name, payer UPI, `bizOrderId`, RRN/UTR, status), writing them to a MongoDB `Transaction` collection. `[ngo-backend agent]`. Session cookies are persisted per-account to a JSON file and reloaded to skip re-login where possible; a `setInterval`-driven 60-second loop keeps polling while the session looks alive, with a silent cookie-first auto-reconnect and a "paused/session_expired" fallback state if not. `scraperEngine.js` (a separate, older file) is **confirmed dead code** by its own header comment — a Puppeteer skeleton that never navigates anywhere and always returns an empty array; its only *live* export is a thin `ingestRawEvent()` helper that `apk.js` calls to persist `RawEvent` documents (i.e., that file's real job today is unrelated to its name). `proxyManager.js` (deterministic per-tenant proxy assignment, intended to make scraper sessions "look consistent to the platform") is wired into the dead `scraperEngine` path but **not** into the live `webScraper.js` — the actual Paytm-dashboard automation currently launches with no proxy at all.

**Only Paytm has a working scraper implementation.** `PLATFORMS` in `constants.js` declares PhonePe/BharatPe/GPay/AmazonPay as enum values, but no scraper exists for any of them `[ngo-backend agent]` — an account configured for one of those platforms has no server-side detection path beyond whatever the APK itself independently captures for it.

Neither scraping mechanism uses a WebView anywhere, and neither performs OCR/image-based extraction of screenshots for matching purposes — extraction is always text-based (accessibility node text on-device, or DOM/API-response data server-side).

---

## 19. Normalized Detection Payload

There is **no single normalized payload shape** — three distinct shapes exist at three different layers, and they do not share a schema:

**Device-side (APK, before any network call) — `PaymentData.java`:** `app, amount, sender, utr, upiId, status, mode, rawText, timestamp, confidence(0-100), capturedBySMS/Notification/Screen` — used only internally by `PaymentMerger`/the accessibility path; never sent as-is over the wire `[APK agent]`.

**Wire payload actually sent to ngo-backend, per endpoint** `[APK agent]`:
| Endpoint | Fields |
|---|---|
| `/api/apk/event` | `type, sender, body, category, amount, utr, utcTimestamp` |
| `/api/apk/debit-sms` | `deviceId, type:'DEBIT_SMS', sender, body, last4Digits, amount, utr, receivedAt, isTransactionalSender, isVerifiedBank, bankTag` |
| `/api/apk/outgoing-payment` | `recipientName, recipientLast4, amount, utr, capturedAt, capturedFrom, autoCapture` (+ device/ngo linkage) |
| `/api/apk/overlay-capture` | recipient name/account/UPI/IFSC/last4/amount/paymentApp/screenshotBase64 |
| `/api/apk/screenshot` | base64 image + any `recordedAccount/IFSC/name/amount` from a manual RECORD session — **not persisted**, relayed live over the socket only |

**ngo-backend's persisted normalized models** `[ngo-backend agent]`: `RawEvent {deviceId, ngoId, type, sender, body, category, amount, utcTimestamp, processed}` (from `/event`), `DebitSMS`, `OverlayCapture`, `OutgoingPayment` (each roughly mirroring its wire payload above), and `Transaction` (the scraper's output: `accountId, amount, payerName, payerUpiId, txnId, utr, status, ngoId`).

**MySQL's own, structurally different, normalized shape (`Transaction` model, System A):** `order_id, smartphone_id, engine_used(sms|notification|screen_scraper|manual), raw_data, amount_detected, utr_number, sender_name, sender_upi, confidence_score, is_merged`. This is the shape the (real, correct, unreachable-by-the-live-APK) confidence-scoring engine consumes.

**Required/optional/trusted/derived:** across every layer, only `amount` is consistently treated as required for a detection to be actionable. `utr` is optional everywhere and, critically, **never independently verified against anything** — it is trusted exactly as reported by whichever layer extracted it (customer-typed on Checkout, APK-regex-extracted from SMS/notification text, or scraper-extracted from Paytm's own dashboard). No layer computes or stores a duplicate-detection fingerprint distinct from `(account, amount, time-window)` matching itself. **Raw evidence retention:** MySQL's `Transaction.raw_data` (full JSON/text of the original payload) and ngo-backend's `RawEvent.body`/`DebitSMS.smsBody`/`OverlayCapture` fields do store the original text — genuine raw-evidence retention exists at both layers for text-based signals. **Retention/access rules:** no TTL, archival, or access-control policy beyond ordinary DB/collection permissions was found for any of this evidence at either layer.

---

## 20. Matching Engine

**Two matching engines exist, and only one of them is exercised by the real app.**

### 20a. MySQL `smartMerge.js` — real, well-designed, effectively orphaned

Trigger: `paymentController.ingest()` (Engines 1–3) or `paymentController.manual` (Engine 4) → `smartMerge.mergePaymentData(orderId)`. Confidence model (`ENGINE_SCORE`): `screen_scraper:100, manual:100, notification:60, sms:40`; combined via a `Set` of distinct engines that have reported for the order — `notification+sms` together score a hardcoded **85** (not a sum), any single non-`screen_scraper`/`manual` source alone scores its own base value. **Mandatory gates before auto-confirm:** duplicate-UTR check (`isDuplicateUtr`, scoped to already-`is_merged:true` transactions on *other* orders), amount-match tolerance of **±₹1**. `≥85` → auto-confirm via `confirmOrder` (real settlement, §28). Below threshold, on `pending`/`checkout_open` → flips to `claimed_paid` for admin review. This engine is **never fed by the real Android app** — nothing in the live APK flow calls `POST /api/device/register` or any `POST /api/payment/*` endpoint (confirmed by the full endpoint inventory in §16–18). It would only activate for a hypothetical device that registered directly against the MySQL backend, which the shipped app never does.

### 20b. ngo-backend `matchingEngine.js` — cruder, but this is the one the real app actually drives `[ngo-backend agent]`

Triggers: `checkMatch(rawEvent, io)` — fired from `apk.js` on every incoming `RawEvent` with `category:'PAYMENT'` (i.e., real-time, per detection); `matchWebhook(webhook, io)` — fired once, immediately, when a checkout-originated donor-intent `Webhook` is created (`webhook.js`'s `/donate` route); `runMatching(io)` — a periodic-sweep variant that is **declared but never scheduled** (`node-cron` is a dependency, never `require`d/`.schedule()`d anywhere — confirmed dead).

Matching logic: **amount equality (string-normalized) + a time window** — `MATCH_WINDOW_MINUTES = 10` for `checkMatch` (RawEvent vs. Transaction), `WEBHOOK_EXPIRY_MINUTES = 120` for webhook-to-transaction matching. **No UTR gate, no account/UPI-ID gate, no confidence score of any kind** — first candidate found by a linear scan wins.

**The critical connective gap:** ngo-backend's own `checkout.js` `POST /verify` handler (the one the MySQL backend's `claimPaid` calls) **creates the `Verification`/`Webhook` documents but never itself calls `checkMatch` or `matchWebhook`** — it only fires the scraper as a best-effort nudge. So the pending webhook created by a customer's "I Paid" click sits waiting to be matched only by a *future, independent* trigger: either a fresh `RawEvent` (i.e., the APK detects something new and `checkMatch` happens to scan and find this pending webhook), or the webhook's own creation-time `matchWebhook` call (which only looks at *already-existing* `Transaction`s at that exact moment — it does not get re-invoked later as new transactions arrive). Since `runMatching` (the periodic retry that would cover this gap) is dead code, **a claimed-paid order paired with a scraper-only (non-APK) trading account has no reliable code path that ever re-attempts the match** once the immediate `matchWebhook` call at webhook-creation time fails to find an already-existing transaction.

---

## 21. Account Matching

**This is meant to be a mandatory gate. It is not consistently applied.**

- **MySQL `paymentController.matchOrder`** (Engines 1–3, System A — unreachable by the real app, but worth documenting as designed): only applies an account filter (`paymentDetail.upi_id === upiId`) **if `upiId` was supplied** by the caller. The SMS engine handler (`paymentController.sms`) never extracts or passes a `upi_id`/account identifier at all — so for SMS-sourced detections, account matching is **not applied**; the query falls back to matching on `amount` + `trader_id` alone, picking the most-recently-created active order. If a single trader has two different accounts each holding an active order for the same amount (structurally possible — the same-amount lock is per-account, not per-trader), an SMS-only detection could match the wrong one.
- **ngo-backend `matchingEngine.js`** (the real path): **no account/UPI-ID equality check at all**, at any point — matching is purely `(ngoId, amount, time window)`. Missing account information is therefore the *default* case, not an edge case — the engine was never designed to check it.
- **Behavior when account info is missing:** in both systems, the match simply proceeds on amount (+ trader, on the MySQL side) alone — there is no code path in either system that *rejects* a detection for lacking account identity; it is silently treated as equivalent to a fully-identified one.

---

## 22. Amount Matching

- **Comparison:** exact equality everywhere — MySQL compares `amount_inr` (DECIMAL) directly; ngo-backend string-normalizes (strips commas) before comparing. **No tolerance is applied at the matching-engine level in either system** (the ±₹1 tolerance found earlier is specific to `smartMerge`'s *guard* logic, not a general matching feature, and only exists in the unreachable MySQL engine).
- **Currency:** INR only, everywhere — no multi-currency handling exists.
- **Partial payment / overpayment:** neither system has any concept of a partial or over-payment — a detected amount that doesn't exactly equal the target either matches (equal) or doesn't (unequal); there is no "credit the difference" or "flag as overpaid" logic anywhere.
- **Duplicate same-amount orders / one payment matching multiple orders:** this is exactly what the routing-layer same-amount lock (§8, §22-in-routing) exists to prevent *structurally*, at the account level — by the time a payment is detected, the DB guarantees at most one active order per (account, amount) pair, so amount-based matching at the detection layer cannot itself be ambiguous **as long as the account was also correctly identified** — which, per §21, is not always true. The real ambiguity risk is therefore not "two active orders with the same amount on the same account" (structurally prevented) but "two active orders with the same amount on *different* accounts under the same trader," combined with a detection signal (SMS) that doesn't identify which account it came from.
- **Amount reuse within a short period:** once an order settles/expires/fails, its `active_amount_lock_key` becomes `NULL` and the same account can immediately take a new order for the same amount — there is no cooldown period, which is correct (no reason to impose one once the prior order is truly terminal).

---

## 23. UTR Matching

- **Extraction:** regex-based at the APK layer (SMS/notification text) or customer-typed (Checkout) or scraper-extracted (Paytm dashboard RRN) — three independent extraction paths, no shared validation logic across them.
- **Normalization:** none beyond whitespace-stripping on the Checkout side; no canonical case/format normalization was found anywhere.
- **Uniqueness — not database-enforced.** `transactions.utr_number` has a plain (non-unique) index only (`idx_transactions_utr_number`) — confirmed directly from the migration file. The only duplicate-UTR protection anywhere is `smartMerge.isDuplicateUtr()`, an **application-level, check-then-act query** (`Transaction.findOne({utr_number, is_merged:true, order_id:{≠excludeOrderId}})`) that only catches a UTR that was already used to *settle* a different order — it does not prevent two *not-yet-settled* orders from independently carrying the same UTR simultaneously (a race between two concurrent confirmations could both pass the check before either sets `is_merged:true`). And this check only exists in the MySQL engine, which the real APK never feeds.
- **On the ngo-backend side, UTR is captured and stored on the resulting `Ledger` entry but is never used as a match key at all** — `matchingEngine.js` matches on amount+time only; UTR is purely an output/audit field there, not an input to the decision.
- **Missing/partial/masked UTR:** handled gracefully everywhere as "absent" (falls back to `no_proof` on Checkout, blank field in detection payloads) — no system currently rejects or specially flags a masked/partial UTR as suspicious.
- **Scoped or global?** Effectively global within each system's own table (no per-merchant/per-trader scoping of the uniqueness check), but since there's no DB constraint at all, "scope" is moot — nothing is actually enforced.
- **Why this matters (per the task's framing):** a customer-typed UTR is inherently the least trustworthy signal in the whole system — it is the one piece of "evidence" the customer fully controls and the backend never independently verifies against a bank/UPI source of truth. The current design does treat customer-typed UTR appropriately in the sense that it alone is **never sufficient to auto-confirm anything** — `claimPaid` only ever moves an order to `claimed_paid`/pending-review, never to `success`, regardless of what UTR was typed. That specific safeguard is correctly in place. What is *not* correctly in place is any downstream verification that a later-arriving detected UTR actually matches what the customer claimed — the two are never cross-checked against each other anywhere in either system.

---

## 24. Time Matching

- **MySQL `matchOrder`:** **no explicit time-window filter at all** — it queries all `ACTIVE_STATUSES` orders matching amount (+trader if known) and takes the newest by `created_at DESC`. An order created 9 hours ago that's still technically "active" (which shouldn't normally happen given the 10-minute expiry sweep, but could during a sweep outage) would still be a valid match candidate with no staleness check.
- **ngo-backend `matchingEngine.js`:** explicit windows — `MATCH_WINDOW_MINUTES = 10` (RawEvent-to-Transaction), `WEBHOOK_EXPIRY_MINUTES = 120` (webhook-to-transaction). These are the only genuine "time proximity" gates found anywhere in the matching logic across either system.
- **Order expiry** is a separate, unrelated concept (`Order.expires_at`, default 10 minutes from creation, enforced by the 30-second `orderExpiry` sweep job) — not itself a matching-engine input, just a background process that flips stale unclaimed orders to `failed`.
- **Delayed SMS/notification:** neither engine has any explicit "how stale is this detection" check independent of the general time windows above — a genuinely delayed signal (network delay, phone asleep) that still lands inside the relevant window is treated identically to an instant one; outside the window, on the ngo-backend side, it simply won't match (and nothing re-attempts it later, per §20's dead-cron finding).
- **Device clock vs. server clock:** the APK stamps its own device-local time (`TimeFormatter.toUTC`, converted from the phone's system clock) into every payload `[APK agent]` — there is no server-side clock-skew correction or validation of the device-reported timestamp against the server's own receipt time anywhere found in either backend. A phone with a meaningfully wrong clock could push a detection outside the matching window (or, worse, inside a window it shouldn't be in) with no correction applied.
- **Time-zone normalization:** consistently UTC at the wire-payload level (APK sends ISO-8601 `Z`-suffixed timestamps; MySQL/Mongo both store as UTC by convention) — no time-zone-specific bug pattern was found, though the *lack* of skew-correction above is a real, distinct risk from time-zone handling itself.

---

## 25. Screenshot/Proof Handling

**End-to-end trace:**

```
Checkout: customer picks "Upload screenshot" → <input type="file"> renders → NOTHING WIRED
  → onContinue() sends confirmation_type:'screenshot' with NO file, NO screenshot_path
  → orderController.claimPaid stores screenshot_path: req.body?.screenshot_path (always undefined
    for a Checkout-originated claim, since it's never sent) → column stays NULL
```

- **Does the system accept screenshot upload from the customer?** No — the UI offers it, the backend has a column ready for it (`Order.screenshot_path`), but no code anywhere connects the two. **This is the clearest instance in the entire audit of a feature that is UI-complete, backend-ready, and entirely unwired in between.**
- **MIME/size validation, malware scanning:** not applicable — nothing is ever uploaded from Checkout, so there's nothing to validate. No `multer` or any file-upload middleware exists anywhere in the MySQL backend (confirmed by a repository-wide grep).
- **Amount/UTR/payee/timestamp extraction from a screenshot, reused-screenshot detection, perceptual hashing:** none of this exists anywhere in either backend for the *customer-submitted* screenshot concept — because no customer screenshot is ever actually received.
- **Is a screenshot alone ever treated as proof of payment / used directly for auto-confirmation?** **No — but not for a reassuring reason.** It's not that the system deliberately weights screenshot evidence low or requires corroboration; it's that the customer-facing screenshot pathway is simply non-functional, so the question of "how much should we trust a screenshot" never actually arises in practice for inbound order confirmation. The task's stated principle ("a screenshot alone must not be treated as proof of payment") is **not violated**, but only because the feature doesn't work, not because of a considered confidence design.
- **A real, working, different screenshot mechanism does exist — for the opposite direction.** `OverlayCapture` (ngo-backend) genuinely stores a base64-encoded, on-device accessibility-read screenshot, but it's produced by the **trader's own APK** when the trader is manually recording an *outgoing* payment they're sending (§18a), feeding `payoutVerifier.matchDebitWithOverlay` — a four-factor cross-check (amount/last-4/time/sender-legitimacy) against a real bank debit SMS before a `Payout` proof record is created. This is a genuinely well-built, multi-signal verification pipeline — it is simply unrelated to the customer-checkout screenshot flow the task is asking about, and it is easy to conflate the two given both are called "screenshot"/proof mechanisms in the same codebase.
- **The one endpoint that does accept a live screenshot from the trader side, `POST /api/apk/screenshot`, explicitly does not persist the image at all** — it's relayed live over the socket to whoever's watching the trader's dashboard in that moment and then discarded `[ngo-backend agent]`. So even on the side of the system where screenshot capture genuinely works end-to-end, long-term storage/retention of the image itself does not happen for that particular endpoint (the `OverlayCapture` collection, a separate endpoint, is the one that does persist).

---

## 26. Duplicate Detection

| Signal | Dedup mechanism | Where |
|---|---|---|
| Same SMS delivered twice (rare OS behavior) | None | SMSReceiver — no debounce/signature check |
| Same notification re-posted (e.g., progress update) | None | NotificationService — every `onNotificationPosted` from an allowed package is a new event |
| Same UTR across two ingestion events | Confidence-scoring only dedups by *engine type* (a `Set` of distinct engines, so two `sms` transactions for one order don't double-count) — no ingestion-time UTR dedup at all | `smartMerge.computeConfidence` (MySQL, unreachable-by-APK path) |
| Same UTR across two *different orders* | Only at settlement time, only in MySQL, only for already-`is_merged` transactions (§23) | `smartMerge.isDuplicateUtr` |
| Same screenshot reused | Not checked anywhere (no perceptual hashing, no reuse detection) | — |
| Same amount/time/account (structural collision) | Prevented at the *routing* layer (same-amount lock), not the *matching* layer | `routingEngine` |
| APK retries the same detection payload | Not applicable — the APK never retries (§15, no retry logic exists at all); each detection is posted exactly once, successfully or not |
| Notification and SMS representing the same real payment | **Not merged/deduplicated as "one event" anywhere** — both are independently created as separate `RawEvent`/`Transaction` rows; the MySQL confidence engine's `Set`-of-engines approach is the closest thing to a merge, and it operates on *already-ingested* rows for scoring purposes, not as an ingestion-time merge | `smartMerge.computeConfidence` |
| Scraper finding a transaction already detected via SMS/notification | Deduped on `(accountId, utr/txnId)` within the scraper's own `Transaction` writes, but **not cross-checked against `RawEvent`/`DebitSMS` from the same real-world payment** — these remain three separate documents in three separate collections describing (potentially) the same event | `webScraper.js` `[ngo-backend agent]` |

**How multiple signals should merge into one normalized payment (intended design, reconstructed):** the MySQL side's design intent is visible and sound — one `Order`, many `Transaction` rows (one per detection), a confidence score computed from the *distinct set* of engines that reported, auto-confirm above threshold. The device-side `PaymentMerger.java` class was evidently intended to do this merging *before* transmission (its Javadoc describes a three-way SMS/notification/screen merge) but per the APK agent's trace, **no code path ever actually calls it with more than one real source populated** — each engine posts independently and immediately, so any real merging that happens, happens server-side (MySQL's `Set`-based confidence scoring) or not at all (ngo-backend has no equivalent merge step — it just finds whichever single `Transaction` matches first).

---

## 27. Confidence Scoring

**Three separate, non-communicating confidence concepts exist:**

1. **APK-local (`PaymentMerger.java`), device-side only, never transmitted:** additive — SMS=30, Notification=40, Screen=30, capped at 100 — used only to label a screen-capture event for the local on-device log/UI, not sent to any backend `[APK agent]`.
2. **MySQL `smartMerge.js`, real and complete, but orphaned:** base scores per engine (`sms:40, notification:60, screen_scraper:100, manual:100`), combined via distinct-engine `Set` membership (`notification+sms → 85` hardcoded, not summed), `AUTO_CONFIRM_THRESHOLD = 85`. Mandatory gates: not-already-settled, amount within ±₹1, UTR not already used to settle a different order. Below 85 on a `pending`/`checkout_open` order → moves to `claimed_paid` for review; there is no distinct "reject" outcome — everything either auto-confirms or waits for a human, there's no automatic low-confidence rejection path.
3. **ngo-backend `matchingEngine.js`, the one actually exercised:** **no confidence score at all** — binary match/no-match on amount+time(+ngoId).

None of the three feed each other. The system the task asks to compare against (mandatory gates + weighted evidence + tiered auto-confirm/review/reject outcomes) is **most fully realized in #2**, which is real code, not an inference — but it is not the system actually processing real payments today, per §20.

---

## 28. Auto Confirmation

**Trace of every path that can set `Order.status = 'success'`, and whether each uses the central settlement function (`balanceService.settleOrder`, invoked exclusively via `smartMerge.confirmOrder`):**

| Path | Entry point | Uses `smartMerge.confirmOrder` → `balanceService.settleOrder`? | Consequence |
|---|---|---|---|
| Auto-confirm via detection (Engines 1–3) | `smartMerge.mergePaymentData` (confidence ≥85) | **Yes** | Full, correct settlement — but this path is never fed by the real APK |
| Admin manual confirm | `adminController.confirmOrderV2` | **Yes** | Full, correct settlement |
| Trader manual confirm (Engine 4) | `paymentController.manual` | **Yes** | Full, correct settlement — **but see §34: no ownership check, any trader/admin can confirm any order** |
| Legacy generic override | `adminController.updateOrder` (`status:'success'`) | **Yes** (routes through the same `smartMerge.confirmOrder` call) | Correct |
| **NGO auto-verification callback** | `orderController.verifyPayment` | **No** — direct `order.update({status:'success', ...})`, never calls `smartMerge` or `balanceService` at all | **Merchant balance never credited, trader balance never debited, platform revenue never accrued, no `payment.success` webhook fires — for a real, order-closing, dashboard-and-reporting-visible "successful" order.** |

This is the single most severe correctness bug found across the entire payment flow, and it sits exactly on the seam between the two systems: **the one settlement-bypassing path is also the one path the real, currently-shipped Android app's detection results actually flow into** (via ngo-backend's matching engine → `notifyP2PBackend`). Every other path that correctly settles money is, today, either admin-manual or fed by a detection channel the real app never uses.

**Full happy-path sequence for the one auto-confirm path that IS correct** (for completeness, since it's real code): candidate `Transaction` selected → confidence ≥85 checked → `order.update({status:'success', confirmed_at, ...})` → `Transaction.update({is_merged:true})` → `balanceService.settleOrder` runs inside a DB transaction (trader debited, merchant credited, order's fee-breakdown columns filled) → `settings.platform_revenue_usdt` incremented (outside that transaction, best-effort) → daily-usage counters incremented, trader released back to the routing pool → sockets emitted (`order:confirmed`/`order:success` to merchant/admin/order-room) → `telegramService` notifies the trader → `webhookService.sendWebhook('payment.success')` enqueued. Idempotent by construction (`if (order.status === 'success') return order;` guards the whole function).

---

## 29. Manual Review

Per `ADMIN_ARCHITECTURE.md` (already-completed companion audit), the Admin Orders page is where `claimed_paid`/`under_review` orders land for a human decision — Review → Confirm/Reject/Dispute, all genuinely wired to the correct backend endpoints (`ADMIN_ARCHITECTURE.md` §7.5).

**The finding worth re-stating here, now that the full detection picture is known:** the Admin order-detail modal's "Payment Detection" section (confidence score, contributing engine badges) and "Raw SMS / Notification Data" section are **always empty** — `orderController`'s admin-facing order mapping hardcodes `confidence: null, engines: [], rawSms: null` (per the Admin audit's direct code citation). Now that this document has traced *where the real evidence actually lives* — Mongo `RawEvent`/`DebitSMS`/`Transaction` documents in ngo-backend, or MySQL `Transaction` rows for the (unreachable) System-A path — the reason for that emptiness is fully explained: **the admin review screen has no query into either real evidence store.** An admin reviewing a `claimed_paid` order today is deciding based on the order's own fields (amount, customer ref, whatever UTR the *customer* typed) and their own judgment — not on any detected signal, confidence score, or raw bank/UPI message, despite the UI being laid out as if that evidence were present. There is no reassign/unmatch action on the Admin Orders page (only Review/Confirm/Reject/Dispute + a manual status-override select), no maker-checker second-approval step, and no duplicate-order warning surfaced in the review UI even though the matching layer's duplicate-UTR check exists elsewhere in the code. Every admin action (confirm/reject/dispute/resolve) does write to the `Dispute`/`Order` tables and is attributable to `req.user.id` in the underlying data (`reviewed_by`, `raised_by`), but there is no dedicated, queryable audit-log table separate from the mutated rows themselves.

---

## 30. Settlement and Ledger

**MySQL (`balanceService.js`) — the real trader/merchant financial ledger:** every settlement writes an append-only `BalanceLog` row per trader-side balance change and mutates `Trader.balance_usdt`/`Merchant.balance_usdt` directly, inside a DB transaction. `Settlement` rows exist as a separate, batch-oriented concept (written by `jobs/settlementJob.js`, which per the Merchant audit uses a *different*, legacy rate-calculation model than the real per-order settlement path — a pre-existing, independently-documented inconsistency, not re-litigated here).

**ngo-backend (`ledgerService.js` + `Ledger` model) — a completely separate, hash-chained donation ledger, per NGO, denominated by donation event, not by trader/merchant USDT balance** `[ngo-backend agent]`. Genesis hash `'0000000000'`, each entry's hash = SHA-256(prevHash + entry contents), independently verifiable via `ledgerService.verifyChain()` — a genuinely strong integrity mechanism, but for a record that **has no reconciliation path back to the MySQL balances at all**, beyond the one-shot `notifyP2PBackend` callback which (per §28) doesn't even touch the MySQL balance columns when it succeeds.

**Net effect:** there are, in production, **two financial records of "what Max Pay received," and they are not required to agree.** The Mongo `Ledger` records what ngo-backend's matching engine believes was donated/paid; the MySQL `balance_usdt`/`Settlement`/`BalanceLog` records what the MySQL settlement service believes was earned — and the only bridge between them (order-status flip via `verify-payment`) explicitly does not move any balance. A platform operator trying to answer "how much money came in this month" would get two different, both-plausible-looking answers depending on which system they asked.

---

## 31. Webhooks and Realtime Events

**Merchant-facing webhooks (MySQL `webhookService.js`, real, HMAC-SHA256-signed, BullMQ-retried 3x with exponential backoff):** fires on `order.cancelled`, `order.expired`, `order.stale_review`, `payment.success` — **the last one only from the settlement-correct paths in §28's table, never from the NGO-verification path**, which is the path real detections actually flow through. Per `MERCHANT_ARCHITECTURE.md` §6.8/§14, the Merchant panel's own UI additionally cannot configure this webhook URL at all (a separate, already-documented frontend gap) — compounding the practical unreachability of this otherwise well-built system for most real order confirmations today.

**Socket rooms** (`websocket/index.js`, shared by Admin/Merchant/Trader panels and Checkout): `admin`, `trader:{id}`, `merchant:{id}`, `order:{uuid}` (anonymous-joinable, used exclusively by Checkout). Checkout's own socket coverage gap (missing `order:rejected`/`order:disputed`/`order:completed` listeners) is documented precisely in §5.

**ngo-backend's own socket layer** (`app.locals.io`, per-NGO room) emits `device-registered`, `raw_event`, `debit-detected`, `overlay-captured`, `outgoing-payment`, `newDonation`, `donation_intent`, `account-status`, `screenshot-received`, `new-transactions` — entirely separate infrastructure from the MySQL backend's Socket.IO server, with **no cross-system event bridge**; nothing in ngo-backend re-emits onto the MySQL backend's socket rooms or vice versa (the only cross-system signal is the one HTTP callback, `notifyP2PBackend`).

**Polling fallbacks:** Checkout polls every 3s regardless of socket state (§5) — the most robust piece of real-time handling in the whole flow, since it degrades gracefully to full correctness (just slower) if sockets are unavailable. No equivalent polling fallback was found on the ngo-backend/trader-panel side of the detection pipeline — if `checkMatch`/`matchWebhook`'s one-shot triggers are missed (§20's dead-cron finding), there is no periodic re-check to catch it later.

**What happens if sockets disconnect during payment:** on Checkout, nothing breaks — the poll continues independently and will eventually reflect the true state. On the trader/detection side, a disconnected `useSocket` in the panels only affects *toast notifications and live-refresh UX*, not the underlying detection/matching pipeline itself, which is entirely HTTP-POST-driven and doesn't depend on any socket connection to function.

---

## 32. Database and Constraints

| Table/Model | PK | Notable FKs | Unique constraints | Notable indexes | Financial/snapshot fields | Soft delete? | Idempotency keys |
|---|---|---|---|---|---|---|---|
| `orders` (MySQL) | `id` | `merchant_id, trader_id, payment_detail_id` | `uuid`, `gateway_order_id`, `(merchant_id, merchant_order_id)`, **generated-column same-amount-lock (§8)** | `status`, `merchant_id`, `trader_id`, `expires_at` | `exchange_rate, trader_rate, admin_rate, amount_usdt, trader_deduction_usdt, merchant_receives_usdt, platform_profit_usdt` | No | The same-amount-lock unique index is the closest thing to a true idempotency key; no explicit client-supplied idempotency-key field exists for order creation itself (a merchant retrying `POST /orders/create` with identical params would create a second, distinct order unless they also supplied a `merchant_order_id`, which is optional) |
| `transactions` (MySQL) | `id` | `order_id` (SET NULL on delete), `smartphone_id` (SET NULL) | none | `utr_number` (**non-unique**), `order_id` | `amount_detected, confidence_score` | No | None |
| `payment_details` (MySQL) | `id` | `trader_id`, legacy `smartphone_id` (dead), `ngo_device_id` (string, no FK — cross-database) | none | `trader_id`, `is_active` | `daily_limit, today_used`, multiple window caps | No | None |
| `merchants` (MySQL) | `id` | `user_id` | `user_id`, `api_key` | `is_active` | `balance, balance_usdt, payin/payout_fee_percent` | No | None |
| `smartphones` (MySQL) | `id` | `trader_id` | `device_id` | `trader_id`, `is_online` | — | No | — |
| `Device` (Mongo) | `_id` | `ngoId` | `deviceId` (implied by lookup pattern) | — | — | Not observed | `deviceToken` functions as a bearer credential, not an idempotency key |
| `RawEvent` (Mongo) | `_id` | `deviceId, ngoId` | **none** | — | `amount` | Not observed | **None — every POST creates a new document, no dedup key** |
| `Transaction` (Mongo, ngo-backend) | `_id` | `ngoId, accountId` | dedup on `(accountId, utr/txnId)` at write time (application-level, not a Mongo unique index per the agent's trace) | — | `amount` | Not observed | Application-level only |
| `Ledger` (Mongo) | `_id` | `ngoId` | — | — | `amount, prevHash, hash` (hash-chained) | Not observed | The hash chain itself is a strong tamper-evidence mechanism, though not a request-idempotency key |

**Missing constraints most relevant to safe matching, stated directly:** (1) no unique/dedup constraint on `transactions.utr_number` in MySQL — a genuine gap given UTR is explicitly meant to strengthen a match; (2) no dedup key at all on ngo-backend's `RawEvent` — a retried or duplicated APK POST (were retries ever added) would create unbounded duplicate rows with nothing to collapse them; (3) no `smartphone_id`/device column on `orders` itself (only inferable after the fact via `Transaction.smartphone_id`) — makes "which device actually detected this order's payment" a query-time join rather than a stored fact.

---

## 33. Failure Scenarios

| # | Scenario | Current behavior | Correct expected behavior | Data-consistency risk | Customer experience | Merchant experience | Admin action required |
|---|---|---|---|---|---|---|---|
| 1 | Customer pays exact amount successfully | Works correctly **only** via the MySQL confidence engine (unreachable by real APK) or admin manual confirm; via the real APK→ngo-backend path, order closes but balance is never credited (§28) | Order settles, balance moves, webhook fires, checkout shows success | **High** — "success" is not always financially true | Sees Success screen either way — cannot tell the difference | May see a "successful" order with no corresponding balance increase | Reconcile Mongo `Ledger` vs. MySQL balance manually |
| 2 | Customer clicks "I Paid" without paying | Order → `claimed_paid`, sits for review; `staleClaimSweep` flips it to `under_review` after 30 min if untouched | Same — correctly does not auto-confirm on the claim alone | Low | Sees "Verifying…" indefinitely until an admin/detection resolves it | No false credit (correct) | Reject once satisfied no real payment occurred |
| 3 | Customer enters a fake UTR | Accepted and stored verbatim; never independently verified against any detected transaction | Should never, alone, move an order past `claimed_paid` | Low (correctly, a fake UTR alone cannot trigger settlement) | Same "Verifying…" state | No impact unless an admin is misled during manual review | Cross-check UTR against detected evidence — which the admin UI cannot currently show (§29) |
| 4 | Customer uploads a fake screenshot | **Impossible — the upload control does nothing** (§25) | Should be stored as evidence only, never sufficient alone | None (feature doesn't function) | Believes they submitted proof; they did not | Unaffected | None possible today |
| 5 | Customer reuses an old screenshot | Same as #4 — no upload occurs | Should be caught by reuse/perceptual-hash detection | None (feature doesn't function) | Same false belief as #4 | Unaffected | None |
| 6 | Customer pays the wrong amount | No detected transaction will match the order's exact amount; order stays `claimed_paid`/expires | Correctly does not auto-confirm | Low | Stuck in "Verifying…", eventually needs manual resolution | Confused customer complaints, no matching transaction to point to | Manually locate the mismatched payment and resolve out-of-band |
| 7 | Customer pays after expiry | Order already `failed`; a genuinely-received payment has no order to attach to | Needs a manual reconciliation path | **Medium** — real money with no linked order | Sees "Order Expired," money already sent | Discovers a stray real payment with no matching order | Manual investigation, likely a goodwill/manual settlement outside the normal flow |
| 8 | Customer pays before Checkout opens | Not structurally possible in the current v2 design — the trader/account is assigned at order creation, before the checkout URL is ever shared, so "before checkout opens" and "after order creation" are effectively the same window | — | Low | — | — | — |
| 9 | Two customers pay the same amount to the same UPI account | Structurally prevented by the routing-layer same-amount lock (only one active order per account+amount can exist) — a *second* customer simply cannot be assigned that same (account, amount) pair while the first is active | Correct, DB-enforced | Low | Second customer would get a different account/amount pairing entirely | No impact | None |
| 10 | One SMS and one notification report the same transaction | MySQL engine: correctly treated as one order's confidence contribution (Set-based, `notification+sms→85`) — but this engine is unreachable by the real APK. ngo-backend: creates two independent `RawEvent` docs with no cross-dedup (§26) | Should merge into one confirmed transaction | Medium — duplicate evidence rows, not duplicate money movement (matching still only confirms the order once) | No visible impact | No visible impact | None typically needed |
| 11 | Notification arrives before SMS | No ordering dependency in either engine — whichever arrives first is processed first; the later one is redundant evidence | Fine as-is | Low | None | None | None |
| 12 | SMS arrives ten minutes late | Outside ngo-backend's 10-minute `MATCH_WINDOW_MINUTES` — would likely fail to match a fresh `Transaction`, and since `runMatching` is dead (§20), nothing retries it later | Should have a longer grace window or a retry sweep | Medium | Payment may go unmatched despite being real | Same as #6/#7 | Manual resolution |
| 13 | APK goes offline after assignment | Nothing detects this at assignment time (§11) — the order simply runs its full 10-minute timer with zero chance of automatic detection, then expires | Should ideally reassign or flag proactively | Low (fails safely — customer isn't charged incorrectly, just inconvenienced) | Order expires with no explanation of why | Lost conversion, no visibility into "this trader's device was down" | None automatic — would need to notice the pattern manually |
| 14 | Payment account disabled after order creation | The order already holds its assignment (`trader_id`/`payment_detail_id` fixed at creation) — disabling the account afterward doesn't retroactively affect the in-flight order, only future routing decisions | Reasonable — correct not to disrupt an in-flight order | Low | No impact on this specific order | No impact on this specific order | None |
| 15 | Device clock is incorrect | No skew detection/correction anywhere (§24) — a detection could fall outside (or wrongly inside) the matching time window | Should validate/correct against server receipt time | Medium | Payment might go unmatched | Same as #12 | Manual resolution; potentially a systemic issue if one trader's phone is consistently wrong |
| 16 | Merchant retries the same create-order request | Without a `merchant_order_id`, a full duplicate order (and a real second checkout URL/account assignment) is created — no idempotency key protects against this | Should support an idempotency key or dedupe on rapid identical requests | **Medium** — silent duplicate order creation, consuming a second account+amount slot for no reason | A customer could receive two checkout links for what the merchant intended as one order | Confusing order list, potential accidental double-charge exposure if both are somehow paid | Manually identify and cancel the duplicate |
| 17 | APK retries the same detection payload | Not applicable in practice — the APK has no retry logic at all (§15); this scenario cannot currently occur from the shipped app | If retries were ever added, ingestion has no dedup key to catch it (§32) | Would become Medium if retries were added | — | — | — |
| 18 | Matching worker crashes after order success but before balance credit | Cannot happen in the *correct* settlement path — `balanceService.settleOrder` runs inside one DB transaction alongside the status update, so a crash mid-way rolls back atomically. **Can and does effectively happen "by design" on the NGO-verification path**, where the status update and the (never-attempted) balance credit are simply two different code paths that were never joined in the first place (§28) | Should always be one atomic operation | **High**, specifically for the NGO path | Sees Success regardless | Balance may not reflect a "successful" order | Manual balance reconciliation |
| 19 | Webhook fails after settlement | BullMQ retries 3x with exponential backoff (real, working) for the correct-settlement paths; silently never fires at all for the NGO-verification path (not a delivery failure — it's simply never enqueued) | Should always fire once settlement is real | Low (delivery retry works where it's used) / **effectively always "failed"** for the NGO path (never attempted) | No impact | Integration silently misses events for NGO-path orders | None automatic; merchant would need to notice via reconciliation |
| 20 | Admin confirms an already-settled order | `smartMerge.confirmOrder` and `adminController.confirmOrderV2`/`updateOrder` are guarded against a `success`-status order (early return / explicit status checks) — correctly idempotent | Correct as-is | Low | No impact | No impact | None |
| 21 | NGO verification confirms an order | This *is* the buggy path documented throughout §8/§20/§28/§30 | Should route through the same settlement function as every other confirmation path | **High** | Sees Success | Balance not credited, no webhook | Manual reconciliation |
| 22 | Screenshot upload succeeds but payment does not exist | Cannot occur — no screenshot upload path exists from Checkout (§25) | Should never auto-confirm from a screenshot alone regardless | None | N/A | N/A | N/A |
| 23 | UTR belongs to another account | Neither engine's account-matching is consistently enforced (§21), so a UTR/detection genuinely belonging to a different account could still match this order's amount if no account filter was applied for that detection source | Should hard-reject on an account mismatch when the account is known | **Medium-High** depending on how often SMS-only (unfiltered) detection is the operative path | Could see false success | Could receive credit that was never actually intended for their account | Would require a specific investigation to even notice |
| 24 | Same UTR is submitted for two orders | MySQL: caught only if the *first* order already has `is_merged:true` (§23) — a genuine race between two near-simultaneous confirmations is possible. ngo-backend: not checked at all (UTR isn't a match key) | Should be a hard, DB-enforced unique constraint | **Medium** | Whichever order loses the race sees an unresolved state | Possible double-crediting risk in the race case | Manual investigation |
| 25 | Customer closes and reopens Checkout | Fully safe — no client state is relied upon, the page re-derives everything from the server on load (§6) | Correct as-is | Low | Seamless — resumes exactly where the order's real status says it should | No impact | None |

---

## 34. Security and Fraud Risks

*(Documentation of risk only — no exploitation performed or described.)*

**Cross-system, highest severity:**
- `POST /api/orders/verify-payment` (MySQL) is **unauthenticated** — the route file's own comment flags this. `POST /api/checkout/verify` (ngo-backend, the call the MySQL backend makes) is **also unauthenticated on ngo-backend's side**, and nothing authenticates that a `notifyP2PBackend` call actually originated from the real ngo-backend rather than any other caller who knows the shape of the payload. Two open endpoints, chained, each trusting the other's caller identity implicitly — a fabricated call to either, with a plausible `orderId`/`ngoId`/amount, can influence real order state.
- `POST /api/payment/manual` (MySQL, Engine 4) has **no ownership check** — any authenticated trader (not just the order's assigned trader) or admin can confirm/settle **any** order in the system by `order_id` alone, per direct code reading in §28/§20a. This is a concrete authorization gap, not a hypothetical one.

**ngo-backend `apk.js`:** only `POST /api/apk/event` (the endpoint that actually feeds real-time matching) requires the `deviceToken` header; every other endpoint — `register-device`, `update-device-name`, `heartbeat`, `debit-sms`, `overlay-capture`, `outgoing-payment`, `screenshot`, `update-purpose` — has **no authentication at all**, trusting a caller-supplied `deviceId`/`licenseKey` alone `[ngo-backend agent]`. The outgoing-payment proof pipeline (§18/§30, arguably the most fraud-sensitive one, since it underlies real payout verification) rides on two of these unauthenticated endpoints (`debit-sms`, `outgoing-payment`).

**APK-side (device):** `android:allowBackup="true"` + plaintext `SharedPreferences` means the device token and license key are extractable via backup/extraction on a non-hardened device; `android:usesCleartextTraffic="true"` permits plaintext HTTP if the configured server URL were ever downgraded from HTTPS; the hardcoded `SERVER_BASE_URL` is a Cloudflare Quick Tunnel address (ephemeral by nature) baked into the shipped APK; release builds are unobfuscated (`isMinifyEnabled=false`) `[APK agent]`.

**SMS/notification trust model:** SMS sender validation is a plain substring heuristic with no cryptographic backing (inherent to SMS as a medium, not fixable at the app layer, but worth stating plainly as a trust boundary); notification package-name attribution is OS-enforced and not independently re-verified by the app, which is standard/acceptable practice, not a gap.

**Order enumeration:** `GET /orders/:id` and `GET /orders/:id/checkout` accept either a numeric `id` or a `uuid` — the `uuid` path is not sequentially guessable, which is the correct mitigation; the numeric-`id` path, if ever reachable directly by a customer-facing client, would be trivially enumerable, though Checkout itself only ever uses the `uuid`.

**Rate limiting:** `config.security.rateLimitWindowMs`/`rateLimitMax` exist in the MySQL backend's config but — per this and the two companion audits — no route file was observed actually applying a rate-limit middleware; the unauthenticated endpoints above have no observed throttling.

**Audit logs:** neither system has a dedicated, queryable audit-log table distinct from the mutated business rows themselves (§29) — attribution exists (`reviewed_by`, `raised_by`, JWT `req.user.id` in logs) but there's no single place to answer "show me every sensitive action taken this week."

**File-upload security:** not applicable to Checkout (no upload path exists, §25); ngo-backend's `/api/apk/screenshot` accepts a base64 image with no observed size/MIME validation before relaying it over the socket `[ngo-backend agent]`.

---

## 35. Performance and Scalability

- **`paymentController.matchOrder`** (MySQL): unbounded by time, only filtered by active status + amount(+trader) — fine at low order volume, would scan a growing "active orders" set as volume grows since there's no time-window bound to shrink the candidate set (mitigated somewhat by orders naturally leaving "active" status quickly via the 10-minute expiry).
- **`computeWindowUsage`**: a genuinely live, unindexed-beyond-`payment_detail_id`/`created_at` query, run **per candidate account, per order-creation attempt** whenever any window cap is configured — at high order-creation throughput with many accounts each carrying month-long windows, this could become a meaningful per-request cost; it is explicitly a deliberate trade-off (accuracy over raw speed, per its own code comment) rather than an oversight.
- **`webScraper.js`**: one Playwright browser session per trading account, polling on a 60-second `setInterval`, held in an in-memory `SessionStore` — this scales linearly with the number of scraper-connected accounts and does not survive a server restart (all sessions would need to re-authenticate) `[ngo-backend agent]`. This is the least horizontally-scalable component in the entire system.
- **ngo-backend's `matchingEngine.checkMatch`**: a linear scan over pending webhooks/transactions for a given `ngoId`+amount — fine at low volume, no index/window bound beyond the fixed `MATCH_WINDOW_MINUTES`/`WEBHOOK_EXPIRY_MINUTES` constants was confirmed to exist on the query itself.
- **No caching layer** was found in either the routing engine's per-order eligibility computation or the matching engines — every order creation and every detection event re-runs its full eligibility/matching query fresh, which is correctness-safe but not optimized for very high throughput.
- **Realtime fan-out**: both Socket.IO servers (MySQL backend and ngo-backend) are independent, in-process instances with no observed adapter for horizontal scaling (e.g., a Redis adapter for multi-instance Socket.IO) — fine for a single-process deployment, would need addressing before running either backend as more than one instance.

---

## 36. Product and UX Analysis

*(Requirements and gaps only — no redesign proposed, per the task's explicit instruction.)*

- **What should the customer see before paying?** The exact amount (prominently, ideally larger/bolder than it currently renders), the exact account to pay, and — critically, and currently missing — an explicit "pay this exact amount, this exact account, only once" instruction explaining *why* precision matters (the same-amount-lock architecture makes this materially true here, not just boilerplate advice).
- **What must be visually emphasized?** Amount and UPI ID, unambiguously — both are present but compete for attention with equally-weighted payee-name/bank-name tiles; today's page treats all four roughly equally.
- **How should the exact amount be shown?** As currently done (large, formatted with the ₹ symbol) is reasonable; the gap is the missing "exact amount required" framing above, not the number's rendering itself.
- **How should QR and UPI-app buttons work?** QR works correctly. "UPI app buttons" should deep-link directly into the named app (the code to do this, `upiLink()`'s multi-scheme support, already exists and is simply disconnected from any rendered control, §6/§14) — today, only manual copy-and-switch-apps is possible.
- **When should "I Paid" become available?** Immediately (as today) — gating it behind, say, a minimum elapsed time would only frustrate genuinely fast payers with no fraud benefit, since the claim never auto-confirms anything by itself anyway.
- **Should UTR be mandatory?** Not mandatory, but the current three-way framing ("Recommended," "Visual proof," "may take longer") is honest about *incentive* while being silently dishonest about *capability* — the "visual proof" option should not be offered as a distinct, seemingly-stronger choice until it actually does something (§25); today it's a UX promise the backend can't keep.
- **Should screenshot be optional?** Yes, if/when it's actually implemented — but it should never be sufficient alone regardless of implementation status, consistent with the task's stated principle, which the current (non-functional) state happens to satisfy by accident.
- **What should happen while matching is in progress?** The current `ProcessingScreen` ("Verifying your payment…", spinner, "do not close this page") is a reasonable pattern; the gap is entirely on the backend side (§20's connective bug) rather than the UI's presentation of the waiting state.
- **How long should the customer wait?** Not clearly bounded today — a claim can sit in `claimed_paid` for up to 30 minutes before `staleClaimSweep` even flags it for admin attention, with no customer-visible escalation or explicit "this is taking longer than usual" messaging at any intermediate point.
- **When should support become available?** Already always available (static WhatsApp link on every relevant screen) — the gap is that it's not order-aware (§6), which materially slows down real support triage.
- **What should happen after expiry if money was already paid?** This is scenario #7 (§33) — today there is no dedicated recovery flow; a customer whose money is real but whose order expired has no in-product path forward beyond generic support contact, despite this being an entirely foreseeable, non-rare scenario for any payment gateway with a hard countdown.
- **How should payment failure differ from payment pending?** Today "failure" (`FAILED` step) is unreachable dead code (§5) — every real terminal-negative outcome routes through either `EXPIRED` (timeout) or `REJECTED` (admin decision), which conflates "nothing happened in time" with "we looked and said no" — these deserve genuinely distinct messaging, since the customer's correct next action differs (retry a fresh order vs. contact support about a specific rejection reason).
- **How should Checkout explain manual review?** The `DisputedScreen`'s "Under review... we will update you shortly" is reasonable in tone; it does not set any time expectation, which — given the current architecture's 30-minute stale-claim threshold before an admin is even alerted — risks under-promising relative to how long "shortly" might actually take.
- **What information should never be exposed to the customer?** Internal routing/engine details (trader ID, which detection engine fired, confidence scores, raw SMS/notification text) — correctly, none of this is currently exposed anywhere in the Checkout UI or its API responses; this is one area with no gap found.
- **What should Checkout show when the assigned APK/device goes offline?** Nothing does today, because nothing *detects* it today (§11/§13 of the assignment trace) — this is a backend-assignment gap surfacing as a UX gap: the customer simply watches a countdown run out with no indication that the underlying cause was a dead device rather than "the customer was just too slow."
- **What should happen when assignment fails before Checkout opens?** Correctly handled — no order, no checkout URL, the merchant sees the 503 and (per `MERCHANT_ARCHITECTURE.md`) the dashboard's own Create-Order modal renders a dedicated, well-designed "P2P is unavailable right now" state. The customer is never involved in this failure mode at all, which is the right boundary.

---

## 37. Production Readiness Matrix

| Component | Ready today? | Notes |
|---|---|---|
| Checkout — payment display (QR/UPI/copy) | Yes | |
| Checkout — claim-paid + polling + socket (partial) | Partial | Missing 3 event listeners (§5) |
| Checkout — UTR proof | Partial | Length-only validation |
| Checkout — screenshot proof | **No** | Entirely unwired |
| Checkout — UPI-app deep links | **No** | Built, not rendered |
| Order creation (both paths) | Yes | Shared, correct, well-validated |
| Routing/assignment (trader+account) | Yes | Strong DB-level race protection |
| Fair load distribution | **No** | Not implemented (by design or oversight — undetermined) |
| Device-online awareness in routing | **No** | Not checked at all |
| MySQL detection engines 1-3 (SMS/notif/screen) + smartMerge | Built, correct | **Unreachable by the real app** |
| MySQL Engine 4 (manual/trader) | Partial | Works, but no ownership check |
| ngo-backend APK detection (SMS/notif/accessibility) | Yes (real, live) | Auth inconsistent across endpoints |
| ngo-backend matching engine | Partial | No confidence model, no account/UTR gate |
| ngo-backend → MySQL settlement bridge | **No — critical bug** | Skips real settlement entirely |
| Checkout-claim → ngo-backend matching trigger | **No — critical bug** | Never invoked |
| Paytm dashboard scraper | Yes (Paytm only) | No other platform implemented |
| MySQL settlement (`balanceService`) | Yes | Correct, transactional, idempotent |
| Merchant webhooks (MySQL) | Yes (mechanism) | Rarely fires for real-world orders today (bug above), and unconfigurable via Merchant UI |
| ngo-backend donation ledger | Yes (mechanism) | Not reconciled with MySQL balances |
| Outgoing-payment proof pipeline (payoutVerifier) | Yes | Genuinely solid, multi-factor |
| Admin manual review | Partial | Real actions, but zero real evidence surfaced |
| Screenshot storage/evidence | **No** | Neither customer path nor `/screenshot` endpoint persists for review |

---

## 38. Critical Bugs

Ranked by financial/data-integrity severity:

1. **NGO-verification success path bypasses settlement entirely** (§28) — orders close as `success` with no balance movement, no webhook, for what is today the primary real-world confirmation channel.
2. **Checkout's claim-paid flow never triggers ngo-backend's matching engine** (§20) — the one HTTP call that could start the real matching process for a claimed order is never made from the endpoint the main backend actually calls.
3. **`POST /api/payment/manual` has no ownership check** (§28/§34) — any trader or admin can settle any order by ID.
4. **Two unauthenticated, chained cross-backend endpoints** (`verify-payment` on MySQL, `checkout/verify` on ngo-backend) with no shared-secret/HMAC verification between them (§34).
5. **No unique constraint on `utr_number`** anywhere in MySQL, and UTR isn't even a match key at all in the engine that's actually live (§23).
6. **Account/UPI-ID matching is not consistently enforced** — SMS-sourced MySQL detections skip it entirely; ngo-backend's live matching engine never checks it at all (§21).
7. **Screenshot upload is fully non-functional** while presented to the customer as a distinct, stronger proof option (§25).
8. **Most `/api/apk/*` endpoints have no authentication**, including the two feeding the outgoing-payment proof pipeline (§34).
9. **No merchant-order-creation idempotency key** — a retried create call produces a genuine duplicate order (§33 scenario 16).
10. **Two independent, unreconciled financial ledgers** (MySQL balances vs. Mongo `Ledger`) with only a one-shot, non-balance-moving bridge between them (§30).

---

## 39. Missing Features

- **A real cross-system reconciliation job** — nothing today compares MySQL settlement state against ngo-backend's `Ledger`/`Transaction` state to surface divergence.
- **A device-liveness check inside routing** — the schema already has everything needed (`ngo_device_id` on `PaymentDetail`, `Device.isOnline()` server-side); routing simply never queries it.
- **A scheduled retry/sweep for ngo-backend matching** — `runMatching`/`node-cron` exists as a dependency and a function but is never wired; this alone would close a meaningful share of the "claimed but never resolved" gap.
- **Real screenshot ingestion + persistence for customer-submitted proof**, even if only stored as supplementary evidence for a human reviewer (per the task's own stated principle, it should never be sufficient alone).
- **Admin-visible detection evidence** — the data exists (Mongo `RawEvent`/`DebitSMS`/`Transaction`, MySQL `Transaction`), the Admin UI simply doesn't query any of it (§29).
- **Extension-point assessment for future detection sources** (per the task's Step 5D, evaluated without inventing implementation): the `Transaction`/`RawEvent` normalized-payload pattern already in place is generic enough to accept a **bank API feed** or **UPI PSP webhook** as a fifth "engine" with modest changes (a new `engine_used`/`type` enum value plus a new ingestion route) — the confidence-scoring model (`smartMerge`) is already engine-agnostic by design. An **account-aggregator** feed would fit the same shape. **Email-based proof** and **CSV/statement upload** would need genuinely new ingestion + parsing surfaces (nothing analogous exists today) but could reuse the same downstream `Transaction`/matching contract once ingested. **Merchant-provided proof** (a merchant asserting they see the payment on their own end) has no representation anywhere in either schema today — would be a net-new concept, not an extension of an existing one. **Additional Android detection plugins** slot naturally into the existing `RawEvent`/`type` pattern on the ngo-backend side, which is already engine-name-tagged and was clearly designed to accept more than SMS/notification/screen.
- **Multi-platform scraper coverage** — only Paytm is implemented despite PhonePe/BharatPe/GPay/AmazonPay being declared as supported platform values.

---

## 40. Recommended Fix Order

*(Priority framing only, per the audit's findings — not a redesign, not an implementation plan.)*

1. Route `notifyP2PBackend`'s callback through the same settlement function every other confirmation path uses — this single change closes the largest financial-integrity gap in the system.
2. Wire `checkout.js`'s `/verify` handler to actually invoke the matching engine (or schedule/enable `runMatching`) so claimed orders have a reliable path to resolution regardless of detection source.
3. Add an ownership check to `POST /api/payment/manual`.
4. Add a shared-secret or signed-request check between the MySQL backend and ngo-backend for the two callback endpoints.
5. Add a unique constraint on `utr_number` (scoped appropriately) and make UTR a genuine match input in whichever engine ends up authoritative.
6. Decide, deliberately, whether SMS-sourced detections need account verification before they can auto-progress a match, given the multi-account-per-trader same-amount scenario documented in §21/§23.
7. Either wire the screenshot upload end-to-end (as supplementary evidence only) or remove the option from Checkout until it does something real.
8. Add authentication to the currently-open `/api/apk/*` endpoints, prioritizing `debit-sms`/`outgoing-payment` given their role in the payout-proof pipeline.
9. Add an idempotency key to order creation.
10. Build the cross-system reconciliation job between MySQL balances and the Mongo ledger, even as a read-only alerting tool before any deeper integration is attempted.

---

## MY UNDERSTANDING OF HOW MAX PAY PAYMENT CONFIRMATION WORKS

In plain language, here is what actually happens today, and how it differs from the clean five-step model (merchant creates order → assignment engine picks trader/UPI/device → customer pays → APK detects → matching engine confirms → settlement → webhook → checkout closes) that a payment gateway is supposed to look like:

**Merchant creates order → Assignment engine chooses trader and UPI account.** This part **works exactly as intended** and is the strongest-engineered piece of the whole system. A shared service validates the order, auto-detects whether the customer is a first-time or repeat payer, and picks the first available trader and UPI account that can take the amount — with a genuinely strong, database-enforced guarantee that no two customers can ever be simultaneously assigned the same account for the same amount. What it does **not** do is pick a specific phone/device, or check that the phone behind the chosen account is actually online — device selection isn't a real step in this system at all, it's just assumed.

**Customer opens Checkout and pays.** This also **works well** — a clean, mobile-first page shows the QR and UPI ID, counts down a timer, and polls the backend every three seconds so it always eventually reflects the truth even if real-time updates are missed. The "upload a screenshot" option, however, **does not exist** despite being shown on screen — it's a leftover UI control with nothing behind it.

**"APK detects the incoming payment"** — here is where the real story diverges sharply from the assumed one. There are, in effect, **two APKs' worth of backend** in this codebase: a complete, correct one built inside the main payment-gateway backend (SMS/notification/screen engines feeding a real confidence-scoring auto-confirm system), and the one the shipped Android app **actually talks to**, which lives in a second, separate service (`ngo-backend`, running on MongoDB) that was originally built as a donation-matching product for NGOs and has been repurposed to also do this job. The real app reads SMS (gated by a bank-name allowlist), reads notifications (gated by an app-package allowlist), and — genuinely, via Android's Accessibility Service — reads the actual on-screen text of 13 payment apps to catch both outgoing and incoming payments. All of that detection reports to the *second* backend, not the well-built one.

**"Backend normalizes the payment signal" and "Matching engine compares account, amount, UTR, time, customer data, and evidence."** The well-built matching engine (weighted confidence scores, UTR duplicate checks, a real auto-confirm threshold) **exists and works correctly** — but it's sitting in the backend the real app doesn't talk to. The matching engine the real app's detections actually flow into is much simpler: it just checks whether the amount matches something pending, within a time window, for the same trader/NGO account. It does not check UTR, does not check which specific UPI account the money landed on, and has no confidence scoring at all.

**"High-confidence payment auto-confirms" / "uncertain payment goes to Admin manual review."** In the live system, there isn't really a graduated confidence tier at all — a detection either finds a matching pending claim within its time window (and the order closes) or it doesn't (and the order eventually needs a human, with no automatic escalation beyond a 30-minute staleness flag). And when an order *does* auto-close via this real path, it does so through a callback that — this is the single most important thing to understand about the whole system — **updates the order's status without ever running the actual settlement code.** The merchant's balance, the trader's debit, the platform's revenue, the signed webhook merchants can build on — none of that happens on this path. The order simply *looks* successful everywhere it's displayed (dashboard, order list, checkout success screen) while the money hasn't actually moved in the ledger that's supposed to represent reality.

**"Order closes only after financial settlement succeeds"** — this is true of the well-built path and **not true** of the path real payments actually take today.

**What already works, cleanly, without qualification:** order creation and validation; trader/account assignment and its race-condition protections; the Checkout page's resilience (polling, safe refresh, safe re-open); the correct settlement function itself, whenever it's actually invoked; the outgoing-payment (payout) proof-verification pipeline, which is a genuinely solid piece of independent engineering; and the merchant-webhook signing/retry mechanism, as a mechanism.

**What is partial:** manual admin review (real actions, but the admin can't actually see the detection evidence that's supposed to inform the decision); Checkout's real-time socket coverage (misses three event types the backend actually sends); the merchant webhook system (correct, but effectively unreachable for most real confirmations today because of the bug above, and separately unconfigurable through its own UI per the companion Merchant audit).

**What is inferred, not directly proven:** the exact intended confidence-tier design (reconstructed from `smartMerge.js`'s real, working code, which is the clearest evidence of intent even though it's not the code path in production use); the claim that "notification is the endpoint the matching engine actually reads" and "the debit-sms endpoint is currently unread server-side" — both are asserted in the APK's own code comments and independently corroborated by what `ngo-backend`'s routes actually do with each payload, but they are still comments-plus-cross-reference, not something this audit executed and observed directly.

**What does not exist at all:** customer screenshot upload/storage/matching; UPI-app deep-link buttons (built, never shown); language switching (Hindi fully translated, never reachable); device-online awareness during routing; any confidence score whatsoever in the live matching engine; any reconciliation between the two financial ledgers; fair load distribution among traders; and a scheduled retry for claimed payments that the immediate match attempt misses.

**What is unsafe, specifically:** the unauthenticated, chained callback between the two backends that can flip real order state; the ownership-free manual-confirm endpoint; the mostly-unauthenticated APK ingestion surface; and, above all, the settlement-skipping success path, because it is not a rare edge case — it is, today, the primary real-world route by which a genuine payment gets recorded as closed.

**What the backend team appears to be actively building, versus what's finished:** the presence of a complete, well-designed MySQL-side detection/confidence/settlement system that the shipped app doesn't use suggests a migration or convergence was underway — either moving detection *into* the MySQL backend properly, or building the bridge from `ngo-backend` back into it more completely — and was not finished at the time of this audit. The generated-column database constraint for the same-amount lock, added specifically as "a backstop... even if [the application layer] is ever bypassed," and the `stale_claim_sweep` job added specifically to catch orders "the NGO backend never matched" are both direct, code-commented evidence that the team is aware of exactly this class of gap and has been incrementally hardening around it — this audit's findings should be read as confirming and extending work already in motion, not as a surprise from nowhere.

---

## Audit Statistics

1. **Total frontend files read (Checkout):** 14 — all 9 source files (`App.jsx`, `main.jsx`, `index.css`, `pages/CheckoutPage.jsx`, `components/UpiApps.jsx`, `hooks/useOrderSocket.js`, `services/api.js`, `utils/order.js`, `utils/i18n.js`) plus 5 config/doc/env files (`package.json`, `vite.config.js`, `.env`, `index.html`, `README.md`).
2. **Total backend files read (MySQL, this document's own pass):** 20 — `orderController.js`, `merchantController.js`, `deviceController.js`, `paymentController.js`, `routingEngine.js`, `orderService.js`, `upiService.js`, `smartMerge.js` (re-verified), `depositTypeChecker.js`, `usageWindows.js`, `orderIdGenerator.js`, `telegramService.js`, `orderExpiry.js`, `staleClaimSweep.js`, `heartbeatCheck.js`, `order.model.js` (re-verified), `paymentDetail.model.js`, `notificationLog.model.js`, plus 2 migration files (`add-ngo-device-id-to-payment-details`, `add-active-amount-lock-index`) and a grep-verified pass over all model/migration unique-constraint declarations. (An additional ~25 MySQL backend files were read in the two companion audits, `ADMIN_ARCHITECTURE.md`/`MERCHANT_ARCHITECTURE.md`, and their findings are cross-referenced, not re-read, here.)
3. **Total Android files read:** 30 — all 27 Java source files, `AndroidManifest.xml`, `accessibility_config.xml`, and `build.gradle.kts`, via a dedicated full-coverage research pass.
4. **Total ngo-backend files read:** 34 — `server.js`, 8 route files, 9 service files, 3 utility files, 2 middleware files, and 13 Mongo model files, via a dedicated full-coverage research pass (8 root-level one-off dev scripts explicitly excluded as out of scope for the live pipeline).
5. **Routes found:** Checkout has 1 (query-param-driven, no router). MySQL order/payment/device routes: 19 distinct endpoints across `orderRoutes.js`/`paymentRoutes.js`/`deviceRoutes.js`/`merchantRoutes.js` relevant to this flow. ngo-backend: 8 mounted route groups, ~20+ individual endpoints traced (register-device, generate-license, heartbeat, event, debit-sms, overlay-capture, outgoing-payment, screenshot, update-purpose, devices CRUD, status, checkout/verify, checkout/status, webhook/donate, plus admin/merchant/ngo/public groups).
6. **APIs traced end-to-end:** 25+ — every order-lifecycle endpoint, every APK network call (8 distinct endpoints), every ngo-backend detection/matching/settlement endpoint, and the two cross-backend callbacks (`claimPaid`→`/checkout/verify`, `notifyP2PBackend`→`/verify-payment`).
7. **Assignment rules found:** 12 distinct eligibility/limit checks in `routingEngine.js` (trader online/active/funded/type-accepting/daily-limit, account active/detail-active/amount-range/same-amount-lock/legacy-daily-cap/four rolling-window count-and-amount caps).
8. **Detection sources found:** 6 — MySQL Engines 1-4 (SMS/notification/screen/manual, real but unreachable by the live app for 1-3), APK-side SMS receiver, APK-side notification listener, APK-side accessibility screen-reader (both inbound and outbound capture), APK-side manual overlay screenshot, and the server-side Paytm-dashboard Playwright scraper.
9. **Matching rules found:** the MySQL confidence engine's full rule set (engine-set-based scoring, 85 threshold, ±₹1 tolerance, duplicate-UTR guard) plus ngo-backend's amount+time-window rule set (10-minute/120-minute windows, no UTR/account gate) — 2 structurally distinct matching engines, only one of which is live.
10. **Fully implemented components:** routing/assignment engine (incl. DB-level race protection), order creation (both paths), Checkout's core payment-display and polling/resilience logic, the MySQL settlement service (`balanceService`), the MySQL confidence-scoring engine (correct but orphaned), the Paytm scraper, the ledger hash-chain, the outgoing-payment proof-verification pipeline, the merchant webhook signing/retry mechanism (as a mechanism).
11. **Partial components:** Checkout's real-time socket coverage, admin manual review (blind to real evidence), ngo-backend's matching engine (real but crude), the merchant-webhook system (correct but rarely triggered for real confirmations today).
12. **Mock/dead components:** Checkout's screenshot upload, UPI-app deep-link buttons, Hindi localization, the demo-order fallback, the "searching for banking details" screen strings, `OnboardingActivity` (APK), `scraperEngine.js`'s scraping methods (ngo-backend), the `runMatching` cron sweep (ngo-backend), the `FAILED` Checkout step.
13. **Critical accounting bugs:** 3 — the NGO-verification settlement-bypass (§28), the missing checkout→matching-engine trigger (§20), and the two independently-unreconciled financial ledgers (§30).
14. **Security risks:** 10 catalogued in §34, headlined by two unauthenticated chained cross-backend endpoints and an ownership-free manual order-confirmation endpoint.
15. **Product gaps:** documented throughout §36 — most materially, no customer recovery path for "I paid after expiry," no distinct failure-vs-pending messaging, and no device-offline awareness surfaced anywhere in the customer experience.
