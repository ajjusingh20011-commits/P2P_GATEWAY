# Max Pay — Merchant Panel: Product, UX, and Business Analysis

**Scope:** `frontend/merchant` (React/Vite) + every MySQL backend route/controller/service/model it depends on.
**Method:** every file in `frontend/merchant/src` was read in full; every button and API call was traced to its real backend handler and DB effect (not assumed from its label). No source file was modified, no code was written, nothing was redesigned.
**Backend dependency:** exactly one backend — `backend/` (MySQL/Express) via `VITE_API_BASE_URL`. No `ngo-backend` dependency exists in this panel's own code; the NGO service is consumed transitively by the order-verification pipeline (`POST /orders/verify-payment`, called *by* the NGO backend, *into* this backend — see §8, §21), never called by any Merchant frontend code.

---

## 1. Executive Summary

**Who is the Merchant?** A business (an e-commerce store, a service provider, or in this codebase's own recurring example text, an NGO/donation collector — see `orderController.js`'s NGO-verification comments) that has been onboarded by a Max Pay Admin and integrates with Max Pay to collect INR payments from its own customers via UPI, using traders (individual humans holding UPI-enabled bank/wallet accounts) as the payment-receiving intermediary. The merchant never touches UPI infrastructure directly — Max Pay assigns a trader's UPI ID to each order, the customer pays that UPI ID, and Max Pay credits the merchant's ledger in USDT once the payment is confirmed.

**What is the Merchant trying to accomplish?** Three things, in order of frequency: (1) generate a payment link/checkout session for a customer and get it confirmed as fast as possible, (2) know exactly how much money has come in and what it's worth in USDT, and (3) get that USDT out — either by requesting a payout to a bank/UPI recipient (the "Buy USDT"-style payout-request flow) or (per the UI's stated intent, not yet backed — see §13) withdrawing accumulated balance.

**Complete workflow, as the product is actually built today:**
1. Log in (email+password, optionally 2FA — see §3 for a real gap here).
2. Land on Dashboard — check today's collections, pending orders, success rate, USDT balance.
3. Integrate: either call `POST /api/orders/create` server-to-server with an API key/secret (the "real" integration path), or use the dashboard's own "Create New Order" button for manual/ad-hoc orders.
4. Customer opens the returned checkout URL, pays the assigned UPI ID, and asserts payment.
5. Max Pay's detection engines (or an admin, or the NGO auto-verification path) confirm the order.
6. Merchant balance (USDT) increases (**except via one specific auto-verification path — a real bug, see §8 and §21**), and a signed webhook fires (**if a webhook URL was ever set — currently not settable through this UI at all, see §14**).
7. Merchant checks Transactions/Orders to reconcile, and eventually creates a Payout Request to cash out.

