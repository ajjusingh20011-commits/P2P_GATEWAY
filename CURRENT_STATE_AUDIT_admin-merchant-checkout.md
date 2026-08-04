# Current-State Code Audit — Admin, Merchant & Checkout

**Purpose:** ground-truth documentation for the UI/UX design handoff. This describes **what exists in code today**, not the target design. Read-only audit — no code was changed.

**Method:** every UI element and API call was traced through the frontend `services/api.js` → the real backend route → the actual controller/handler, and classified **WIRED** (calls a real endpoint that changes DB/state) vs **DEAD / UI-only** (decorative, mock-fed, local-state-only, or no handler).

---

## 0. Cross-cutting facts the design team must know first

1. **All three surfaces talk to ONE backend: the MySQL/Sequelize backend on `http://localhost:4000/api` (`backend/src`).** None of them call the Mongo `ngo-backend` directly. The task premise that checkout is served by the Mongo backend is **incorrect** — the Mongo `ngo-backend` (port 3000) is only a *server-to-server* payment-verification dependency the MySQL backend calls internally (`orderController.claimPaid` → `POST localhost:3000/api/checkout/verify`). Its `checkout.js`/`public.js`/`merchant.js`/`admin.js` routes are never hit by any browser.

2. **A "demo/offline" mock-login backdoor exists in Admin and Merchant.** When the backend is unreachable (network error, no HTTP response), `AuthContext.login` fabricates a fake authenticated admin/merchant session so any email+password "works." A real `401` from a live backend still blocks login. Admin's login screen even advertises this ("Demo mode · any email & password signs you in as admin").

3. **Client-side route guards check authentication only, not role.** `ProtectedRoute` gates on `!!user`; role enforcement is backend-only.

4. **A recurring pattern across all three panels:** a real, working backend endpoint exists, but the UI either never calls it or calls a local no-op instead. The gaps are mostly "live handler the UI never wired," not "UI calling a missing endpoint." Very few frontend→backend calls are dead at the backend.

---

# PART 1 — ADMIN PANEL

Frontend: `frontend/admin`. Backend: `backend/src` (MySQL) exclusively, guarded by `verifyToken, checkRole('admin')`.

## 1.1 Roles
**Exactly ONE undifferentiated admin role.** No super-admin / sub-admin / permission tiers exist anywhere.
- Guard: `router.use(verifyToken, checkRole('admin'))` (`backend/src/routes/adminRoutes.js:14`). `checkRole` (`middleware/auth.js:48-58`) is a flat string check on `req.user.role`; no scopes/permissions.
- Login enforces `role === 'admin'` server-side (`authController.js:56-57`); the panel always sends `role:'admin'`.
- Backdoor: network-error mock-admin login (`context/AuthContext.jsx:69-74`), advertised on the login screen (`pages/Admin.jsx:104`).

## 1.2 Routes & pages
No lazy-loading; all statically imported (`App.jsx`). All protected pages wrap `AdminLayout`.

| Path | Component | |
|---|---|---|
| `/login` | `pages/Admin.jsx` | public |
| `/dashboard` | `pages/Dashboard.jsx` | protected |
| `/traders` | `pages/Traders.jsx` | protected |
| `/merchants` | `pages/Merchants.jsx` | protected |
| `/orders` | `pages/Orders.jsx` | protected |
| `/payments` | `pages/Payments.jsx` | protected |
| `/payouts` | `pages/Payouts.jsx` | protected |
| `/disputes` | `pages/Disputes.jsx` | protected |
| `/smartphones` | `pages/Smartphones.jsx` | protected |
| `/settlement` | `pages/Settlement.jsx` | protected |
| `/settings` | `pages/Settings.jsx` | protected |
| `*` | → `/dashboard` | |

Shell (`AdminLayout.jsx`): Sidebar + top bar (search, notification bell, theme toggle, static "Administrator" badge). **Sidebar badge counts come from `mock.counts` (all zeros) → badges never render.**

## 1.3 Per-page (UI + wiring)

**Login** — email/password + show-hide, Sign in. WIRED to `POST /auth/login`. Caveat: offline mock-admin fallback.

**Dashboard** — 6 StatCards, 7-day volume bar chart, success/fail donut, Top Traders, Top Merchants, Live Transaction Feed.
- WIRED: only the 6 StatCards (`GET /admin/dashboard` → `adminController.dashboard`).
- DEAD/mock-fed (empty arrays, render blank): volume chart, donut, Top Traders, Top Merchants.
- BROKEN: "Live Transaction Feed" is fabricated client-side every 3.5s and **throws a TypeError every tick** (indexes empty mock arrays), so it stays empty.

**Traders** — Add Trader, filters (search/status/online), table (ID, Trader, Balance USDT, Commission, Types, Today Vol, Success, Status, Presence toggle, Actions menu), modals (view/balance/edit/commission/create + credentials).
- WIRED: list `GET /admin/traders`; create `POST /admin/traders/create`; update `PUT /admin/traders/:id`; balance `PUT …/balance` (real ledger); commission `PUT …/commission`; online `PUT …/online-status`; suspend `PUT …/suspend`.
- DEAD: TraderModal "Reset password" & "Add balance" (no onClick); modal fields `bankAccounts`/`smartphones` hardcoded `[]`, `successRate:100`, `earnings:0`, `phone/joinedAt` = "—". Filters are client-side over the loaded page only.

**Merchants** — Add Merchant, filters, table (ID, Business, API Key masked, Balance, PayIn%, Payout%, Status, Edit Fees + dots menu), modals.
- WIRED: list `GET /admin/merchants`; create `POST /admin/merchants/create`; Edit Fees `PUT /admin/merchants/:id/fees`.
- DEAD: dots-menu "Edit" and "Set commission" → `() => {}`; MerchantModal "Set commission" (no onClick); "Activate/Deactivate" → local state only (real `PUT /admin/merchants/:id` exists, unused); "Regenerate API key" → fabricates a fake key in local state (no backend endpoint). Modal volume/revenue hardcoded 0.

**Orders** — search, status tabs (8 v2 statuses), table, actions (Review/Confirm/Reject/Dispute), OrderModal with detection panel, timeline, raw SMS, manual override.
- WIRED: list `GET /admin/orders` (+ refetch on `order:update` socket); `PUT …/review`; `PUT …/confirm` (`confirmOrderV2` — settles + credits); `PUT …/reject` (`rejectOrderV2`); `PUT …/dispute` (`disputeOrderV2`); manual override `PUT /admin/orders/:id`; `POST /orders/:id/dispute`.
- DEAD: detection panel, confidence bar, raw SMS, multi-step timeline all synthetic (`engines:[]`, `confidence:null`, `rawSms:null`, one fake timeline entry). Search/tabs client-side.

**Payments** — Export CSV, filters (trader/merchant/method/engine/amount/dates), table.
- **ENTIRELY UI-ONLY.** No API import at all. Fed by empty `payments` mock; table always empty; CSV exports nothing. No admin payments endpoint is called.

**Payouts** — 6 status tabs w/ counts, table, per-tab actions (Approve & settle / Reject / Settle / Void).
- **FULLY WIRED, no mock fallback** (the cleanest admin page): `GET /admin/payout-requests`; `POST …/:id/approve` (credits trader USDT); `POST …/reject`; `POST …/dispute-resolve` (`settle|void`). Refetches on `order:update`.

**Disputes** — status tabs w/ counts, table, DisputeModal (evidence grid, resolution notes, Mark reviewing, Resolve).
- WIRED: list `GET /admin/disputes`; resolve `PUT /admin/disputes/:id/resolve`. Caveat: resolve updates local state optimistically and **swallows API errors** — shows "resolved" even on failure.
- DEAD: "Mark reviewing" → local state only (no endpoint); evidence grid hardcoded `evidence:0` (never renders); `raisedBy:'—'`.