**Daily workflow (what today's build actually supports):** check Dashboard stats → check Orders for anything stuck in `claimed_paid`/`under_review` (nothing on this panel lets the merchant act on those — they're admin's job) → check Transactions for reconciliation → occasionally create a manual order or a payout request.

**Weekly/monthly workflow (what today's build does NOT support, despite UI implying it does):** there is no real settlement report, no real "this month" aggregate, no downloadable statement beyond a client-side CSV of whatever transactions are currently in view, and no way to change the account's own webhook URL, business profile, or password — all of that UI exists and looks complete but performs no backend action (§6, §12, §13, §14).

**Business goal of the panel, as built:** get a merchant integrated and watching real money move (Orders/Transactions/Dashboard-stats/Payouts are genuinely wired) while a meaningful set of "back office" merchant self-service features (credential rotation, webhook configuration, profile/security, balance withdrawal, settlement reporting) are UI-complete but functionally inert. This is the single most important shape of the whole panel to understand before doing anything else with it.

---

## 2. Project Structure

```
frontend/merchant/
├── .env / .env.example / .env.local     # VITE_API_BASE_URL, VITE_WS_URL, VITE_APP_NAME
├── index.html                            # <title>P2P UPI — Merchant Panel</title>
├── package.json                          # react 18.3, react-router-dom 6.23, axios, socket.io-client, zustand (unused), lucide-react, tailwind
├── vite.config.js                        # port 5175, proxies /api and /socket.io to :4000
├── README.md                             # "Business logic is not implemented yet — scaffold only" — STALE (see §20)
├── postcss.config.js / tailwind.config.js
└── src/
    ├── main.jsx                          # ReactDOM.createRoot → <App/>
    ├── App.jsx                           # router: /login public, everything else behind ProtectedRoute+MerchantLayout
    ├── index.css                         # `.tf-scope` design tokens (light/dark) — identical system to Admin/Trader, accent = purple #8b5cf6
    ├── layouts/
    │   └── MerchantLayout.jsx            # sidebar + topbar shell, theme state, useSocket(), <Outlet context={{connected}}/>
    ├── routes/
    │   └── ProtectedRoute.jsx            # redirects to /login if !isAuthenticated; no role check (same pattern as Admin)
    ├── context/
    │   └── AuthContext.jsx               # login/validate2fa/logout, localStorage session, mock-login fallback on network error
    ├── hooks/
    │   ├── useApi.js                     # generic {data,loading,error,refetch} wrapper
    │   └── useSocket.js                  # socket.io client; listens order:confirmed/cancelled/disputed/paid; re-broadcasts window 'order:update'
    ├── components/
    │   ├── Sidebar.jsx                   # nav list, collapse toggle, one badge (Orders — hardcoded 0, see §4)
    │   ├── HeaderSearch.jsx              # live search over the merchant's own orders+transactions, real API
    │   ├── NotificationBell.jsx          # "recent activity" = merchant's own last-fetched orders, real API
    │   ├── Toaster.jsx                   # module-level pub/sub toast system
    │   ├── icons.jsx                     # 23 inline SVG icons
    │   └── ui.jsx                        # Card, StatCard, Badge, Toggle, SearchInput, Select, Input, Button, Tabs, Pagination, PageHeader, Section, Modal, Field, CopyButton
    ├── pages/
    │   ├── Login.jsx                     # route: /login — 2FA state exists but its UI was never built (§3, critical finding)
    │   ├── Dashboard.jsx                  # route: /dashboard
    │   ├── Orders.jsx                     # route: /orders
    │   ├── Payouts.jsx                    # route: /payouts
    │   ├── Transactions.jsx               # route: /transactions
    │   ├── Balance.jsx                    # route: /balance
    │   ├── ApiCredentials.jsx             # route: /api-credentials
    │   ├── Webhooks.jsx                   # route: /webhooks — 100% disconnected, see §6.7/§14
    │   └── Profile.jsx                    # route: /profile — 100% disconnected, no backend endpoint exists at all
    ├── services/
    │   └── api.js                         # axios instance + refresh-token interceptor, authApi, merchantApi (entire API surface)
    ├── utils/
    │   └── mock.js                        # formatters + data arrays, all now empty except `apiCredentials`/`profile` seeds (see §20)
    ├── store/                             # empty (.gitkeep only) — zustand dependency is unused, same as Admin/Trader
    └── assets/                            # empty (.gitkeep only)
```

**Every page has a registered route; every route has a page.** No orphaned components, no sidebar item pointing at a missing route.

---

## 3. Routes

| Path | Component | Auth | Notes |
|---|---|---|---|
| `/login` | `Login.jsx` | Public | See critical 2FA finding below. |
| `/dashboard` | `Dashboard.jsx` | Protected | Default landing page. |
| `/orders` | `Orders.jsx` | Protected | Sidebar badge (always 0, §4). |
| `/payouts` | `Payouts.jsx` | Protected | |
| `/transactions` | `Transactions.jsx` | Protected | |
| `/balance` | `Balance.jsx` | Protected | |
| `/api-credentials` | `ApiCredentials.jsx` | Protected | |
| `/webhooks` | `Webhooks.jsx` | Protected | |
| `/profile` | `Profile.jsx` | Protected | |
| `*` | — | — | `<Navigate to="/dashboard"/>` — bounces an unauthenticated visitor through `ProtectedRoute` to `/login` anyway. No dedicated 404. |

**Authentication flow, and a genuine break in it:**
- `authApi.login(email,password)` → `POST /auth/login {role:'merchant'}`. On success without 2FA: session persisted, navigate to `/dashboard`. On a network error (no `err.response`): falls back to a **local mock session** (`MOCK_USER`, `role:'merchant'`) — same class of risk documented for the Admin panel (an unreachable-backend condition self-grants a visible, if data-empty, authenticated session with zero real credentials).
- **On an account with 2FA enabled:** `authApi.login` returns `{requires_2fa:true, temp_token}`; `AuthContext.login` correctly surfaces this as `{requires2fa:true, tempToken}`, and `AuthContext` even implements a working `validate2fa(tempToken, code)` function that correctly calls `POST /auth/2fa/validate` and persists the resulting session. **But `Login.jsx` never renders a form to collect the TOTP code.** `handleSubmit` sets `tempToken` state and `return`s (skipping `navigate`) when `requires2fa` is true — and that's the entire user-visible effect. The component defines `handleVerify`, `cancel2fa`, `code`, `setCode` but **none of them are referenced anywhere in the JSX returned by the component.** The practical result: a merchant with 2FA enabled submits correct credentials, the loading spinner runs and stops, **and nothing else happens** — no code-entry field appears, no error message, no navigation. The form just sits there, submittable again, looking like a silent no-op. This is worse than the Admin panel's equivalent gap (§3 of `ADMIN_ARCHITECTURE.md`), because here the state management for the fix already exists and was simply never wired into the render — the feature was started and abandoned mid-implementation, not merely never started.
- **Session rehydration:** unlike the Admin panel, `AuthContext`'s mount effect (`AuthContext.jsx:24-35`) **does not call `/auth/me`** to confirm the cached token — it trusts whatever is in `localStorage.user` unconditionally, for the lifetime of that token. A stale/edited `localStorage` user object is trusted with no server round-trip at all until the first API call 401s.
- **Token refresh:** unlike the Admin panel (which just force-logs-out on any 401), the Merchant panel's axios interceptor (`api.js:20-56`) implements a **real, working silent-refresh-then-retry** flow on `TOKEN_EXPIRED`, including a shared in-flight `refreshing` promise so concurrent 401s don't trigger duplicate refresh calls. This is a genuine engineering improvement over the Admin panel's equivalent code and should be treated as the reference implementation if the two are ever unified.
- **Role protection:** `ProtectedRoute.jsx` only checks `isAuthenticated`, not `user.role === 'merchant'` — same defense-in-depth gap as Admin, mitigated the same way (every `/api/merchant/*` route independently enforces `checkRole('merchant')` server-side).

---

## 4. Layout

- **Sidebar** (`Sidebar.jsx`): 256px/72px collapse-persisted-to-localStorage, 8 nav items, purple active-state tint (`rgba(139,92,246,.12)`). One badge slot (Orders → `counts.ordersPending`), sourced from `utils/mock.js:89-91`, hardcoded `{ ordersPending: 0 }` and **never updated anywhere in the codebase** — identical dead-badge pattern to the Admin panel's sidebar (§5 of `ADMIN_ARCHITECTURE.md`). It can never show a non-zero count regardless of real pending-order volume.
- **Header:** realtime connection pill (green/gray, genuinely driven by `useSocket().connected`), `HeaderSearch` (real, searches the merchant's own orders+transactions), `NotificationBell` (real, last-fetched orders), theme toggle (persisted to the shared `localStorage['panel-theme']` key — **note this key is shared across Admin/Trader/Merchant panels if served from the same browser profile**, so switching theme in one panel changes it in the others too, which may or may not be intended), store identity block (`user.businessName || user.name`, falls back to the literal `'Test Store'`), and a purple avatar initial.
- **No search bar filters by date/status** — `HeaderSearch` is a flat text match across whatever the merchant's own orders/transactions endpoints most recently returned (no separate re-query per keystroke, debounced 300ms, client-filtered).
- **Content container:** single vertical scroll region (`overflow-y-auto`), sidebar/header fixed.
- **No footer.**
- **Responsive behavior:** identical situation to the Admin panel — page-level card grids use Tailwind responsive classes and reflow reasonably, but the sidebar/header **chrome itself has no responsive breakpoint, no drawer/hamburger pattern**, and is present unconditionally at every viewport width. This was not visually verified (documentation-only task) but is guaranteed by the absence of any responsive class in `MerchantLayout.jsx`/`Sidebar.jsx`.
- **No duplicate/nonfunctional header controls found** — every header control does something (theme toggle persists, search is live, bell is live).

---

## 5. Design System

Identical token system and component library pattern to the Admin panel (`ui.jsx`, `index.css`), re-skinned with a purple accent.

- **Colors:** `--accent: #8b5cf6` (purple). `ui.jsx`'s `ACCENT_HEX` map explicitly **remaps legacy accent names** so the whole panel reads as "purple + rotating blue/green/amber/teal" (`indigo`/`violet`/`purple` → `#8b5cf6`; `rose`/`teal` → `#14b8c4`) — a deliberate, documented design decision (comment at `ui.jsx:4-6`), unlike the Admin panel's two-divergent-maps issue. `BADGE_HEX` is a **separate** map from `ACCENT_HEX` here too, but was kept in sync for every key actually used in this panel (no observed mismatch, unlike Admin's `rose`/`teal` gap) — a small but real improvement over the Admin panel's design-system file.
- **Typography:** same system-font stack, no custom type scale, sizes hardcoded per component exactly as in Admin.
- **Components:** `Card`, `StatCard`, `Badge`, `Toggle`, `SearchInput`, `Select`, `Input`, `Button` (4 variants here — no `subtle`, unlike Admin's 5), `Tabs`, `Pagination`, `PageHeader`, `Section`, `Modal`, `Field`, plus a **`CopyButton`** primitive that Admin's `ui.jsx` does not have (Admin hand-rolls copy buttons per page instead) — a genuine small improvement in reuse.
- **No shared `<Table>` component** — same gap as Admin; 6 pages hand-roll near-identical `<table>` markup.
- **`Payments`-equivalent theme-break:** `Transactions.jsx`'s native `<input type="date">` fields hardcode dark-mode-only Tailwind classes (`bg-gray-800`, `text-gray-100`, `[color-scheme:dark]`) exactly like the Admin panel's `Payments.jsx` — the same specific inconsistency, independently reproduced in this codebase's sibling panel.
- **Modals:** same `Modal` primitive pattern as Admin — closes on Escape/backdrop click, **no focus trap, no `role="dialog"`/`aria-modal`, no focus restoration** — identical accessibility gap, present in every modal in this panel too (Create Order, Withdraw, Change Password).
- **Motion:** `StatCard` icon float animation respects `prefers-reduced-motion` (same as Admin). No modal/dropdown transition. `RevenueChart`'s bar-hover tooltip is the one genuinely new interaction pattern versus Admin's `Dashboard.jsx` (Admin's `VolumeChart` uses a `title` attribute + CSS-only hover label; here it's a real `onMouseEnter`/`onMouseLeave`-driven tooltip element) — a small UX improvement, though it shares the same underlying problem: the data it would display is currently always empty (§6.2).

---

## 6. Page-by-Page Analysis

### 6.1 Login (`pages/Login.jsx`)

- **Purpose:** authenticate a merchant.
- **Components:** logo, heading, error banner, email/password inputs with show/hide, submit button.
- **State:** `email`, `password`, `showPassword`, `error`, `loading`, plus the **unused** `tempToken`, `code`.
- **API:** `POST /auth/login {role:'merchant'}` → `authController.login` → `User` lookup + bcrypt compare (MySQL).
- **Business logic:** role assertion, account-status check, 2FA branch — all server-side and correct.
- **Problems:** the 2FA gap documented in §3 — this is a **hard functional break**, not a UX nit. **Classification: BROKEN** for any merchant account with 2FA enabled; **FULLY WIRED** for the plain-credential path.
- **UX issues:** no visible indication anywhere on this screen that 2FA might be required, so when it silently fails there is zero signal to the merchant about what went wrong or what to do next.
- **Improvements:** build the missing code-entry step using the already-written `handleVerify`/`cancel2fa` handlers — this is the cheapest possible fix in the entire audit, since the logic already exists and only the JSX is missing.

### 6.2 Dashboard (`pages/Dashboard.jsx`)

- **Purpose:** at-a-glance daily payment health.
- **Components:** 6 `StatCard`s, a 30-day revenue bar chart with hover tooltip, a "Recent Transactions" list.
- **State/Data:** `useApi(() => merchantApi.dashboard())`, refetched on `window 'order:update'` events (real-time-aware, good pattern). Revenue chart bound to `revenue30Days` (mock, empty). Recent Transactions list bound to `transactions.slice(0,10)` — **imported directly from `utils/mock.js`, not fetched from `merchantApi.transactions()` at all**, unlike the dedicated Transactions page which does fetch real data. This is a real, if minor, inconsistency: the Dashboard's own transaction widget cannot show real data even though the exact same panel's Transactions page can.
- **API trace:** `GET /merchant/dashboard` → `merchantController.dashboard` → 4 parallel `Order` queries scoped to `merchant_id` (today's count, confirmed-today count, active/pending count, today's success volume) + the merchant's own `balance`/`balance_usdt`/`commission_rate`/`payin_fee_percent`/`payout_fee_percent` fields, read directly off the `Merchant` row. **Real, correctly merchant-scoped.**
- **Business logic:** `success_rate` computed server-side exactly as Admin's dashboard does, scoped to this merchant only.
- **Problems:** "Today's Collections" `StatCard` carries a **hardcoded trend badge** (`{ up: true, value: '9.2% vs yesterday' }`, `Dashboard.jsx:73`) that is **never computed from real data** — it is a literal string baked into the component, identical regardless of what actually happened yesterday. This is a fabricated metric presented with the same visual confidence as the five real ones next to it.
- **Functionality status:** StatCards = **FULLY WIRED** (except the fake trend badge on one of them). Revenue chart = **MOCK DATA, permanently empty** (no backend endpoint exists for historical daily revenue at all — `merchantController` has no such route). Recent Transactions widget = **MOCK DATA** despite a real, working transactions endpoint existing and being used elsewhere in the same panel.
- **UX issues:** a merchant's very first screen shows one fabricated percentage next to five real numbers with no visual distinction — the single most consequential trust issue on this page, because "9.2%" reads exactly as authoritative as "₹42,000."
- **Improvements:** either compute a real day-over-day delta server-side or remove the trend badge; wire the Recent Transactions widget to the same `merchantApi.transactions()` call the Transactions page already uses; build a real `GET /merchant/revenue?days=30`-style endpoint or remove the chart.

### 6.3 Orders (`pages/Orders.jsx`) — the best-built page in the panel

- **Purpose:** view all orders, create new ones, get/copy checkout links.
- **Components:** status tabs (All + 8 v2 statuses with live counts), 7-column table, per-row "Copy link" action, "Create New Order" modal.
- **State/Data:** `loadOrders()` on mount → `merchantApi.orders()` → `mapOrder()`. Live status patching via the `order:update` window event (an event carrying just `{order_id, status}` patches the matching row in place; if the order isn't already in the loaded list, it triggers a full `loadOrders()` refetch instead — a sensible, low-cost incremental-update strategy).
- **API trace:**
  | Action | Call | Endpoint | Backend | Effect |
  |---|---|---|---|---|
  | Load | `merchantApi.orders()` | `GET /merchant/orders?status` | `merchantController.orders` | Paginated `Order.findAndCountAll`, `merchant_id`-scoped |
  | Create | `merchantApi.createOrder(body)` | `POST /merchant/orders` | `merchantController.createOrder` → `orderService.createOrder` | Validates amount/customer_ref/deposit_type, auto-detects real FTD/STD via `depositTypeChecker` (server is the source of truth — the modal's copy correctly tells the merchant this), routes to an available trader via `routingEngine.findAvailableTrader` under a same-amount lock, generates a `gateway_order_id`, snapshots the trader's rate, creates the `Order` row (`status:'pending'`), emits `order:new`→trader and `order:created`→merchant sockets |
- **Business logic:** the create flow correctly surfaces a `503 no_provider_available` as a dedicated, well-designed "P2P is unavailable right now" error state in the modal (`Orders.jsx:114-123`) — **no fake order is created on this path**, which is the correct behavior. On a genuine **network** failure (no `err.response` at all — the API host itself unreachable), the modal instead falls back to `createLocal()`, which fabricates a client-side-only order and prepends it to the visible list with a working-looking checkout link that **points at a real checkout URL for an order that does not exist in the database** — a customer opening that link would hit a 404/error on the checkout app. This mirrors the Admin/Trader panels' "offline mock" pattern but is riskier here because the artifact it produces (a shareable, plausible-looking payment link) can leave the merchant's own hands before anyone discovers it's fake.
- **Functionality status:** **FULLY WIRED** for both list and create, including a genuinely well-designed provider-unavailable error state. The one flaw is the local-fallback order fabrication on total network loss.
- **UX issues:** the Deposit Type radio in the create modal is presented as a real choice ("FTD — First Time Deposit" / "STD — Standard Deposit"), but the modal's own copy admits "The server auto-detects and corrects this from the customer's history" — meaning the field is closer to a hint than a real input, which could confuse a merchant who picks STD for a customer the server then silently reclassifies as FTD (fee/routing implications differ by type). This is disclosed but easy to miss.
- **Improvements:** either remove the local-fallback fake-order path or clearly flag any such row as "not yet synced / offline draft" until it's confirmed against the server, since a shareable checkout link is being generated for it.

### 6.4 Payouts (`pages/Payouts.jsx`) — fully real

- **Purpose:** request a payout of funds to a bank/UPI recipient and track its status through the trader/admin settlement pipeline (the same "Buy USDT"-style flow documented from the admin side in `ADMIN_ARCHITECTURE.md` §7.7 and §9 below).
- **Components:** a create form (amount, method, recipient details — conditional UPI vs. bank/IFSC fields), a status-filterable table of the merchant's own payout requests.
- **API trace:** `POST /payout-requests` → `payoutController.create` → `payoutService.createRequest` (creates a `PayoutRequest` row, `status:'awaiting_processing'`, broadcasts `payout:created` to admin + all traders). `GET /payout-requests/my?status` → `payoutController.listMine` → `payoutService.listForMerchant` (own rows only).
- **Business logic:** client-side validates required fields per method (UPI ID vs. account number/IFSC/bank name) before submit; server independently validates via Joi (`createSchema` in `payoutController.js`).
- **Functionality status:** **FULLY WIRED**, both directions.
- **Realtime:** listens for the same generically-named `order:update` window event as everywhere else in this panel to trigger a reload — this event is **only ever dispatched from the four `order:*` socket listeners** in `useSocket.js` (confirmed/cancelled/disputed/paid), **never from any `payout:*` socket event**, because `useSocket.js` in this panel (like the Admin panel) has no listener for `payout:*` events at all despite the backend emitting `payout:created`/`payout:accepted`/`payout:transferred`/`payout:settled`/`payout:disputed`/`payout:canceled`/`payout:expired`. So this page's "live refresh" is, like Admin's Payouts page, **riding entirely on unrelated order events** — a merchant will not see their own payout request change status in real time unless an unrelated order event happens to fire around the same time; otherwise they only see it on next page load/manual refresh.
- **UX issues:** no confirmation dialog before submitting a payout request that references real recipient bank/UPI details — a low-severity gap since the request still requires trader acceptance and admin settlement downstream, but worth noting given it's a financial-recipient form.

### 6.5 Transactions (`pages/Transactions.jsx`) — fully real

- **Purpose:** a reconciliation log of individual detected payments (as opposed to Orders, which is the order/checkout-session level).
- **Components:** search + date-range filter, 7-column table, "Export CSV" (real, functional client-side CSV of the currently filtered rows).
- **API trace:** `GET /merchant/transactions` → `merchantController.transactions` → `Transaction.findAndCountAll` joined to `Order` (`merchant_id`-scoped, `required:true`) **filtered to `is_merged:true`** — i.e., this intentionally shows only transactions that were actually matched/merged onto a confirmed order, not every raw detection signal. This is a deliberate and reasonable scoping choice (a merchant doesn't need to see noisy unmatched SMS/notification fragments), though it is not explained anywhere in the UI.
- **Functionality status:** **FULLY WIRED.**
- **UX issues:** the "Method" column maps `transaction.engine_used` (an internal detection-engine enum: `sms`/`notification`/`screen_scraper`/`manual`) through `ACCOUNT_TYPES` (a UPI-app-brand enum: `gpay`/`phonepe`/`paytm`/etc.) — these are two semantically unrelated taxonomies. `mapTxn()` (`Transactions.jsx:14-25`) explicitly comments "may not map to a known ACCOUNT_TYPE," and the render logic falls back to a plain dash-prefixed string when it doesn't match, so this doesn't crash — but it means the column will show either a UPI-app badge or a raw engine name unpredictably, depending on data, which is a real (if minor) information-architecture bug: the column is trying to answer two different questions ("which app did they pay with" vs. "how did we detect it") with one field.

### 6.6 Balance (`pages/Balance.jsx`) — the panel's most consequential hybrid page

- **Purpose:** show available/pending funds and settlement history; let the merchant withdraw.
- **Components:** an "Available Balance" hero card with a "Withdraw funds" button, "This month settled" card, "Pending settlement" card, a Settlement History table, and a "Request Withdrawal" modal.
- **API trace:** `GET /merchant/balance` → `merchantController.balance` → returns `{balance, balance_usdt, pending_inr, payin_fee_percent}` (`pending_inr` = sum of `amount_inr` for the merchant's still-active-status orders — a genuinely useful, correctly computed "money in flight" figure). **Real, used for the Available Balance and Pending Settlement cards.**
- **Hardcoded/fake elements:**
  - The INR-equivalent line under the USDT balance (`≈ {inr((bal.balance ?? stats.balanceUsdt) * 89)}`, `Balance.jsx:43`) multiplies by a **literal hardcoded `89`** rather than calling any rate endpoint. The platform's real, dynamic exchange rate lives in `settings.base_exchange_rate` (settable by an Admin via the Admin panel's Settings page, per `ADMIN_ARCHITECTURE.md` §7.11) — if an admin changes that value, this display goes wrong immediately and silently, with no code path connecting the two.
  - "This month settled" is 100% hardcoded to `stats.monthlyVolumeInr` (mock, `=0`, never fetched from anywhere) — no backend endpoint for a monthly aggregate exists in `merchantController` at all.
  - "Next settlement in ~6h" (`Balance.jsx:56`) is a **literal hardcoded string**, not a computed countdown — it will read "~6h" forever, regardless of any actual settlement schedule (and, per `ADMIN_ARCHITECTURE.md` §7.10/§14, the backend's own settlement-trigger mechanism is itself an unwired legacy calculation path, so there may not be a real "settlement window" at all in the sense this string implies).
  - **Settlement History table is 100% mock** (`settlements`, empty array) — **no backend endpoint for merchant-facing settlement history exists at all.** (Admin has `GET /admin/settlements`, but it is admin-scoped, returns all merchants, and is itself unreachable from the Admin UI per `ADMIN_ARCHITECTURE.md` §7.10 — there is no merchant-facing equivalent anywhere in the codebase.)
  - **"Request Withdrawal" is entirely fake.** `submit()` (`Balance.jsx:18-26`) is a bare `setTimeout(...,1200)` with **no API call of any kind**. There is **no backend endpoint anywhere** for a merchant to withdraw/cash out accumulated balance — `merchantRoutes.js` has exactly 8 routes (dashboard, orders×2, transactions, balance, webhook, api-credentials×2) and none of them is a withdrawal endpoint. The modal shows a convincing "✓ Withdrawal request submitted. It will be processed at the next settlement window" success message for an action that has **zero server-side effect** — a merchant's real, earned USDT balance is completely unaffected no matter how many times this is clicked.
- **Functionality status:** Available Balance + Pending Settlement = **FULLY WIRED**. This-month-settled, next-settlement-countdown, INR-conversion-rate = **HARD-CODED**. Settlement History = **MOCK, no backend exists**. Request Withdrawal = **entirely fake — the single highest-severity finding in this document** (see §21).
- **Business impact:** this is the page where a merchant goes specifically to get their money out, and the one button on it that promises to do that does nothing. This is categorically worse than a merely-unwired feature (like Admin's fake settlement trigger, which is an internal operational tool) because it is customer-facing and directly about the merchant's own earned funds.

### 6.7 API Credentials (`pages/ApiCredentials.jsx`) — real read, entirely fake write

- **Purpose:** view and manage the API key/secret used for server-to-server integration (`X-API-Key`/`X-API-Secret` headers on `POST /api/orders/create`).
- **Components:** masked key/secret rows with Show/Hide + Copy + **Regenerate** buttons, an example integration code block with its own Copy button.
- **API trace (read):** `GET /merchant/api-credentials` → `merchantController.getApiCredentials` → returns `{api_key, api_key_masked}` — the **real, full plaintext API key** (not just the masked version) is sent to the browser on every page load and held in component state; the page's own masking is purely a client-side display toggle, not a security boundary the backend enforces (the backend already handed over the full value regardless of whether "Show" is ever clicked). The API **secret** is correctly never returned by this endpoint at all (the mock secret seed is used to render its masked placeholder, per `ApiCredentials.jsx:60,73` — the real secret is never fetched, appropriately).
- **API trace (write) — the critical gap:** `regenKey()`/`regenSecret()` (`ApiCredentials.jsx:80-82`) generate a **client-side-only random string** (`rand('pk_live_')`/`rand('sk_live_')`, built from `Date.now()` + a fixed literal suffix `'x9f2a7b1c4d8'` — note this suffix is a **constant string appended to every "regenerated" key/secret**, so any two regenerations within the same millisecond, or any inspection of the fake-generation pattern, would reveal an obviously non-cryptographic, predictable tail) and **never calls the backend at all.** This is despite `merchantController.regenerateApiCredentials` (`POST /merchant/api-credentials/regenerate`) being a **fully real, correctly implemented** endpoint — it generates cryptographically random values via `crypto.randomBytes` (`utils/ids.js`), updates the `Merchant` row, and correctly returns the new secret once for the merchant to store. **`services/api.js`'s `merchantApi` object has no method for this endpoint at all** — it was never added to the frontend API surface, so the button had no real call available to make even if someone had wired it.
- **Functionality status:** Read (API key display) = **FULLY WIRED**. Regenerate Key / Regenerate Secret = **entirely fake, DEAD relative to a fully-working backend endpoint.**
- **Business impact — this is the second most severe finding in the document:** API credential rotation is the standard, expected response to a suspected key leak in any payment gateway. A merchant who believes they've rotated a compromised key here has changed **nothing** server-side — the old, possibly-compromised key/secret pair **remains fully valid** for authenticating `POST /api/orders/create` indefinitely, while the UI displays a fake new key that will never actually authenticate anything. This is the same class of bug as the Admin panel's fake merchant-key-regeneration button (`ADMIN_ARCHITECTURE.md` §7.4), independently present here on the merchant's own self-service page, and arguably higher-severity here because the merchant is the party most likely to reach for exactly this control during an actual incident.
- **Improvements:** wire `regenKey`/`regenSecret` to `POST /merchant/api-credentials/regenerate` — trivial, since the backend is already complete and correct.

### 6.8 Webhooks (`pages/Webhooks.jsx`) — entirely disconnected

- **Purpose:** configure the URL Max Pay should POST payment events to, and inspect delivery history.
- **Components:** endpoint URL input + Save + "Test webhook" buttons, an events-supported hint line, a Delivery Logs table.
- **API trace: none.** No `merchantApi` import anywhere in this file. `save()` is a `setTimeout` flashing "✓ Saved" with **no call** to the real, existing `POST /merchant/webhook` endpoint (`merchantApi.setWebhook` is defined in `services/api.js` but is **never invoked anywhere in the codebase** — a dead frontend method backing a real backend feature, exactly parallel to the Regenerate-credentials gap above). "Test webhook" fakes a 1-second delay and appends a fabricated `test.ping / 200 / 120ms` row to purely local state — **there is no backend "send a test webhook" endpoint at all.**
- **A specific, checkable factual error in the UI itself:** the events hint text reads *"order.created, order.confirmed, order.expired, payment.received, payout.settled."* Tracing every real `webhookService.sendWebhook(...)` call site in the backend (`orderController.js`×3, `smartMerge.js`×1, `jobs/orderExpiry.js`×1, `jobs/staleClaimSweep.js`×1) shows the **actual** event names ever fired are: `order.cancelled`, `order.expired`, `order.stale_review`, and `payment.success`. Of the five events this UI advertises, only `order.expired` matches a real event name; `order.created` is never sent as a webhook (only as a socket event); `order.confirmed`/`payment.received` do not exist (the real equivalent is `payment.success`); and **`payout.settled` is never fired by any code path** — `payoutService.js` never calls `webhookService.sendWebhook` at all, for any payout status transition. A merchant integrating against this documentation would build a handler for events that will never arrive and miss the ones that will.
- **The deeper consequence:** since the Save button never calls the real `setWebhook` endpoint, and Admin's own "Edit" action for a merchant is a no-op (`ADMIN_ARCHITECTURE.md` §7.4), **the only code path that can ever actually set `Merchant.webhook_url` is Admin's "Add Merchant" creation form**, which does accept a `webhook_url` field at creation time. In practice, this means **a merchant's webhook URL can be set exactly once, by an admin, at account creation, and never changed again through any UI in the product** — despite a fully real, working, HMAC-signed, retry-backed delivery engine (`webhookService.js`, using BullMQ with 3 attempts + exponential backoff) sitting ready to use it.
- **Functionality status:** Save = **DEAD** (real backend endpoint exists, unused). Test webhook = **FAKE** (no backend capability exists for this at all). Delivery Logs = **MOCK, no backend delivery-log persistence/API exists** (the real `deliverWebhook` worker only logs to the server console/logger — nothing is persisted to a queryable table a merchant-facing endpoint could read from).
- **Business impact:** this is the single largest gap between backend capability and frontend delivery in the entire panel — a production-quality signed-webhook system exists and cannot be configured or observed by the party it's built for.

### 6.9 Profile (`pages/Profile.jsx`) — entirely disconnected, and rightly so given the backend

- **Purpose:** edit business name/email/phone; change password.
- **Components:** two `Section`s (Business Information, Security), a Change Password modal.
- **API trace: none.** `save()` and `changePassword()` are both local-state-only with fake 1.8s "Saved" flashes. **Unlike the previous two pages, this is not a case of an unwired-but-real backend** — there is genuinely **no backend endpoint anywhere** for a merchant to update their own business profile fields or change their own password. `authController.js` has no self-service "change my password" route (only admin-side 2FA-disable requires re-entering a password, which is a different flow); `merchantController.js` has no `updateProfile`. This page is UI-only because the backend capability simply does not exist yet, not because of a frontend wiring gap.
- **Functionality status:** **UI-ONLY, no backend support exists at all.**
- **Business impact:** lower urgency than Balance/Webhooks/API-Credentials (a wrong displayed business name is not a financial-safety issue the way a fake withdrawal or fake key rotation is), but still a real gap — password rotation in particular is a baseline account-security expectation for any dashboard handling API secrets.

---

## 7. Merchant Business Workflow

```
Merchant account created (by an Admin, via the Admin panel — see ADMIN_ARCHITECTURE.md §7.4)
  → credentials (email/password, api_key/api_secret) issued once
  → webhook_url optionally set at THIS moment (the only time it can ever be set — §6.8)
       ↓
Merchant Login  (2FA-enabled accounts: BROKEN, see §3)
       ↓
Dashboard  (real stats; fake trend badge; empty chart; mock recent-txns widget)
       ↓
API Integration
  Path A (production): POST /api/orders/create with X-API-Key/X-API-Secret headers
  Path B (dashboard convenience): "Create New Order" button → POST /merchant/orders (JWT-authenticated)
  Both paths share orderService.createOrder — identical validation/routing/rate logic
       ↓
Order created (status: pending) → checkout_url returned/generated
       ↓
Customer opens checkout → checkout_open → pays the assigned UPI ID → asserts payment (claim-paid)
       ↓
Detection: APK signal merge (smartMerge, auto-confirms ≥85% confidence)
        OR admin manual review/confirm (Admin panel Orders page)
        OR NGO auto-verification callback (POST /orders/verify-payment — separate, less-safe path, see §8/§21)
       ↓
Order → success
  Real settlement path (smartMerge/admin-confirm): balanceService.settleOrder →
     trader.balance_usdt debited, merchant.balance_usdt CREDITED, platform_revenue_usdt incremented,
     webhookService.sendWebhook(merchant, 'payment.success', {...}) fired
  NGO-verify path: order.status set to 'success' DIRECTLY — balance NOT credited, webhook NOT fired (bug, §8/§21)
       ↓
Merchant sees the order as 'success' in Orders/Dashboard either way (status-based counting doesn't
  distinguish the two paths) — but balance_usdt only reflects reality for the first path
       ↓
Merchant balance visible on Balance page (real) / Dashboard USDT card (real)
       ↓
Merchant creates a Payout Request to cash out to a bank/UPI recipient (real, full pipeline — §9)
   — OR —
Merchant clicks "Withdraw funds" on the Balance page (FAKE — no backend action occurs at all)
       ↓
Merchant reconciles via Transactions (real) and would use Reports/Settlement History (MOCK, §12/§13)
```

---

## 8. Order Lifecycle

Statuses (from `Order.STATUSES`, `order.model.js`): `pending → checkout_open → claimed_paid → under_review → success | failed | rejected | disputed | cancelled`.

| Transition | Trigger | Endpoint | Who | Webhook fired? | Merchant balance affected? |
|---|---|---|---|---|---|
| (create) → `pending` | Merchant/API creates order | `POST /orders/create` (API key) or `POST /merchant/orders` (JWT) | Merchant | No (only sockets: `order:created`) | No |
| `pending` → `checkout_open` | Customer opens checkout page | `PUT /orders/:id/checkout-opened` | Public/customer | No | No |
| `checkout_open`/`pending` → `claimed_paid` | Customer asserts payment | `POST /orders/:id/claim-paid` (+ aliases `/paid`, `/confirm`, `/customer-confirm`) | Public/customer | No | No — **this step also best-effort notifies the NGO backend** (`axios.post(NGO_BACKEND_URL + '/api/checkout/verify', ...)`, 5s timeout, failure swallowed) to kick off independent NGO-side verification |
| `claimed_paid` → `under_review` | Detection signal below auto-confirm threshold, OR admin clicks Review | `smartMerge.mergePaymentData` (automatic) or `PUT /admin/orders/:id/review` | System / Admin | No | No |
| `claimed_paid`/`under_review` → **`success`** | (a) detection ≥85% confidence, (b) admin manual Confirm | `smartMerge.confirmOrder` (internal) or `PUT /admin/orders/:id/confirm` | System / Admin | **Yes — `payment.success`** | **Yes — `balanceService.settleOrder` runs: merchant `balance_usdt` credited, trader debited, platform revenue accrues** |
| `pending`/`checkout_open`/`claimed_paid` → **`success`** | **NGO backend calls back once it independently verifies the payment** | `POST /orders/verify-payment` (unauthenticated, internal callback) | NGO backend | **No** | **No — order status flips to `success` directly via a plain `order.update()`; `balanceService.settleOrder` is never called on this path** |
| `claimed_paid`/`under_review` → `rejected` | Admin rejects | `PUT /admin/orders/:id/reject` | Admin | No | No (trader released back to the routing pool) |
| any non-terminal → `failed` | Trader/admin cancel, or expiry sweep | `POST /orders/:id/cancel`, `/:id/expire`, background job | Trader/Admin/System | **Yes — `order.cancelled` or `order.expired`** | No |
| `pending`/`checkout_open` → `cancelled` | Customer cancels their own checkout | `POST /orders/:id/cancel-checkout` | Public/customer | **Yes — `order.cancelled`** | No |
| any → `disputed` | Admin flags, or any authenticated user disputes | `PUT /admin/orders/:id/dispute` or `POST /orders/:id/dispute` | Admin / any auth'd role | No | No |

**The critical finding in this table, restated plainly:** there are **two structurally different ways** an order reaches `status: 'success'`, and only one of them actually moves money or notifies the merchant's system. The NGO-verification callback path (`verifyPayment` in `orderController.js:336-409`) was evidently built as a faster/independent confirmation channel, but it bypasses `smartMerge.confirmOrder`/`balanceService.settleOrder` entirely — it does not debit the trader, does not credit the merchant, does not accrue platform revenue, and does not fire the `payment.success` webhook. Since the Merchant panel's Dashboard/Orders pages count orders purely by `status`, a merchant would see an order as a completed `success` sale — countable in "Today's Collections," "Success Rate," and the Orders table — **while their actual `balance_usdt` never reflects it and their webhook integration never hears about it.** This is a real accounting-integrity bug reachable through the panel's normal read surfaces, not a hypothetical edge case (see §21 for severity ranking).

---

## 9. Payout Workflow ("Buy USDT" — merchant-initiated payout)

```
Merchant: Payouts page → "Create payout request"
   POST /payout-requests { amount_inr, payment_method, recipient_name, account_number|upi_id, ifsc_code?, bank_name? }
       ↓
PayoutRequest row created, status = awaiting_processing (global pool, visible to all online traders)
       ↓
A trader accepts it (Trader panel, not in scope here) → status = in_processing
   (rate snapshot frozen at accept: base_exchange_rate, trader_payout_percent, effective_payout_rate, trader_credit_usdt)
       ↓
Trader pays the recipient out-of-band (bank transfer/UPI, outside Max Pay) → marks "transferred"
   → status = awaiting_settlement
       ↓
Admin: Payouts page → "Approve & settle"
   POST /admin/payout-requests/:id/approve → payoutService.approve → settleAndCredit (row-locked transaction)
       ↓
status = settlement_completed
   trader.balance_usdt += trader_credit_usdt (the trader is credited — NOT the merchant; see note below)
```

**Status meanings (as surfaced on the Merchant Payouts page, `STATUS_LABEL` in `Payouts.jsx`):**
- `awaiting_processing` — in the open pool, no trader has picked it up yet.
- `in_processing` — a trader has accepted and is expected to transfer funds to the recipient.
- `awaiting_settlement` — trader has marked it transferred; waiting on admin approval.
- `settlement_completed` — done; trader has been credited.
- `canceled` — rejected while still unpicked, or voided after a dispute.
- `dispute` — something went wrong (trader reported a problem, admin rejected a transfer claim, or the in-processing timer expired unresolved) and it now needs admin resolution (settle or void).

**Important business-model clarification, worth stating explicitly since the UI doesn't:** this payout mechanism is **not** "merchant withdraws their own Max Pay balance to their bank account." It is a **merchant-funded, trader-fulfilled payout to a third-party recipient** — the merchant specifies who receives the money (the `recipient_name`/`account_number`/`upi_id` fields describe the payee, not the merchant themselves), a trader pays that recipient out-of-band, and **the trader** (not the merchant) is credited USDT once admin settles it. The merchant's own `balance_usdt` is not directly touched by this flow at all in the code as written — it is a service the merchant can use to *send* money out to someone, functionally adjacent to (and easily confused with, from the naming alone) a genuine "withdraw my balance" feature, which — per §6.6 — **does not exist** as a real, working feature anywhere in this panel. A merchant reading "Payouts" in the sidebar could reasonably expect it to be "get my balance out," when it is actually "pay someone else using the platform's trader network," a materially different product capability that needs to be clearly distinguished in any future UX pass.

---

## 10. API Analysis

All merchant endpoints require `verifyToken` + `checkRole('merchant')` (`merchantRoutes.js:13`, `payoutRoutes.js:15`), except the API-key-authenticated `POST /orders/create`.

| Frontend method | Method | Endpoint | Purpose | Backend | Status |
|---|---|---|---|---|---|
| `authApi.login` | POST | `/auth/login` | Authenticate | `authController.login` | Reachable |
| `authApi.logout` | POST | `/auth/logout` | Blacklist token | `authController.logout` | Reachable |
| `authApi.me` | GET | `/auth/me` | (defined, **never called** — see §3, no rehydration check) | `authController.me` | **Defined, unused by this panel** |
| `authApi.twoFAValidate` | POST | `/auth/2fa/validate` | Step 2 of 2FA login | `authController.validate2fa` | Backend reachable; **frontend never triggers it (§3)** |
| `authApi.twoFAStatus/Setup/VerifySetup/Disable` | — | `/auth/2fa/*` | 2FA self-service management | `authController.*` | **Defined in `services/api.js`, never called by any page — there is no 2FA-management UI anywhere in the Merchant panel** (Profile page's "Security" section is password-only) |
| `merchantApi.dashboard` | GET | `/merchant/dashboard` | Home stats | `merchantController.dashboard` | Reachable |
| `merchantApi.orders` | GET | `/merchant/orders` | List own orders | `merchantController.orders` | Reachable |
| `merchantApi.createOrder` | POST | `/merchant/orders` | Dashboard-convenience order creation | `merchantController.createOrder` → `orderService.createOrder` | Reachable |
| `merchantApi.transactions` | GET | `/merchant/transactions` | Merged/confirmed transaction log | `merchantController.transactions` | Reachable |
| `merchantApi.balance` | GET | `/merchant/balance` | Balance + pending-in-flight | `merchantController.balance` | Reachable |
| `merchantApi.setWebhook` | POST | `/merchant/webhook` | Set webhook URL | `merchantController.setWebhook` | **Backend reachable; frontend defines the method but never calls it (§6.8)** |
| `merchantApi.apiCredentials` | GET | `/merchant/api-credentials` | View API key | `merchantController.getApiCredentials` | Reachable |
| — (no frontend method) | POST | `/merchant/api-credentials/regenerate` | Rotate key+secret | `merchantController.regenerateApiCredentials` | **Backend fully implemented, zero frontend reference of any kind (§6.7, critical)** |
| `merchantApi.createPayout` | POST | `/payout-requests` | Create payout request | `payoutController.create` → `payoutService.createRequest` | Reachable |
| `merchantApi.myPayouts` | GET | `/payout-requests/my` | List own payout requests | `payoutController.listMine` → `payoutService.listForMerchant` | Reachable |
| — (server-to-server, not in `merchantApi`) | POST | `/orders/create` | Real integration path (API key) | `orderController.create` → `orderService.createOrder` | Reachable (by design, outside the dashboard's own JWT-authenticated session) |

**Summary lists:**
- **Frontend-defined, never-called methods:** `authApi.me` (session rehydration skipped), `authApi.twoFAStatus/Setup/VerifySetup/Disable`, `merchantApi.setWebhook`.
- **Backend endpoints with zero frontend reference at all (no wrapper exists):** `POST /merchant/api-credentials/regenerate` — the single most consequential gap in this list.
- **Endpoints referenced only conceptually by UI copy but never real:** none beyond what's covered in §6.8 (Webhooks event-name mismatch) and §6.6 (no withdrawal endpoint exists to reference in the first place).
- **Duplicated/aliased endpoints (backend-side, not a frontend concern but relevant to understanding the trace):** `POST /orders/:id/paid`, `/:id/confirm`, `/:id/customer-confirm` are all literal aliases of `claimPaid` (`orderController.js:227-228`).
- **Risky endpoint, called from outside this panel but directly affecting merchant data integrity:** `POST /orders/verify-payment` is **unauthenticated** (the route file's own comment: *"SECURITY: unauthenticated — anyone who can reach it can settle any order with a fabricated UTR. Restrict before production"*) and, per §8, settles orders without moving money or firing webhooks — a compounding risk (an unauthenticated endpoint that can mark a merchant's order `success` for dashboard/reporting purposes without the merchant's own balance or webhook integration ever reflecting it).

---

## 11. Merchant Dashboard

| Card/Chart | Real or Mock | Source |
|---|---|---|
| Today's Collections | **Real** | `dashboard().today_collections_inr` |
| Today's Collections trend badge ("▲ 9.2% vs yesterday") | **Fake — hardcoded literal** | `Dashboard.jsx:73`, never computed |
| Total Transactions | **Real** | `dashboard().total_orders_today` |
| Success Rate | **Real** | `dashboard().success_rate` (server-computed) |
| Pending Orders | **Real** | `dashboard().pending_orders` |
| USDT Balance | **Real** | `dashboard().balance_usdt` |
| Pay-in Fee / Pay-out Fee | **Real** | `dashboard().payin_fee_percent` / `payout_fee_percent` (the merchant's own configured fee, set by Admin) |
| Daily Revenue (30-day chart) | **Mock, permanently empty** | No backend endpoint exists for this at all |
| Recent Transactions (last 10) | **Mock, permanently empty** | Bound to the static mock array, not to the real (and available) `merchantApi.transactions()` |

**Which metrics are fake:** the trend badge and the two chart/list widgets. **Which are real:** all six headline numbers. This split matters because it means the *first-glance* numbers on this page are trustworthy, but the *supporting visual context* around them (is this trending up? what just happened?) is entirely fabricated or blank — the worst combination for a merchant trying to make a fast judgment call, since the page looks fully populated at a glance.

---

## 12. Reports

**There are no dedicated "Reports" pages in this panel.** The closest equivalents:
- **Transactions page CSV export** — real, functional, exports whatever rows are currently filtered into view (client-side `Blob`/`URL.createObjectURL`, no server-side export job). This is the only genuine "export" capability in the entire panel.
- **Orders page** — no export option at all.
- **Balance page "Settlement History"** — presented as a report but is 100% mock with no backing endpoint (§6.6, §13).
- **No statement/invoice generation** of any kind (PDF or otherwise) exists anywhere in the frontend or backend for merchant use.
- **No date-range-scoped aggregate report** exists (e.g., "last month's volume by day," "fees paid this quarter") — the closest is the permanently-empty 30-day Dashboard chart.
- **No scheduled/emailed reports** exist (see §17 — no email notification system was found anywhere in the codebase for merchants).

**Conclusion:** reporting, as a product category, is effectively unbuilt for the Merchant panel — the one real export (Transactions CSV) is useful but narrow (current page/filter only, not a true historical export), and everything that visually promises broader reporting (Balance's Settlement History, Dashboard's revenue chart) does not work.

---

## 13. Balance

- **Available:** real (`merchant.balance_usdt`, via `GET /merchant/balance`).
- **Pending:** real and genuinely useful — `pending_inr` sums `amount_inr` across the merchant's orders still in `Order.ACTIVE_STATUSES` (`pending`/`checkout_open`/`claimed_paid`/`under_review`), i.e., "money customers have started paying but hasn't settled yet." This is a correct and valuable concept, well-implemented server-side.
- **Locked:** no distinct "locked" concept exists in this panel (unlike the Trader panel, per Admin-audit cross-reference, which does compute a `locked_usdt` figure via `balanceService.traderBalanceSummary` — no merchant equivalent was found).
- **Settlement:** conceptually, "settlement" for a merchant *is* the moment an order transitions to `success` via the real settlement path (§8) — there is no separate, distinct "settlement batch" concept surfaced to merchants anywhere real in the code, despite the Balance page's UI structure (This-month-settled / Settlement History) implying one exists as its own reportable entity.
- **History:** **does not exist as a real feature** — the Settlement History table is 100% mock with zero backend support (§6.6).
- **What "Balance" would need to become trustworthy as the merchant's single financial source of truth:** a real settlement-event log (append-only, one row per `balanceService.settleOrder` call, already computable from existing data since every `success` order carries `merchant_receives_usdt`/`merchant_fee_usdt` fields — see `order.model.js`), a real withdrawal endpoint, and a fix for the NGO-verification accounting gap (§8) so "balance" and "orders marked successful" never silently diverge.

---

## 14. Webhooks

Fully covered in §6.8; summarized here per the requested structure:

- **Configuration:** UI exists, is entirely non-functional (Save button doesn't call the real, working `POST /merchant/webhook` endpoint). The webhook URL can currently only be set once, by an Admin, at merchant-creation time.
- **Retry logic:** real and well-built on the backend — BullMQ queue, 3 attempts, exponential backoff starting at 2s (`webhookService.js:64-69`), with a direct-delivery-no-retry fallback if Redis/the queue is unavailable. **None of this is visible or controllable from the Merchant UI.**
- **Delivery history:** the backend does not persist delivery attempts to any queryable store — `deliverWebhook` only writes to the server-side logger. There is no data source a "Delivery Logs" feature could ever be built against without first adding persistence.
- **Signing:** real and correctly implemented — `HMAC-SHA256(rawBody, merchant.api_secret)`, sent as `X-Signature`. This is a sound, standard signing scheme, assuming the merchant actually has their `api_secret` to verify against (which they do, from account creation — though they can never *rotate* it through this UI either, per §6.7).
- **Failures:** silent from the merchant's perspective — a permanently-failing webhook (e.g., a URL that started 404ing) produces no merchant-visible signal anywhere in this panel; the only trace is server-side logs an admin would have to go looking for.
- **Testing:** the "Test webhook" button is entirely fake (no backend capability exists for a synthetic test delivery at all).
- **Event-name accuracy:** the UI's advertised event list is materially wrong relative to the real event names ever fired (§6.8) — this alone would break any merchant's webhook handler built by reading this panel's own documentation.

---

## 15. API Credentials

- **API Key:** real, viewable in full (not just masked) via `GET /merchant/api-credentials`; the frontend applies its own masking as a display-only convenience.
- **API Secret:** correctly never re-displayed after creation (the `GET` endpoint doesn't return it) — the frontend's masked secret display is backed by a mock placeholder, not real data, which is arguably the *correct* security posture even though the underlying "value" shown is fake.
- **Rotation:** backend fully real (`POST /merchant/api-credentials/regenerate`, cryptographically random, correctly returns the new secret once); frontend **completely fake** for both key and secret (§6.7) — the single most severe finding in this document.
- **Permissions/restrictions:** the API key has exactly one permission scope — it can create orders (`POST /orders/create`) via `apiKeyAuth` middleware, which also checks `merchant.is_active`. There is no concept of scoped/restricted API keys (e.g., read-only, orders-only-under-₹X) anywhere in the system.
- **IP Whitelist:** **does not exist for merchants at all** — no IP-restriction field, column, or check exists anywhere in `Merchant`, `apiKeyAuth`, or the Merchant frontend. (The Admin panel has its own, separately-hardcoded-and-fake IP whitelist UI for admin console access — per `ADMIN_ARCHITECTURE.md` §7.11 — but that is unrelated to merchant API keys and does not extend to them.) Any request presenting a valid `X-API-Key`/`X-API-Secret` pair is accepted from anywhere on the internet.
- **Secret storage:** `apiKeyAuth.js` compares `merchant.api_secret !== apiSecret` directly against the plaintext-stored value (necessary here since the same plaintext secret is reused to compute HMAC webhook signatures) — meaning a database compromise exposes every merchant's API secret in immediately-usable plaintext form, sufficient both to forge API calls *and* to forge validly-signed webhook payloads. This is a real, structural security tradeoff (not a bug exactly — HMAC signing requires the raw secret) worth flagging for anyone evaluating the platform's blast radius in a DB-breach scenario (see §21).

---

## 16. Settlement

- **Settlement workflow, from the merchant's actual vantage point:** there is no discrete "settlement" the merchant participates in or triggers — funds simply move (correctly, via the real path) the moment an order the merchant created reaches genuine `success` status. The word "Settlement" appears in the UI (Balance page's "Settlement History") describing a feature that doesn't exist as real data.
- **Settlement cycle:** no fixed cycle exists in the merchant-relevant code path — orders settle individually, in real time, as they confirm. The "Next settlement in ~6h" string (§6.6) implies a batch cycle that isn't real for this flow (a batch settlement job does exist server-side — `jobs/settlementJob.js`, documented in `ADMIN_ARCHITECTURE.md` §7.10/§14 — but it is unreachable from any UI today and, per that audit, uses a different/legacy rate calculation than the real per-order settlement path merchants actually experience).
- **Fees:** real and merchant-specific — `payin_fee_percent`/`payout_fee_percent`, set by Admin per merchant, correctly surfaced on the Dashboard. The actual per-order fee math (`rateService.calculateSettlement`) correctly computes `merchant_settlement_usdt` from `amount_inr / admin_rate`, where `admin_rate` is derived from the merchant's own `payin_fee_percent` — i.e., **the fee displayed on the Dashboard is genuinely the fee baked into every settlement**, not a decorative number. This is one of the more trustworthy pieces of financial plumbing in the panel.
- **Revenue (merchant's own, i.e., what they actually receive):** correctly computed server-side per order (`merchant_receives_usdt` on the `Order` row); accumulated into `Merchant.balance_usdt` via the real settlement path only.
- **History:** does not exist (§6.6, §13).
- **Exports:** none beyond the general Transactions CSV (§12).

---

## 17. Notifications

- **Email:** **no email notification system exists anywhere in the codebase for merchants.** No email-sending service, template, or trigger was found in `backend/src` relevant to merchant-facing events (order confirmed, payout settled, webhook failing, etc.). The Admin panel's Settings page has an "Email notifications" toggle (per `ADMIN_ARCHITECTURE.md` §7.11) but it is itself fake/unwired and concerns admin alerts, not merchant-facing email.
- **Webhook:** the real notification channel for this platform (§14) — signed, retried, but currently unconfigurable and unobservable through this UI.
- **Dashboard (in-panel):** `NotificationBell` — real, functional, shows the merchant's own last-fetched orders with an unread count tracked via a `localStorage` watermark (last-seen order ID). This is a genuine, working notification surface, just scoped to "recent orders," not a general event/alert feed.
- **System alerts:** the only other in-panel alerting is the toast system (`Toaster.jsx`), which fires exclusively from the four real `useSocket.js` order events (confirmed/cancelled/disputed/paid) — real-time, but narrow (no payout-status toasts, no balance-change toasts, no webhook-failure toasts).
- **Gap summary:** a merchant currently has exactly one passive notification channel (the order-status toast/bell pair) and zero proactive channels (no email, no SMS, no push, and webhooks — the one channel built for exactly this purpose — are unconfigurable). For a payment gateway, the absence of any email notification layer is a significant product gap, not just a technical-debt item.

---

## 18. Table Analysis

| Page | Columns | Data source | Server sort | Server search | Client filter | Pagination | Row actions | Export | Real/Mock |
|---|---|---|---|---|---|---|---|---|---|
| Orders | 7 | `merchantApi.orders` | No (`created_at DESC` fixed) | No | Tab (status) | Client, 10/page | Copy checkout link | No | **Real** |
| Payouts | 6 | `merchantApi.myPayouts` | No (`created_at DESC` fixed) | No | Server-side (status param) | **None** — all rows for the filter render at once | None | No | **Real** |
| Transactions | 7 | `merchantApi.transactions` | No (`created_at DESC` fixed) | No | Client (text + date range) | Client, 12/page | None | **Yes — real CSV** | **Real** |
| Balance → Settlement History | 6 | mock (empty) | — | — | No | **None** | None | No | **Mock/dead** |

**Same core scalability gap as the Admin panel (`ADMIN_ARCHITECTURE.md` §16):** every real table fetches the backend's *default* page (`limit:25` unless a page/limit param is sent — Orders/Transactions never send one) and then paginates/filters **client-side over that single fetched batch.** At low order volumes this is invisible; once a merchant's real order count exceeds the default server-side limit, the client-side "showing X of Y" and pagination controls will silently reflect only the first batch, not the merchant's true total — a correctness issue at moderate scale, not just a performance one, exactly mirroring the finding already documented for the Admin panel.

---

## 19. Modal Analysis

| Modal | Trigger | Fields | Validation | API | Success behavior | Failure behavior |
|---|---|---|---|---|---|---|
| **Create New Order** | Orders → button | amount, customer reference (required), deposit type (FTD/STD radio), merchant order ID (optional) | Client: amount>0, ref non-empty. Server: Joi + FTD/STD auto-correction | `POST /merchant/orders` | Shows gateway order ID, amounts, checkout URL with Copy + "Open checkout" | Dedicated "P2P is unavailable right now" state for `503`/`no_provider_available`; generic error text otherwise; **silent local-fake-order fallback on pure network failure (§6.3)** |
| **Request Withdrawal** | Balance → button(s) | amount (USDT, capped at displayed balance) | Client: `Number(amount)` truthy only — **no actual bound/positive check beyond truthiness** | **None — fake** | Fake "✓ submitted" message after 1.2s | N/A (nothing can fail because nothing is sent) |
| **Change Password** | Profile → button | current, new, confirm | Client: all-filled + new==confirm. **No password-strength check.** | **None — fake** | Fake "saved" flash | N/A |

**Accessibility:** identical gap to the Admin panel's `Modal` primitive — Escape/backdrop-click close correctly, but no focus trap, no `role="dialog"`/`aria-modal`, no focus restoration on close, present in all three modals above.

**The Create New Order modal is the one genuinely well-designed modal in the panel** — real validation, a real and well-differentiated error state for the most likely real-world failure (no trader available), and a properly gated one-time-reveal pattern for the resulting checkout link. The other two modals (Withdrawal, Change Password) are polished UI wrapped around no real functionality.

---

## 20. Technical Debt

**Critical**
- Balance page "Request Withdrawal" is entirely fake — no backend endpoint exists for merchant fund withdrawal at all (§6.6, §21).
- API Credentials "Regenerate" (both key and secret) is entirely fake despite a fully correct backend endpoint sitting unused (§6.7, §21).
- Webhooks "Save" doesn't call the real, working `setWebhook` endpoint — a merchant cannot configure their own integration's webhook URL through any UI (§6.8, §14).
- The NGO-verification order-confirmation path bypasses balance settlement and webhook delivery entirely, silently diverging "order shows as successful" from "merchant was actually paid" (§8, §21).
- Login has no working path for any merchant account with 2FA enabled — the fix is unusually cheap since the state/handler logic already exists and only the render branch is missing (§3, §6.1).

**High**
- Webhooks page advertises event names that mostly don't match any event the backend ever actually fires, including one (`payout.settled`) that is never fired under any code path (§6.8).
- No merchant-facing settlement-history data source exists at all, despite the data needed to build one (`merchant_receives_usdt`/`merchant_fee_usdt` per order) already existing on every settled `Order` row (§6.6, §13, §16).
- No email notification channel exists anywhere in the product for merchants (§17).
- Dashboard's "Today's Collections" trend badge is a hardcoded fake percentage shown with equal visual weight to five real numbers (§6.2, §11).
- Client-side-only pagination/search/filter on Orders/Transactions will silently under-report totals once real volume exceeds the backend's default page size (§18).

**Medium**
- Dashboard's Recent Transactions widget uses the static mock array instead of the real, already-fetched-elsewhere `merchantApi.transactions()` (§6.2).
- Balance page hardcodes a `* 89` INR-conversion literal instead of using the real, admin-configurable exchange rate (§6.6).
- `Transactions.jsx`'s Method column conflates two unrelated taxonomies (detection engine vs. UPI-app brand), producing unpredictable fallback rendering (§6.5).
- `Transactions.jsx`'s native date inputs hardcode dark-mode-only styling, breaking theme parity — the same specific bug independently present in the Admin panel's `Payments.jsx` (§5).
- No shared `<Table>` component despite 4 near-identical hand-rolled tables (§5, §18).
- `authApi.me` is defined but never called on session rehydration — a stale/edited `localStorage` session is trusted with no server round-trip until the first real API call (§3).
- `README.md` still says "business logic is not implemented yet" — stale, and about half the panel genuinely is implemented (§2).
- `store/` directory and the `zustand` dependency are entirely unused, same as the Admin/Trader panels.

**Low**
- Sidebar's Orders badge is hardcoded to `0` and never updated, identical pattern to the Admin panel's sidebar badges (§4).
- No focus trap/`aria-modal`/focus-restoration on any of the panel's 3 modals (§19).
- The "fake regenerated" API key/secret in `ApiCredentials.jsx` appends a constant, non-random literal suffix (`'x9f2a7b1c4d8'`) to every generated value — a tell that would be obvious to anyone inspecting two consecutive "regenerations," though this is moot once the button is properly wired.

---

## 21. Security

*(Documentation of risk only — no exploitation performed.)*

Ranked by realistic impact to a merchant specifically:

1. **Fake credential rotation (§6.7, §15) — Critical.** A merchant responding to a suspected API-key/secret leak by clicking "Regenerate" changes nothing server-side. The compromised credentials remain fully valid indefinitely. This is the highest-impact security finding in this document because it directly undermines the one incident-response action a merchant is most likely to take during an actual compromise.
2. **Order-confirmation path with no balance/webhook effect (§8) — Critical, integrity not confidentiality.** The unauthenticated `POST /orders/verify-payment` callback (flagged by the backend's own code comment as needing production hardening) can mark any order `success` without moving money or notifying the merchant's system — meaning the platform's own reporting surfaces (which a merchant might reasonably use for revenue reconciliation or tax/accounting purposes) can disagree with the merchant's actual, bankable balance.
3. **Fake withdrawal (§6.6) — High, trust/operational risk rather than a direct exploit.** Not an attack surface, but a serious "the UI lies" risk: a merchant could believe funds are in transit when no request was ever made.
4. **Login mock-fallback on network failure (§3) — Medium**, same pattern and same mitigations as documented for the Admin panel: a visible (data-empty) authenticated session can be self-granted with zero valid credentials whenever the API host is unreachable from the browser. Every subsequent real API call still fails its own server-side auth check, so no *data* is exposed, but the authenticated shell renders.
5. **Broken 2FA login (§3, §6.1) — Medium**, availability rather than confidentiality: legitimate merchants who enabled 2FA cannot access their own account through this panel at all.
6. **Full API key sent to the browser regardless of reveal state (§6.7)** — low-severity, standard-practice-adjacent: the real key is in JS memory/React state on every page load whether or not "Show" is clicked. Not unusual for this class of product, but worth noting as an XSS-amplification factor (same as any secret rendered in an SPA).
7. **Plaintext-stored API secret (§15)** — a structural tradeoff (required for HMAC webhook signing), not a bug, but relevant to blast-radius assessment: a DB compromise yields immediately usable API credentials *and* the ability to forge validly-signed webhook payloads for every merchant simultaneously.
8. **No IP whitelist / no key scoping (§15)** — any valid key/secret pair works from anywhere, with full order-creation privilege; there is no lesser-privileged key tier.
9. **Role validation:** genuinely sound server-side (`checkRole('merchant')` on every real endpoint) — the client-side `ProtectedRoute` gap (§3) is defense-in-depth-only and not independently exploitable given the above.
10. **Destructive/consequential actions without confirmation:** creating a payout request (real recipient bank/UPI details) fires immediately on submit with no "are you sure" step — low severity given the downstream trader-acceptance/admin-settlement gate, but worth flagging as the one real financial-adjacent action in this panel that could benefit from a confirmation step.

---

## 22. Performance

- **Large order history (thousands of orders):** Orders/Transactions tables fetch the backend's default page and paginate/filter entirely client-side (§18) — correctness (not just speed) degrades once real volume exceeds the default `limit` (25, per `pagination()` in `utils/http.js`), because the "total" and page controls will reflect only the fetched batch, not the merchant's true full history.
- **Exports:** the Transactions CSV export operates only over whatever is currently loaded/filtered client-side — there is no way to export "all transactions ever" without first fixing the underlying pagination gap; a merchant with a large history cannot currently produce a complete export through this UI.
- **Search:** `HeaderSearch` fetches the merchant's own orders+transactions once (on first focus, real API calls) and filters client-side thereafter — reasonable at low volume, will silently miss anything beyond whatever the backend's default page returned, same root cause as the table-pagination gap.
- **Filtering:** all filtering (Orders' status tabs, Transactions' text+date-range, Payouts' status dropdown) except Payouts' is client-side over an already-narrow fetched set — Payouts is the one page that re-queries the server per filter change (`load(filter)` on every filter-state change), making it the most scalable of the four real data pages.
- **Realtime load:** `useSocket` listens for exactly 4 order event types; no polling exists anywhere as a fallback, so freshness outside of those 4 events depends entirely on manual navigation/refetch — acceptable at demo scale, would need a fallback polling or a broader socket-event vocabulary (payout events are conspicuously unheard, §6.4) to stay accurate under real order/payout volume.
- **No virtualization** on any table — not a concern at the row counts these pages currently reach given the pagination cap, but would compound with the pagination-correctness gap if that gap were "fixed" by simply raising `limit` rather than adding true server-side pagination controls to the frontend.

---

## 23. Final Feature Matrix

| Feature | UI | Backend | Database | Production Ready |
|---|---|---|---|---|
| Login (password) | Y | Y | Y | Y |
| Login (2FA) | N (started, abandoned) | Y | Y | **N** |
| Dashboard stat cards (6) | Y | Y | Y | Y (except one fake trend badge) |
| Dashboard revenue chart | Y | N | — | **N** |
| Dashboard recent transactions | Y | N (real endpoint exists elsewhere, unused here) | — | **N** |
| Orders list | Y | Y | Y | Y |
| Order creation (dashboard) | Y | Y | Y | Y |
| Order creation (API key, server-to-server) | N/A | Y | Y | Y |
| Payout request creation/tracking | Y | Y | Y | Y |
| Transactions list + CSV export | Y | Y | Y | Y (scale caveat, §22) |
| Balance — available/pending | Y | Y | Y | Y |
| Balance — this-month/next-settlement | Y | N | — | **N** |
| Balance — settlement history | Y | N | — | **N** |
| Balance — withdrawal | Y | N | — | **N (critical gap)** |
| API key view | Y | Y | Y | Y |
| API secret view | N (by design) | N (by design) | Y (exists, not exposed) | Y (correct as-is) |
| API key/secret regeneration | Y | Y | Y | **N — frontend never calls the real endpoint (critical gap)** |
| Webhook URL configuration | Y | Y | Y | **N — frontend never calls the real endpoint** |
| Webhook test delivery | Y | N | — | **N** |
| Webhook delivery logs | Y | N (no persistence layer) | N | **N** |
| Webhook signing + retry (backend capability) | N/A | Y | N/A | Y (backend-only; unreachable end-to-end) |
| Profile edit | Y | N | — | **N** |
| Password change | Y | N | — | **N** |
| Global search (orders/transactions) | Y | Y | Y | Y (scale caveat) |
| Realtime order toasts | Y | Y | — | Y |
| Realtime payout updates | N (rides unrelated order events) | Y (emitted) | — | **N** |
| Sidebar pending-orders badge | Y | N | — | **N** |

---

## 24. Final Score

| Dimension | Score /10 | Justification |
|---|---|---|
| Architecture | 6 | Clean route→controller→service→model layering, shared `orderService.createOrder` between the two creation paths (good DRY discipline), transactional settlement logic — undermined by zero shared reporting/settlement-history layer despite the raw data existing. |
| UI | 6 | Consistent component library, a deliberately unified purple accent with a cleaner color-map than the Admin panel's, a genuinely nice `CopyButton`/`Field` reuse pattern — undermined by the same no-shared-`<Table>` and modal-accessibility gaps as its sibling panels. |
| UX | 4 | The best-designed single flow in this codebase (Create Order's provider-unavailable error state) sits next to the worst-designed single flow (a "Withdraw funds" button that produces a confident false-success message for an action with zero effect) — the spread between the panel's best and worst moments is unusually wide. |
| Maintainability | 5 | Real logic is well-commented and traceable; the mixture of real/fake data sources is indistinguishable at a glance (mock imports and real API calls sit side-by-side in the same files with no naming convention separating them), which is itself a maintainability hazard for the next engineer. |
| Performance | 6 | Fine at demo scale; the pagination-correctness gap (§18, §22) is a real scale ceiling, not just a slowdown, once order volume grows. |
| Security | 4 | Sound server-side authorization everywhere it's exercised; the fake credential-rotation button is a genuinely serious gap for a payment product, compounded by the unauthenticated NGO-verify callback and the balance/webhook-skipping bug it can trigger. |
| Scalability | 4 | Same root cause as Performance — client-side-only search/sort/filter/pagination across every real table will not hold up past a few hundred records without a frontend change, independent of backend readiness (the backend already supports real pagination params; the frontend just never sends them). |

---

# 25. MERCHANT PRODUCT ANALYSIS

*(Business analysis only — no code referenced below except where a specific real capability changes what's realistically achievable. Written the way a payment-gateway Product Head would brief a new PM joining Stripe, Razorpay, Cashfree, PhonePe PG, or PayU's merchant-experience team.)*

### What information does a merchant need every morning?

Three questions, in this order, and the dashboard should answer them in under five seconds without a click: **(1) Did anything break overnight?** (failed webhooks, a spike in `disputed`/`rejected` orders, a provider-unavailable stretch where customers couldn't even get a UPI ID assigned). **(2) Is money moving normally?** (yesterday's volume vs. the trailing 7/30-day baseline, success rate vs. baseline — not just a raw number, always *relative* to what's normal for this merchant, because ₹40,000 means something completely different to a ₹5L/month merchant than a ₹5cr/month one). **(3) Is there anything that needs my decision today?** (a payout request stuck in dispute, a settlement that hasn't landed on schedule, an API-key rotation that's overdue). Today's build answers a version of (2) reasonably well and answers (1) and (3) not at all — there is no "attention required" surface anywhere in this panel.

### What decisions does a merchant make every day?

In a mature integration (post-onboarding), a merchant's daily decisions are mostly **exception handling**, not steady-state monitoring: what to do about a customer who claims they paid but the order is stuck in review; whether to escalate a disputed order; whether today's success rate drop is a platform issue or a customer-behavior blip; whether to create a payout request now or batch it. A smaller merchant still manually creating orders through the dashboard (rather than integrating server-to-server) also decides, order by order, whether to chase a customer whose checkout link expired. Today's product supports *creating* orders and *viewing* their status well, but supports **none of the exception-handling decisions** — there's no way to see "orders that need my attention" as a distinct view, no way to nudge/resend a checkout link, no way to see why an order was rejected without leaving the panel (the rejection reason field exists on the `Order` model but isn't surfaced anywhere on this panel's Orders table or modal).

### What financial information matters?

In priority order: **available balance** (can I use this money right now), **balance in flight** (how much of today's revenue is still "pending," i.e., not yet real), **fees paid** (as a rate, and as an absolute number, because a merchant doing volume needs both — "5% doesn't sound like much" changes fast when it's expressed as "₹2.3L this month"), **net settlement** (what actually lands, after fees), and **reconciliation-grade detail** (a downloadable, complete record tying every rupee received to a specific order/customer/UTR, suitable for the merchant's own accounting). Today's build gets available/pending balance right and gets absolute-fee-paid, net-settlement-history, and complete reconciliation-grade export all wrong or missing — which is a significant gap, because for most merchants "can I trust this platform's numbers for my own books" is table stakes before "can I trust this platform's UI."

### What operational information matters?

Trader/provider availability (is there capacity to serve customers right now — a merchant integrating checkout into their own site needs to know if "no provider available" is a real possibility they should design a fallback UX around, not just discover it live), webhook health (is my own system actually receiving events, or silently falling behind), and API health/rate limits (though this product doesn't currently have rate limits, a merchant scaling volume will eventually need to know what ceiling exists). None of these three exist as a surfaced concept anywhere in this panel today.

### What should be on the Dashboard?

Real-time or near-real-time: today's volume + a trailing comparison baseline (not a fabricated static percentage), success rate + a "why" breakdown when it dips (expired vs. rejected vs. disputed, since each implies a different fix), available balance, and an **"needs attention"** module (disputed orders, payouts stuck past a normal cycle, a webhook that's been failing). A revenue *trend* chart earns its place — but only once it's real; a permanently-empty chart is worse than no chart, because it reads as "we have had zero business," which actively damages trust in every other number on the same screen.

### What should never be on the Dashboard?

Anything that can't be made real quickly should be removed, not stubbed — a blank chart or a fabricated trend badge is strictly worse than that section not existing, because a merchant cannot distinguish "this is genuinely zero" from "this isn't built yet," and will (reasonably) assume the former about their own business. Raw operational/detection-engine internals (confidence scores, which APK engine caught a payment) belong in a support/debug view, not the merchant's own daily dashboard — that's Max Pay's internal plumbing, not the merchant's business.

### What actions should take one click?

Copying a checkout link, exporting the currently-filtered view, re-sending a webhook test ping (once real), viewing an order's full detail/timeline, and toggling between light/dark. None of these are financially consequential or hard to reverse.

### What actions should require confirmation (or more)?

Regenerating an API key/secret (this immediately invalidates the old one in a live integration — a single accidental click can cause a real outage for the merchant's own site; this deserves an explicit "type your business name to confirm" style gate, not a bare click), requesting a real withdrawal of funds, and creating a payout request above some material threshold (real recipient bank details, real money leaving the platform). Today's build requires zero confirmation for the one real destructive-if-real action available (payout creation) and — because the two truly dangerous actions (key regeneration, withdrawal) are currently fake — accidentally "protects" merchants from their own consequences purely by not working, which is not a strategy to keep once those features are actually built.

### What reports does a merchant need?

A settlement statement per period (what came in, what fees were taken, what was net-settled, ideally exportable as something an accountant can use directly — CSV at minimum, PDF/invoice-style for larger merchants), a full transaction-level export with no row-count ceiling, a payout-request statement (what left the platform, to whom, when), and — for anyone integrating seriously — a webhook delivery report (so they can audit their own integration's reliability independent of trusting their own logs). None of the four exist as real, complete features today; only a narrow, current-page-only Transactions CSV does.

### What KPIs matter (from a payment-gateway PM's perspective, not a generic SaaS one)?

Success rate (the single most-watched number at any payment company, because it's the clearest proxy for "is the checkout experience working"), average time-to-confirmation (how long between a customer clicking pay and the order settling — directly affects cart abandonment for the merchant's own funnel), provider-availability rate (how often "no provider available" fires — a hidden funnel-killer that never shows up in success-rate math because the order never got created at all), dispute rate, and payout cycle time (create → settlement_completed, end to end). Of these five, this build only surfaces success rate; the other four are invisible even though most of the underlying data already exists in the schema (order timestamps, dispute records, payout timestamps).

### What problems does a merchant actually face with this kind of platform?

Customers who claim payment but whose proof doesn't auto-match (stuck in review, with the merchant having zero visibility into *why* or *how long*); checkout links that expire before a customer completes payment; ambiguity about whether a "successful" order really paid out to their balance (a problem this specific codebase has *literally, structurally* per §8 — not hypothetical); confusion between "Payouts" (send money to someone else via a trader) and "withdraw my balance" (get my own money out), which are two different capabilities sharing one page name; and, if using the API directly, uncertainty about whether their webhook integration is even receiving events correctly, since there's no delivery visibility.

### What alerts should exist?

A payout stuck in `dispute` for longer than the normal cycle. A webhook that has failed N consecutive times. A material drop in success rate versus baseline. An API key that's approaching some age threshold without rotation (a security-hygiene nudge, not a hard requirement). A settlement that hasn't run when expected. None of these exist today — the only alert-adjacent thing in the product is the order-status toast, which is passive and only fires while the merchant happens to have the tab open.

### What should be real-time vs. historical?

Real-time: order status changes, balance changes, "provider available" state (if a merchant is watching a live queue of manual order creation). Historical: everything settlement/reporting-related, revenue trends, dispute resolution outcomes, payout cycle history. Today's build has decent real-time coverage for order status (sockets genuinely work for the 4 wired events) and effectively zero historical/trend coverage — the balance of what's built is backwards for a merchant's actual planning needs, which lean historical (a merchant checks "yesterday" and "this month" far more often, in aggregate time spent, than they watch a live order ticker).

### How should large merchants work?

A large merchant (high order volume, likely server-to-server integrated, likely with their own finance team) needs: complete, unlimited-row exports (not client-truncated CSVs), a real settlement-statement reconciliation flow their finance team can trust without engineering involvement, webhook reliability they can audit independently, and ideally role-separated access within their own team (a finance user who can see Balance/Settlement but shouldn't be able to regenerate API keys; an engineering user who manages credentials/webhooks but doesn't need payout-recipient details) — this product currently has exactly one merchant "role" per account with no sub-user concept at all, which becomes a real limitation the moment a merchant is big enough to have more than one person touching this panel.

### How should enterprise merchants work?

Beyond everything a "large" merchant needs: multiple API keys (so one integration's compromise doesn't require rotating every integration simultaneously), IP allowlisting per key, webhook signing-secret rotation independent of the API secret, a staging/sandbox mode to test integration changes without touching live orders, SLA-grade visibility into provider-availability and settlement-timing (because at enterprise volume, a slow settlement cycle is a cash-flow planning problem, not a curiosity), and account-level audit logs (who on the merchant's team changed the webhook URL, who regenerated a key, when). None of this exists, and most of it is a genuinely later-stage set of asks — reasonable to defer, but worth having on record as the ceiling this current single-key/single-role/single-environment model will eventually hit.

### The one-sentence summary a PM should walk into the next planning meeting with:

**The order-creation and order-status experience is genuinely close to production quality; everything downstream of "the order succeeded" — proving it, reporting it, moving it out, and protecting the credentials that created it — is either fake, missing, or (in one specific and serious case) silently wrong, which means the product currently earns a merchant's trust on day one and would lose it by the first billing cycle.**

---

## Audit Statistics

1. **Files read:** 35 — all non-generated files in `frontend/merchant` outside `.gitkeep` placeholders and `package-lock.json` (27 source `.jsx`/`.js`/`.css` files + 8 config/env/doc files), plus 20 backend files (`merchantController.js`, `orderController.js`, `payoutController.js` [reused from prior audit], `merchantRoutes.js`, `orderRoutes.js`, `payoutRoutes.js`, `orderService.js`, `rateService.js`, `webhookService.js`, `depositTypeChecker.js`, `smartMerge.js`, `apiKeyAuth.js`, `utils/ids.js`, `transaction.model.js`, `balanceLog.model.js`, plus `order.model.js`, `merchant.model.js`, `payoutRequest.model.js`, `settingsService.js`, `balanceService.js` carried over from the prior Admin-panel audit of the same backend).
2. **Routes found:** 9 (1 public login + 8 protected pages) + 1 catch-all.
3. **APIs traced:** 21 distinct endpoints reachable from this panel or its direct integration surface (3 auth-core + 5 unused-2FA-management + 8 `/merchant/*` + 2 `/payout-requests/*` + 1 real `/api/orders/create` server-to-server path + the unauthenticated `/orders/verify-payment` callback documented for its indirect effect on merchant data).
4. **Fully wired pages:** 3 — Orders, Payouts, Transactions.
5. **Partial pages:** 3 — Dashboard (real stats, fake trend + empty chart + mock widget), Balance (real available/pending, fake everything else including withdrawal), API Credentials (real read, fake write).
6. **Mock/dead pages:** 2 — Webhooks (real backend unused end-to-end), Profile (no backend exists at all).
7. **Dead/fake actions identified:** 7 — API key regenerate, API secret regenerate, Webhooks Save, Webhooks Test, Balance "Request Withdrawal," Profile "Save changes," Profile "Change password."
8. **Business gaps** (product capabilities a real merchant would expect that don't exist at all, backend included): merchant fund withdrawal, settlement-history reporting, complete/unlimited exports, email notifications, sub-user/team roles, multi-key/scoped-key credential management, an "attention required" operational view.
9. **UX gaps:** fabricated dashboard trend metric shown with equal confidence to real ones; a false-success withdrawal flow; a false-success credential-rotation flow; a silently-abandoned 2FA login screen; "Payouts" vs. "withdraw my balance" naming ambiguity that maps to two structurally different (and only one existing) capabilities; no distinction anywhere between real and mock data at the UI level.
10. **Product improvement opportunities (highest-leverage, cheapest-first):** (1) build the missing 2FA code-entry screen — the logic already exists; (2) wire `regenKey`/`regenSecret` to the already-correct backend endpoint; (3) wire the Webhooks Save button to the already-correct `setWebhook` endpoint and fix the advertised event-name list to match reality; (4) fix the NGO-verification path to run through the real settlement/webhook pipeline instead of a bare status update; (5) build a real settlement-history endpoint from data that already exists on every `success` order; (6) build a real merchant withdrawal endpoint before this feature is trusted with real merchant expectations.