**Smartphones** — filters, table, PhoneModal + Force disconnect.
- **ENTIRELY UI-ONLY.** No API import; empty mock; Disconnect mutates local state. Real endpoints exist but are never called: `GET /admin/smartphones`, `PUT /admin/smartphones/:id/disconnect`.

**Settlement** — Trigger manual settlement, 4 summary cards, 3 tabs (Per Trader / Per Merchant / History).
- **ENTIRELY UI-ONLY.** No API import; empty mocks; "Trigger manual settlement" is a fake `setTimeout(1200ms)` spinner. Real endpoints exist but are never called: `GET /admin/settlements`, `POST /admin/settlements/trigger`.

**Settings** — top Save changes, Rate & Revenue card, Fees & Commissions, Orders & Exchange Rate, Telegram Bots, Notifications/Mode toggles, IP Whitelist.
- WIRED: **only the Rate & Revenue card** — `GET /admin/settings`, `PUT /admin/settings` via its own "Save rates" button.
- DEAD: top "Save changes" (fake ✓ label, no API); Fees, Order expiry, Exchange source, Telegram tokens, Email/Maintenance toggles, IP Whitelist (hardcoded seed IPs) — all local state, never persisted.

## 1.4 Workflow traces
- **Order confirm/reject** — REACHABLE & WIRED. Confirm → `PUT /admin/orders/:id/confirm` → `confirmOrderV2` (settlement + trader credit + platform revenue). Reject → `rejectOrderV2` (releases trader).
- **Payout approve/reject/dispute-resolve** — REACHABLE & WIRED (Payouts page). Real money moves via `payoutService`.
- **Session/pool/trader management** — PARTIAL. Suspend + online toggle + balance/commission WIRED. **No pool/assign UI** (routing is automatic server-side). Trader `DELETE` endpoint exists, no button calls it.
- **Dispute resolution** — REACHABLE & WIRED, but frontend swallows errors (optimistic success) and "Mark reviewing" never persists.
- **Backend features with NO admin UI trigger:** manual settlement run, settlement listing, smartphone listing/disconnect, trader delete, generic merchant update.

## 1.5 Gaps
- Entire dead pages: **Payments, Settlement, Smartphones** (no API import; empty mocks; fake actions).
- Dashboard: charts + top-lists mock-fed empty; Live Feed throws every 3.5s.
- Settings: only Rate & Revenue persists; everything else local.
- Dead buttons: Merchants "Edit"/"Set commission"/"Activate"/"Regenerate key"; Traders "Reset password"/"Add balance"; Disputes "Mark reviewing".
- Synthetic record fields that look real: trader bank/phone/success, order detection/timeline/SMS, dispute evidence, merchant volume/revenue.
- Auth: role-less client guard; offline mock-admin backdoor; disputes error-swallowing.
- Filters run client-side over the current page only (backend list endpoints ignore filter params, except Orders' `status`).

---

# PART 2 — MERCHANT PANEL

Frontend: `frontend/merchant`. Backend: `backend/src` (MySQL) exclusively. Every nav entry maps to a real route — nothing 404s; the split is wired vs UI-only.

## 2.1 Routes & pages (all exist)

| Feature | Route | Component |
|---|---|---|
| Dashboard | `/dashboard` | `Dashboard.jsx` |
| Orders (+ create) | `/orders` | `Orders.jsx` |
| Payouts | `/payouts` | `Payouts.jsx` |
| Transactions | `/transactions` | `Transactions.jsx` |
| Balance | `/balance` | `Balance.jsx` |
| API keys | `/api-credentials` | `ApiCredentials.jsx` |
| Webhooks | `/webhooks` | `Webhooks.jsx` |
| Profile | `/profile` | `Profile.jsx` |
| Login | `/login` | `Login.jsx` |

## 2.2 Per-page (UI + wiring)

**Login** — email/password + show-hide, Sign in. WIRED (`POST /auth/login`). Offline mock-session fallback. **2FA half-built:** handlers + `tempToken` exist but **no code-entry form is ever rendered** → 2FA login dead-ends.

**Dashboard** — 6 StatCards, Daily Revenue chart, Recent Transactions.
- WIRED: the 6 StatCards (`GET /merchant/dashboard`).
- DEAD: Daily Revenue chart (empty `revenue30Days` mock; no timeseries endpoint); Recent Transactions widget (empty `transactions` mock — not wired to the real transactions API); trend strings ("9.2% vs yesterday") hardcoded.

**Orders** — Create New Order, status tabs w/ counts, table, Copy link, pagination, CreateOrderModal (amount, ref, FTD/STD, → success view w/ gateway id + checkout URL).
- **FULLY WIRED:** list `GET /merchant/orders`; create `POST /merchant/orders` (`orderService.createOrder`); live `order:update` socket patches. Dev-only fallbacks fabricate a local order only on network outage; real 503/`no_provider_available` correctly errors.

**Payouts** — New payout request form (amount, method bank/UPI, recipient, conditional UPI id or account/IFSC/bank), status filter, My payout requests table.
- **MOST FULLY-WIRED PAGE, no mock data:** create `POST /payout-requests` (`payoutController.create`, Joi-validated); list `GET /payout-requests/my`; live refresh on `order:update`.

**Transactions** — Export CSV, search, date filters, table, pagination.
- WIRED: `GET /merchant/transactions`; search, date filter, CSV export (client-side) all real. Caveat: Method badge maps `engine_used` (doesn't match `ACCOUNT_TYPES`) → usually renders raw text/dash.

**Balance** — Available Balance (+ Withdraw), This month settled, Pending settlement, Settlement History, withdrawal modal.
- WIRED (partial): Available + Pending from `GET /merchant/balance`.
- DEAD: ≈INR uses hardcoded `*89`; "This month settled" hardcoded 0 + literal "▲9.2%"; "Next settlement ~6h" literal; Settlement History empty mock (no endpoint); **"Request withdrawal"/Submit entirely fake** (`setTimeout`, no endpoint exists anywhere).

**API Credentials** — API Key row, API Secret row (mask/copy/Regenerate), example code.
- Partly WIRED: API **Key** display is real (`GET /merchant/api-credentials`).
- FAKE: API **Secret** shown is the hardcoded mock (GET never returns a secret); **Regenerate buttons only mutate local state** (`rand()`) — the real `POST /merchant/api-credentials/regenerate` (genuine crypto rotation) exists but is never wired and isn't even exposed in `api.js`. So "regenerating" produces a non-functional on-screen string; the DB key is unchanged.

**Webhooks** — URL input + Save, Test webhook, Delivery Logs table.
- **100% FAKE frontend.** Page imports no API client. Save → fake label (real `POST /merchant/webhook` exists, never called); URL prefilled with hardcoded `teststore.com`; Test → fabricates a local log row; Delivery Logs → empty mock (no delivery-log read endpoint exists at all).
- Backend delivery engine is **real** (HMAC-signed, BullMQ retries, fired on `payment.success`/`order.cancelled`/`order.expired`) — but only for a `webhook_url` set out-of-band, never through this UI.

**Profile** — Save changes, Business info, Security (Change password modal).
- **FAKE.** No API import. Save → fake ✓ label (no profile-update endpoint); Change password → local validation then closes modal (no endpoint). Phone + "Last changed 42 days ago" hardcoded.

**Layout** — Realtime socket badge, HeaderSearch, NotificationBell are all **real**; sidebar "ordersPending" badge is hardcoded 0 (decorative).

## 2.3 Order/payout creation flow
- **Payout request (end-to-end real):** form → `POST /payout-requests` → `payoutController.create` (Joi) → `payoutService.createRequest` → `PayoutRequest` row; trader/admin lifecycle continues via their routes; merchant list reflects transitions.
- **Order creation, two real paths:** (a) this panel's JWT path `POST /merchant/orders`; (b) the server-to-server API-key path `POST /orders/create` (`apiKeyAuth`) used by the hosted checkout — documented in the API Credentials example but not driven by this UI.

## 2.4 API keys / webhooks — real or fake?
- **API keys:** backend generation is REAL (`crypto.randomBytes`, real rotation controller). Frontend is mostly FAKE (real key display; fake secret; Regenerate is local-only).
- **Webhooks:** backend delivery is REAL (signed, queued, retried, fired on real events). Frontend page is entirely FAKE (Save/Test/Logs all local; can't set URL or view real logs from the UI).

## 2.5 Gaps
2FA UI missing; offline mock-login; Dashboard chart + recent-tx mock-fed; hardcoded trend strings; Balance withdrawal fully fake; Balance month-settled/INR/next-settlement hardcoded; Settlement History empty (no endpoint); API-secret + Regenerate fake; Webhooks page 100% fake (real endpoints unused); Profile save + change-password fake; sidebar ordersPending badge hardcoded; Transactions method badge degrades. **Works end-to-end:** Login, Dashboard stat cards, Orders (full), Transactions (full), Balance figures, API-key display, Payouts (fullest page), header search/bell/socket.

---

# PART 3 — CHECKOUT PAGE

Frontend: `frontend/checkout`. **Backend: `backend/src` (MySQL, port 4000)** — NOT the Mongo backend. Order state machine is the Sequelize ENUM in `backend/src/models/order.model.js`. The Mongo `ngo-backend` is only a downstream verification callback (`orderController.claimPaid` → `POST localhost:3000/api/checkout/verify`), never called by the browser.

## 3.1 Full flow
- **Load:** order key from URL `?order=<uuid>`. On mount → `markCheckoutOpened` (`PUT /orders/:id/checkout-opened`, transitions `pending → checkout_open`) then `load` (`GET /orders/:id/checkout` → real `upi_id`, `qr_data`, `expires_at`, `status`, …). Both WIRED.
- **QR payment — REAL.** Renders a scannable code (`react-qr-code`) from a genuine server-built UPI intent string `upi://pay?pa=<real vpa>&pn=…&am=<amount>&cu=INR&tn=<uuid>` (`upiService.buildUpiLink`). Not a placeholder image.
- **UPI Intent deep-link — NOT implemented.** No "Open in UPI app" button/anchor anywhere. `components/UpiApps.jsx` (PhonePe/GPay/Paytm/BHIM tiles) is never imported (dead file). Per-app schemes in `utils/order.js` are unused. The `upi://` string only feeds the QR; nothing launches it as an intent.
- **Bank Transfer — NOT implemented (mislabeled).** The "Account number" card actually renders the UPI VPA, not an account/IFSC. Copy copies the VPA. Checkout is UPI-only.

## 3.2 State pages (all exist in CheckoutPage.jsx)
Frontend `STEP`: PAYMENT, PROCESSING, SUCCESS, EXPIRED, FAILED, REJECTED, DISPUTED, UNAVAILABLE, ERROR.

| Backend status | Frontend screen |
|---|---|
| `pending`/`checkout_open` (+ has UPI) | PAYMENT |
| `pending`/`checkout_open` (no UPI) | UNAVAILABLE |
| `claimed_paid` / `under_review` | PROCESSING |
| `success` | SUCCESS (sets txnRef from UTR) |
| `failed` | **EXPIRED** (mislabeled) |
| `rejected` | REJECTED |
| `disputed` | DISPUTED |
| `cancelled` | (unmapped) → UNAVAILABLE |

## 3.3 State-machine cross-check
Real enum: `pending → checkout_open → claimed_paid → under_review → success | failed | rejected | disputed | cancelled`.
- **Matches:** checkout_open, claimed_paid, success, rejected, disputed, under_review.
- **Mismatch:** backend `failed` (generic terminal — real failure OR expiry OR cancel) always shows "Order Expired" copy; the dedicated `FAILED` screen is **unreachable** via `applyOrder`. `cancelled` has no mapping → renders "Payment Unavailable."
- **Transitions reach the UI via three mechanisms, but only one is reliable:**
  1. **Polling every 3s (primary, reliable)** while on PAYMENT/PROCESSING (code comment says 5s — it's 3000ms).
  2. **Socket (`useOrderSocket`) — partly broken.** Listens for `order:confirmed`/`order:paid` which the backend **never emits**; success is emitted as `order:completed` which the frontend **doesn't listen for**; `order:claimed_paid`/`order:disputed` emitted but not subscribed. Only `order:expired`/`order:cancelled` are both emitted and heard. **Real-time success is effectively broken — the 3s poll is what surfaces it.**
  3. Manual "Submit Confirmation" button.

## 3.4 Timer & cancel (re-confirmed vs prior audit)
- **Timer:** seed is REAL (from backend `expires_at`). Hitting zero is **display-only** — sets EXPIRED screen, calls no endpoint. A *separate* real backend TTL job (`jobs/orderExpiry.js`, every 30s) independently flips overdue orders to `failed` — but it's decoupled from the countdown (they can disagree by up to ~30s). Net: timer display is real-seeded but not itself authoritative.
- **Cancel:** **now REAL (prior "cosmetic" finding is outdated).** `POST /orders/:id/cancel-checkout` → `cancelCheckout` transitions to `cancelled`, releases trader, emits `order:cancelled`; returns 409 if already claimed.

## 3.5 "I've paid" (Submit Confirmation)
Fully WIRED. Proof selector (utr / screenshot / no_proof); on submit → optimistic PROCESSING → `POST /orders/:id/claim-paid` → sets `status:'claimed_paid'`, stores UTR + confirmation type, best-effort NGO forward, emits `order:claimed_paid`. Settlement to `success` is a separate step (admin review or NGO auto-match callback).

## 3.6 Gaps
- **Socket success broken** (event-name mismatch); success/claimed/disputed arrive only via 3s poll; `order:confirmed`/`order:paid` handlers dead.
- **UPI Intent flow absent** (no deep-link button; `UpiApps.jsx` dead; per-app schemes unused).
- **Bank Transfer fake** (VPA shown as "account number").
- **Screenshot upload is a stub** — file input has no `onChange`/upload/endpoint (comment: "placeholder — no file backend yet"); selecting "screenshot" submits type only, no image.
- **Timer expiry display-only** (real expiry is a decoupled 30s job).
- **`failed` mislabeled "Order Expired";** dedicated FAILED screen unreachable; `cancelled` unmapped → "Unavailable."
- **Dead/unused checkout client fns:** `fetchOrder`, `requestNewUpi` (real `POST /orders/:id/new-upi` exists but no "Get new UPI" button is rendered), `markPaid`. `utils/order.js` still ships `DEMO_ORDER`, `ALT_UPI_IDS`, `getOrder()`, a rickroll `HOW_TO_VIDEO`.
- **Hardcoded:** placeholder support number `wa.me/919000000000`; `lang='en'` hardcoded so the full Hindi i18n set is dead (no switcher); 600s default timer.
- **Security (backend, affects checkout integrity):** `POST /orders/verify-payment` (NGO auto-settle callback) is **unauthenticated** — anyone reaching it can settle any order to `success` with a fabricated UTR. Flagged in-code as "restrict before production."

---

## Appendix — endpoint attribution (all → MySQL backend :4000)

**Checkout:** `PUT /orders/:id/checkout-opened` (wired) · `GET /orders/:id/checkout` (wired) · `POST /orders/:id/claim-paid` (wired) · `POST /orders/:id/cancel-checkout` (wired) · `GET /orders/:id`, `POST /orders/:id/new-upi`, `markPaid` (exist, not called by checkout).

**Recurring anti-pattern to flag for redesign:** live backend endpoints the UI never wires — Admin (settlements, smartphones, trader-delete, merchant-update), Merchant (webhook set, api-cred regenerate), Checkout (new-upi). Redesign should either surface or formally retire these.
