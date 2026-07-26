# Trader Panel — Architecture Documentation

**Scope:** `frontend/trader` (React + Vite trader-facing panel of the P2P UPI Payment Gateway).
**Purpose:** a complete, as-built reference for engineers maintaining or extending this codebase. Documentation only — no source files were modified to produce this.
**Read as of:** 2026-07-24, current `main` branch state.

---

## 0. Executive summary

This is a single-role (`trader`) React SPA that lets a trader:
- see earnings/commission and trade volume (`Dashboard`),
- manage the UPI/wallet accounts they receive payments on (`Offers`),
- watch outgoing P2P sell trades (`Trades` / "Sell USDT"),
- process merchant payout requests for USDT credit (`BuyUsdt` / "Buy USDT"),
- view a legacy incoming-payout queue that appears to be superseded by `BuyUsdt` (`Payouts`),
- view raw payment notifications sourced from a **separate** Node/Mongo service (`Notifications`),
- pair and manage Android devices running a companion APK that reads bank/UPI app notifications (`Smartphones`),
- configure 2FA and account preferences (`Settings`).

Architecturally, this app talks to **two independent backends** with two different auth systems:
1. **The P2P gateway backend** (`backend/`, MySQL/Sequelize, port 4000) — orders, payouts, payment details, trader profile, JWT auth. Reached via `src/services/api.js`.
2. **The "NGO" backend** (`ngo-backend/`, MongoDB, port 3000) — device pairing, license keys, web-login scraper accounts, transaction/notification feed. Reached via `src/lib/ngoApi.js`, which logs in with a **hardcoded service account** baked into the frontend bundle.

A best-effort "mirroring" bridge (built into `Offers.jsx`) keeps a shadow copy of NGO accounts inside the gateway's `payment_details` table so the order-routing engine (which only knows about the gateway DB) can route orders to them. This dual-backend design is the single most important thing to understand before touching `Offers`, `Smartphones`, or `Notifications`.

---

# 1. Project Structure

```
frontend/trader/
├── .env / .env.example / .env.local   # Vite env vars (API base URLs)
├── index.html                          # SPA shell, mounts #root
├── package.json                        # deps/scripts
├── vite.config.js                      # dev server (port 5174) + /api, /socket.io proxy to :4000
├── tailwind.config.js / postcss.config.js
├── README.md                           # outdated — says "scaffold only", untrue
└── src/
    ├── main.jsx                        # ReactDOM root, StrictMode
    ├── App.jsx                         # BrowserRouter + route table
    ├── index.css                       # Tailwind + hand-written theme layer (CSS vars, .tf-* classes)
    ├── context/
    │   └── AuthContext.jsx             # auth state, login/2FA/logout, demo-login fallback
    ├── routes/
    │   └── ProtectedRoute.jsx          # gate: redirect to /login if !isAuthenticated
    ├── layouts/
    │   └── TraderLayout.jsx            # sidebar + topbar + <Outlet> shell for all authed pages
    ├── components/
    │   ├── Sidebar.jsx                 # nav, balance card, online toggle, collapse
    │   ├── HeaderSearch.jsx            # topbar search over orders + payment details
    │   ├── NotificationBell.jsx        # topbar bell + dropdown, unread tracked in localStorage
    │   ├── Toaster.jsx                 # module-level pub/sub toast system
    │   ├── DeviceManager.jsx           # UNUSED — device list + license modal + screenshot viewer
    │   ├── DashboardSections.jsx       # CommissionSection (real) + StatisticSection (demo chart)
    │   ├── icons.jsx                   # hand-rolled inline SVG icon set
    │   └── ui.jsx                      # Card, StatCard, Badge, Toggle, SearchInput, Select, Button, Tabs, Pagination, PageHeader
    ├── hooks/
    │   ├── useApi.js                   # fetch-with-mock-fallback hook
    │   └── useSocket.js                # socket.io-client connection, connected flag only (no event wiring)
    ├── services/
    │   └── api.js                      # axios instance for the GATEWAY backend (authApi, traderApi) + mock/offline mode
    ├── lib/
    │   └── ngoApi.js                   # fetch-based client for the NGO backend (separate auth, hardcoded creds)
    ├── utils/
    │   └── mock.js                     # formatters (inr/usdt/pct/maskUpi) + zeroed-out mock data/fallbacks
    ├── store/                          # empty (zustand is a declared dependency but unused)
    ├── assets/                         # empty
    └── pages/
        ├── Login.jsx                   # email/password + optional TOTP step
        ├── Dashboard.jsx                # stat cards, commission/statistic widgets, payment-detail health list
        ├── Trades.jsx                   # "Sell USDT" — outgoing order table, CSV export
        ├── Offers.jsx                   # "Offers & Details" — 1,998 lines; payment-method + account management, largest file by far
        ├── BuyUsdt.jsx                  # "Buy USDT" — merchant payout-request processing workflow
        ├── Payouts.jsx                  # legacy incoming payout queue (parallel/older feature to BuyUsdt)
        ├── Notifications.jsx            # raw transaction/notification log, sourced from the NGO backend
        ├── Smartphones.jsx              # APK device pairing + management
        └── Settings.jsx                 # deposit address, language/timezone, account, 2FA, Telegram bot stubs
```

### Folder-by-folder notes

| Folder | Role | Notes |
|---|---|---|
| `context/` | Single `AuthContext` — the only React Context in the app. | Holds `user`, `loading`, and auth actions. Everything else is local `useState` or prop drilling. |
| `routes/` | One file, one component (`ProtectedRoute`). | Route *table* itself lives in `App.jsx`, not here — the folder name overstates what's in it. |
| `layouts/` | One file, `TraderLayout`. | Owns theme (light/dark), online-status, live balance, and the app-wide socket connection; passes `{ online, setOnline, connected }` down via `Outlet context`. |
| `components/` | Mixed maturity. | `ui.jsx`/`icons.jsx` are a clean, theme-aware design-system layer. `DeviceManager.jsx` is dead code with hardcoded dark colors that don't participate in the theme system at all — see [Technical Debt](#technical-debt). |
| `hooks/` | Two small hooks. | `useApi` is used everywhere; `useSocket` only reports connection status — no app ever calls `socket.on(...)` on the object it returns except `TraderLayout` (for `order:new`) and `NotificationBell`/`Smartphones` (which re-derive their own sockets). |
| `services/` vs `lib/` | Two API clients for two different backends. | `services/api.js` = gateway (axios, JWT, refresh, mock fallback). `lib/ngoApi.js` = NGO backend (raw `fetch`, its own token, hardcoded login). This split is a major architectural fact, not just naming — see [API Layer](#api-layer). |
| `utils/mock.js` | Formatters + intentionally-zeroed mock data. | Comment at the top says data lists are "intentionally empty" now that pages load live data — this file is a fossil of an earlier mock-first build phase, still imported for its formatters. |
| `store/`, `assets/` | Empty (only `.gitkeep`). | `zustand` is installed (`package.json`) but has zero usages anywhere in `src/`. |

---

# 2. Routing

Defined entirely in [`App.jsx`](src/App.jsx). React Router v6, `BrowserRouter`.

| Path | Component | Protected? | Notes |
|---|---|---|---|
| `/login` | `Login` | Public | Only public route. |
| `/dashboard` | `Dashboard` | ✅ | Default landing page. |
| `/trades` | `Trades` | ✅ | Sidebar label "Sell USDT". |
| `/offers` | `Offers` | ✅ | Sidebar label "Details". |
| `/buy-usdt` | `BuyUsdt` | ✅ | Sidebar label "Buy USDT". |
| `/payouts` | `Payouts` | ✅ | **Not in the sidebar nav at all** — reachable only by direct URL. |
| `/notifications` | `Notifications` | ✅ | |
| `/smartphones` | `Smartphones` | ✅ | |
| `/settings` | `Settings` | ✅ | |
| `*` | redirect → `/dashboard` | — | Catch-all; if unauthenticated, `ProtectedRoute` then bounces to `/login`. |

Protected routes share one layout route:
```jsx
<Route element={<ProtectedRoute><TraderLayout /></ProtectedRoute>}>
  ...children...
</Route>
```
`ProtectedRoute` ([src/routes/ProtectedRoute.jsx](src/routes/ProtectedRoute.jsx)) shows a plain "Loading…" screen while `AuthContext` is rehydrating, then either renders `children` or `<Navigate to="/login" replace />`. It does **not** check role — the panel assumes every authenticated user is a trader (enforced server-side via `PANEL_ROLE = 'trader'` sent on login, and `checkRole('trader')` middleware on every `/api/trader/*` route).

### Navigation flow
- `Sidebar.jsx` defines the nav list (`NAV` const) independently of the route table in `App.jsx` — the two are **not derived from a single source of truth**, so adding a route requires updating both files (see [Technical Debt](#technical-debt)).
- The sidebar's `/downloads` entry is `disabled: true` and renders as an inert "soon" pill — a route that doesn't exist in `App.jsx` at all, only in the nav array.
- `Payouts` has a route but no nav entry (dead route from the nav's perspective); `Downloads` has a nav entry but no route (planned/future feature marker).
- Deep link into `Offers`'s "Link" flow can redirect to `/smartphones` (`navigate('/smartphones')` in `attemptLink`'s block-reason handler) when a payment detail has no live device — this is the one cross-page programmatic navigation in the app outside of login/logout.

### Public vs protected — auth flow detail
1. `Login.jsx` submits email+password to `authApi.login`.
2. If the backend responds `requires_2fa: true`, the component switches to a 6-digit TOTP entry step (`tempToken` state), without navigating anywhere.
3. On success either from step 1 or step 2, `AuthContext` persists `accessToken`/`refreshToken`/`user` to `localStorage` and the component calls `navigate('/dashboard', { replace: true })`.
4. `logout()` clears `localStorage` and sets `user` to `null`; nothing manually navigates — the next render of `ProtectedRoute` sees `isAuthenticated === false` and redirects.
5. A network-level 401 anywhere in the app (via the axios response interceptor in `services/api.js`) does a hard `window.location.href = '/login'` instead of a React Router navigation — this is a full page reload, not an SPA transition (see [Technical Debt](#technical-debt)).

---

# 3. Layout

All of layout/chrome lives in [`TraderLayout.jsx`](src/layouts/TraderLayout.jsx) + [`Sidebar.jsx`](src/components/Sidebar.jsx), with primitives from [`ui.jsx`](src/components/ui.jsx).

### Sidebar
- Fixed-height flex column (`h-screen`), width animates between `256px` (expanded) and `72px` (collapsed) via inline `style` transitions — not Tailwind's `transition` utilities.
- Collapse state persists to `localStorage['sidebar-collapsed']`.
- Contains, top to bottom: logo/collapse toggle → Total Balance card → Activity (online/offline) toggle → nav list → Logout.
- Balance card and Activity block each have a fully separate "collapsed" render branch (icon-only + tooltip via the custom `.tf-tip` CSS, driven by a `data-tip` attribute) rather than a single responsive layout — this doubles the JSX for every sidebar section.
- Nav items are driven by a `NAV` array of `{ to, label, icon, badge?, disabled? }`; badge counts come from a `badges` prop (`{ notifications, smartphones }`) that `TraderLayout` sources from `utils/mock.js`'s `counts` — which is **hardcoded to `0`/`0`** (see [Technical Debt](#technical-debt): sidebar badges never reflect real notification/device counts).
- Logout button styled red, calls `useAuth().logout()` directly (no confirmation dialog).

### Header (topbar)
Rendered inline inside `TraderLayout`, not its own component:
- Left: a realtime status pill (green/gray dot + "Realtime connected"/"Realtime offline") driven by `useSocket()`'s `connected` boolean.
- Right, in order: `HeaderSearch` → `NotificationBell` → theme toggle button (`Sun`/`Moon` from lucide-react) → user email/role text → an avatar circle showing the first letter of the user's email.
- No breadcrumbs, no page title in the header — each page renders its own `<PageHeader>` in the content area instead.

### Footer
**None.** There is no footer component or footer content anywhere in the panel.

### Responsive logic
- The overall shell is not designed mobile-first: `TraderLayout` hardcodes `height: '100vh', overflow: 'hidden'` and a fixed-width sidebar + flex-1 content area, with no breakpoint that collapses the sidebar into a drawer on narrow viewports. On a phone-width screen the sidebar would either overflow or squeeze the content area — collapsing it is a manual user action (the chevron button), not a responsive behavior.
- Individual pages do use Tailwind responsive prefixes for their internal grids (`sm:grid-cols-2 lg:grid-cols-5` in filter bars, `xl:grid-cols-2`/`xl:grid-cols-3` for two/three-column page bodies), so **content** reflows reasonably down to tablet width; the **chrome** (sidebar + topbar) does not adapt below that.
- `.tf-grid` (stat card grid) is the one deliberately responsive layout primitive: `grid-template-columns: repeat(auto-fit, minmax(230px, 1fr))`, so stat cards reflow to 1–4 columns purely from available width with no explicit breakpoints.
- `.tf-two` (Commission + Statistic row) explicitly collapses to a single column under `860px`.

### Theme
- Implemented entirely with CSS custom properties scoped under a `.tf-scope[data-theme="light|dark"]` selector in [`index.css`](src/index.css) — not Tailwind's `dark:` variant system, and not a CSS-in-JS theme object.
- `TraderLayout` owns the `theme` state (`'light' | 'dark'`), persisted to `localStorage['panel-theme']`, defaulting to `'light'`.
- Consumption pattern is inconsistent across the codebase:
  - `ui.jsx`, `Sidebar.jsx`, `HeaderSearch.jsx`, `NotificationBell.jsx`, `DashboardSections.jsx`, `Offers.jsx`'s newer NGO-tab UI, and `BuyUsdt.jsx` all use the CSS-var system (`var(--text)`, `var(--card)`, etc. via inline `style`) and therefore respect the toggle.
  - `Login.jsx`, `Trades.jsx`, `Payouts.jsx`, `Notifications.jsx`, `Settings.jsx`, most of `Offers.jsx`'s modals, and `Smartphones.jsx` use **hardcoded Tailwind dark-slate classes** (`bg-gray-900`, `text-gray-400`, `border-gray-800`, etc.) and render identically regardless of the theme toggle.
  - `DeviceManager.jsx` and parts of `Smartphones.jsx`'s pairing modal use **hardcoded hex colors in inline `style` objects** (`#111827`, `#00d4aa`), a third, independent styling approach.
  - Net effect: **toggling light/dark only visibly changes Dashboard, Offers' account-list panels, Sidebar, and the topbar — most data tables and every modal stay permanently dark.** This is the single biggest visual/UX inconsistency in the app (see [Design System](#design-system) and [Technical Debt](#technical-debt)).

### Spacing / Grid
- No spacing scale is formalized; values are ad hoc pixel numbers in inline `style` (`padding: '20px 22px'`, `gap: 18`, `borderRadius: 18`) alongside Tailwind spacing utilities (`p-4`, `gap-3`) in the same files. Two spacing systems coexist without a documented rule for which to use where.
- Grid: `.tf-grid` for stat cards; Tailwind `grid grid-cols-1 xl:grid-cols-2/3` for page bodies; plain flexbox for the shell.

---

# 4. Pages

## 4.1 Login (`src/pages/Login.jsx`)
- **Purpose:** authenticate a trader; supports an optional second TOTP step.
- **Components used:** none from `ui.jsx`/`components/` — entirely local Tailwind markup (its own inline spinner SVG, its own form styling). Only page in the app not built from the shared design-system primitives.
- **API calls:** `authApi.login`, `authApi.twoFAValidate` (via `AuthContext`).
- **Business logic:** on `requires_2fa` in the login response, switches to a code-entry form using `tempToken` state; `AuthContext.login` transparently falls back to a **demo login** (`isDemoLogin`: email contains "trader" + password `Trader@123456`) whenever the login request fails with a pure network error (backend unreachable) — this is a client-side authentication bypass path baked into production code (see [Technical Debt](#technical-debt)).
- **State:** local `useState` for email/password/showPassword/error/loading/tempToken/code — no Formik/react-hook-form, manual validation only (`required`, `maxLength`, digit-only regex on the TOTP field).
- **Problems:** hardcoded demo password shipped in the client bundle; no rate limiting/lockout feedback in the UI; error messages are shown verbatim from `err.response.data.message` (fine as long as the backend never leaks internals).
- **Possible improvements:** move demo/offline mode behind an explicit build-time flag rather than a silent network-error catch; share input styling with `ui.jsx` primitives for consistency.

## 4.2 Dashboard (`src/pages/Dashboard.jsx`)
- **Purpose:** trading overview — rate, success rate, FTD/STD counts, commission, pay-in/payout chart, and per-payment-detail conversion health.
- **Components used:** `Card`, `StatCard`, `Badge`, `Toggle`, `SearchInput`, `PageHeader` (from `ui.jsx`); `CommissionSection`, `StatisticSection` (from `DashboardSections.jsx`).
- **API calls:** `traderApi.dashboard()` (via `useApi`, with a full mock fallback object so the page always renders something instantly), `traderApi.paymentDetails()` (imperative `useEffect`, not `useApi`).
- **Business logic:**
  - `deriveMetrics()` computes a per-payment-detail success rate as `orders_confirmed / orders_total` (counts, not amounts).
  - `sections` buckets payment details into **Good / Paused Manually / New**, based on `is_active_detail`/`is_active` flags and whether the detail has any order history.
  - Refetches payment details on a global `window` `order:new` custom event (dispatched by `TraderLayout` when a socket `order:new` fires), so the health list updates near-real-time without its own socket subscription.
- **State:** `query` (search), `details` (payment details list) — both local; dashboard stat data comes from `useApi`.
- **Problems:** the "Values by Currency" card (30%/30-50%/50%+ conversion legend) is 100% static/decorative — its progress bars are always full-width regardless of any real number (`bg-red-500 w-full`, literally hardcoded); `StatisticSection`'s pay-in/payout chart is explicitly demo data (`STATDATA` const), not wired to any endpoint, and there's no visual indicator on the card itself telling the trader it's not real — only a source comment says so.
- **Possible improvements:** wire `StatisticSection` to a real pay-in/payout time-series endpoint; make the "Values by Currency" card compute from the same `sections` breakdown already on the page (it's directly under the list that has the real numbers) or remove it.

## 4.3 Trades — "Sell USDT" (`src/pages/Trades.jsx`)
- **Purpose:** table of the trader's outgoing P2P sell orders with filtering, pagination, and CSV export.
- **Components used:** `Card`, `Badge`, `Button`, `SearchInput`, `Select`, `Pagination`, `PageHeader`; local `CopyId`/`Stamp` helper components.
- **API calls:** `traderApi.orders()`, `traderApi.dashboard()` (for the current rate, to compute a fallback USDT deduction on rows without a persisted rate).
- **Business logic:** `orderToRow()` maps the API's Order System v2 shape onto the display row; `traderUsdt()` prefers the persisted `trader_deduction_usdt`, else derives `amount_inr / trader_rate`; client-side filtering (id/amount/bank/client substring, status exact match) and pagination (`PER_PAGE = 25`), all computed with `useMemo` over the full unfiltered dataset (no server-side filtering/pagination).
- **State:** `filters` object, `page` — local. Data via two independent `useApi` calls (orders + rate info).
- **Problems:** `myRate`/`binanceRate`/`client` columns are always `'—'` — the API doesn't return them, so roughly 3 of 10 table columns are permanently dead weight for every row; CSV export (`toCsv`) also emits these dead fields; filtering/pagination happening entirely client-side means this will not scale once a trader has thousands of orders (full list is always fetched).
- **Possible improvements:** either implement the missing rate-comparison fields server-side or remove the columns; move filtering/pagination server-side (`traderApi.orders` already accepts a `status` param — extend it).

## 4.4 Offers — "Details" (`src/pages/Offers.jsx`)
By far the largest and most complex page (1,998 lines — roughly 5× the next-largest file). Deserves its own subsection.

- **Purpose:** manage every payment method/account the trader receives money on — both "APK-connected" accounts (native to the gateway DB, tied to a physical Android device) and "Web Login" accounts (native to the NGO backend, tied to a scraper session against the provider's website).
- **Components used:** almost entirely self-contained — only `Card`, `Badge`, `Button`, `Toggle`, `SearchInput`, `Select`, `PageHeader` are imported from `ui.jsx`; every other piece (`Modal`, `Field`, `LimitWindow`, `LimitsForm`, `ApkWizardBody`, `WebLoginForm`, `AddAccountModal`, `EditModal`, `OffersColumn`, `DetailsColumn`) is defined locally in this one file.
- **API calls:**
  - Gateway (`traderApi`): `paymentDetails()`, `addPaymentDetail()`, `updatePaymentDetail()`, `deletePaymentDetail()`.
  - NGO (`lib/ngoApi.js`): `getAccounts`, `saveWebAccount`, `toggleAccount`, `updateAccount`, `deleteAccount`, `connectAccount`, `verifyOTP`, `getAccountStatus`, `getDevices`.
- **Business logic (the core architectural feature of this page):**
  - **Two account types, one screen.** "APK Connection" is a 3-step wizard (Select Bank → Fill details → Set limits) that POSTs straight to the gateway's `payment_details` table. "Web Login" is a single form (platform, UPI id, display name, provider login email/password/phone) that POSTs to the **NGO backend**, then immediately calls `connectAccount` → optionally an OTP step → a live scraper session.
  - **Routing bridge / mirroring.** Because the order-routing engine only reads `payment_details` (gateway DB) and has no concept of the NGO backend, every NGO/web account is mirrored into a `payment_details` row via `syncNgoAccountToPaymentDetail()`, tagged with `gatewayPaymentDetailId` on the NGO side so later edits update the same mirror instead of duplicating it. This sync is explicitly best-effort (wrapped in `.catch()` with just a console log) — a sync failure leaves an NGO account fully functional on its own side but **invisible to order routing**, silently.
  - **Backfill on load.** `loadNGOAccounts()` finds any NGO account missing a `gatewayPaymentDetailId` (e.g. created before this bridge existed) and fires off a background sync for each — again best-effort, with only a console error on failure.
  - **Readiness gate.** Before letting a trader "Link" an unlinked-but-active payment detail into rotation, `attemptLink()` → `checkDetailLiveness()` verifies there's an actually-live data source behind it (device heartbeat within 15s for APK, `getAccountStatus().isAlive` for web) — checked fresh every time, not from cached state — and blocks the link with an inline error + a "Reconnect"/"Go to Smartphones" action if not.
  - **Polling.** While any NGO account is `pending` or `paused`, the page polls `loadNGOAccounts()` every 5s so OTP/connect state transitions surface without a manual refresh.
- **State:** a large number of independent `useState` calls at the page level (`details`, `ngoAccounts`, `adding`, `editing`, `otpValues` keyed by account id, `linkBlocked` keyed by detail id, `rowMenuId`, `renamingId`, etc.) — no reducer, no context; all prop-drilled into `OffersColumn`/`DetailsColumn`.
- **Problems:**
  - Single-file size (1,998 lines) makes this page hard to safely modify — the modal components, the two account-type wizards, the mirroring logic, and both list columns are all co-located with no internal module boundaries.
  - The NGO backend login credentials (`staff@bright.org` / `staff123`) are hardcoded in `lib/ngoApi.js` and used transparently by every call this page makes — a shared service account with no per-trader NGO identity (see [Technical Debt](#technical-debt) and [API Layer](#api-layer)).
  - Web-login accounts store the provider's **login password in plaintext in the request body** (`loginPassword` sent as-is to the NGO backend) — whether it's encrypted at rest is a backend concern out of this doc's scope, but the frontend does nothing to protect it in transit beyond HTTPS/TLS (whatever the deployment provides) and renders a "256-bit encrypted" trust badge next to the form with no verifiable backing.
  - Mirroring/backfill failures are swallowed to `console.error` with no user-facing indicator — a trader can have a fully "connected" Web Login account that never receives orders and have no way to discover why from the UI.
- **Possible improvements:** split into multiple files (wizard, list columns, mirroring service); surface mirror-sync failures as a toast/badge instead of a silent console log; move the NGO login off a shared hardcoded account onto a per-trader/service-to-service credential.

## 4.5 BuyUsdt — "Buy USDT" (`src/pages/BuyUsdt.jsx`)
- **Purpose:** the trader-side workflow for processing merchant payout requests (trader pays the recipient INR, gets credited USDT).
- **Components used:** `Card`, `Badge`, `Button`, `PageHeader`; local `ProcessModal`, `Row`, `Elapsed`, `Countdown`.
- **API calls:** `traderApi.payoutRequests(status)`, `acceptPayout`, `processPayout`, `transferredPayout`, `cancelPayout`, `problemPayout`.
- **Business logic:** 6-tab status pipeline (`awaiting_processing → in_processing → awaiting_settlement → settlement_completed`, plus `canceled`/`dispute`); polls the active tab every 8s; a 1s ticker drives live "waiting" / countdown-to-expiry cells; `ProcessModal` is opened via a **second API call** (`processPayout`, a GET despite representing a state-advancing action) that returns full recipient details (bank/UPI/IFSC) for the modal.
- **State:** `tab`, `rows`, `counts`, `busyId`, `selected` (modal detail), `now` (ticker) — all local; per-action loading via `busyId`.
- **Problems:** `processPayout` is a `GET` that appears to be treated as a side-effecting "claim/lock" step server-side (opening the modal implicitly starts the processing clock) — a GET performing a state transition is a REST convention violation worth flagging even though it's a backend concern; the receipt "upload" is actually a raw text input for a URL with a placeholder admitting "upload coming soon" — no file upload exists.
- **Possible improvements:** rename/refactor the process-open endpoint to a POST if it does perform a state transition; replace the receipt URL text field with real file upload once available.

## 4.6 Payouts (`src/pages/Payouts.jsx`)
- **Purpose:** appears to be an **older/parallel** incoming-payout queue, functionally overlapping with `BuyUsdt`.
- **Components used:** `Card`, `Badge`, `Button`, `Tabs`, `Pagination`, `PageHeader`; local `WaitingTimer`.
- **API calls:** `traderApi.payouts()` only — no accept/process/cancel/dispute calls exist for this page at all.
- **Business logic:** `apiToRow()` explicitly defaults `waitingSeconds: 0` and `priority: 'normal'` because "the API has no waiting timer or priority" — so `WaitingTimer` always displays and counts down from `00:00` for every row, and the "High Priority" badge branch is unreachable dead code (nothing ever sets `priority: 'high'`).
- **State:** `tab`, `page` — local.
- **Problems:** the **"Accept for processing" button has no `onClick` handler at all** — it's a fully inert button that does nothing when clicked, in a table that otherwise looks complete and functional. Combined with the fake `WaitingTimer` and unreachable priority badge, this page reads as either abandoned mid-migration to `BuyUsdt` or an intentionally-disabled legacy screen that was never removed. It also has **no sidebar nav entry**, reachable only via direct URL — consistent with it being dead/half-migrated rather than an intentional secondary feature.
- **Possible improvements:** this is the strongest candidate in the whole codebase for deletion — confirm with the team whether `Payouts` is superseded by `BuyUsdt` and, if so, remove the page, its route, and `traderApi.payouts()` from the page's usage (the endpoint itself may still serve other callers — check before touching `services/api.js`).

## 4.7 Notifications (`src/pages/Notifications.jsx`)
- **Purpose:** raw log of incoming payment notifications ("Logs of notifications for Automation").
- **Components used:** `Card`, `Badge`, `Button`, `SearchInput`, `Select`, `Pagination`, `PageHeader`.
- **API calls:** **`getTransactions()` from `lib/ngoApi.js`** — this page does not call the gateway backend at all. A source comment explicitly notes this replaces an older API and that real payment events land here (via the NGO backend's scraper), "unlike the P2P gateway's MySQL `NotificationLog` table, which nothing currently writes to" — i.e., there is a whole unused table on the gateway side.
- **Business logic:** `apiToRow()` maps an NGO `Transaction` document to a display row; `bank` is always `null` (nothing populates a receiving-account identity on these rows); the refresh button is **cosmetic** — `refresh()` just flips a spinning-icon state for 600ms via `setTimeout` and does not refetch data.
- **State:** `filters`, `page`, `refreshing` — local; data via `useApi` with a mock fallback.
- **Problems:** the "Refresh" button visually spins but never re-fetches — a trader clicking it to check for new notifications gets no new data despite clear affordance that something happened; page title says "for Automation" without explaining what that means to a first-time trader.
- **Possible improvements:** make `refresh()` actually call the underlying fetch; consider merging this page's mental model with `Smartphones`/`Offers` now that all three ultimately read from the same NGO backend, to reduce the "which page shows what" cognitive load.

## 4.8 Smartphones (`src/pages/Smartphones.jsx`)
- **Purpose:** pair and manage Android devices running the companion "PaymentBot" APK, which reads bank/UPI notifications on the phone to auto-detect payments.
- **Components used:** `Card`, `Badge`, `Button`, `SearchInput`, `Select`, `PageHeader`; a locally-defined pairing-popup style object (`popupStyles`), independent of the shared theme.
- **API calls:** `getDevices`, `generateLicense`, `renameDevice`, `deleteDevice` (all `lib/ngoApi.js`); `traderApi.paymentDetails()` (gateway) to compute which payment details are linked to which device.
- **Business logic:**
  - Pairing flow: click "Add Smartphone" → "PaymentBot" menu item → install-instructions modal → "The app is installed" generates a one-time license/pairing code (`generateLicense()`) with a server-issued expiry → a code-entry modal with a live countdown, listening on a **dedicated socket.io connection** (joins the trader's real `ngoId` room) for a `device-registered` event that auto-closes the modal.
  - Online/offline dot is a derived, polled value (`ONLINE_POLL_MS = 15s`) rather than a push-driven one, because the backend's Mongo `status` field "never flips back on disconnect" — a documented backend limitation this page works around by re-polling instead of trusting the stored status.
  - Per-row 3-dot menu supports inline Rename (PATCH) and Delete (confirm + real DELETE) — one row's menu/rename box open at a time.
- **State:** `devices`, `filters`, pairing flow state machine (`pairStep: null | 'install' | 'code'`), per-row `rowMenuId`/`renamingId`/`expandedDeviceId` — all local.
- **Problems:** the "Download Android APK" link in the install-instructions modal is `href="#"` — a dead link with no real APK download wired up; the modal instructs the trader to click it with no visible fallback if it does nothing.
- **Possible improvements:** wire the download link to the actual APK artifact/store listing; consider pushing device status changes over the socket already established for pairing instead of polling every 15s.

## 4.9 Settings (`src/pages/Settings.jsx`)
- **Purpose:** account preferences, deposit address display, and 2FA management.
- **Components used:** `Card` (via local `Section` wrapper), `Badge`, `Button`, `Select`, `PageHeader`; local `TwoFactorSection`.
- **API calls:** `authApi.twoFAStatus`, `twoFASetup`, `twoFAVerifySetup`, `twoFADisable` — 2FA only. Nothing else on this page talks to any backend.
- **Business logic:** `TwoFactorSection` implements the full enable flow (status → QR/secret → verify code → one-time backup codes shown once) and disable flow (TOTP code + password) with `toast()` feedback on each transition.
- **State:** all local to `Settings`/`TwoFactorSection` (`language`, `timezone`, 2FA setup/backup-code state). Language and timezone selectors have **no persistence** — changing them updates only in-memory `useState`, nothing is sent to any API and nothing is read from `localStorage` on reload.
- **Problems:** the **USDT deposit address is a hardcoded placeholder string** (`'TXk9...demoTRC20walletAddress...8fQ2'`) with a working "Copy" button that copies this fake address — a real trader could copy and use a non-existent wallet address if this shipped as-is; "Change password" button, and both "Telegram Bots" ("Connect" / "Open link") buttons have **no `onClick` handlers** — three more fully inert buttons; Language/Timezone selectors are decorative only.
- **Possible improvements:** wire the deposit address to a real per-trader value from the backend (highest priority — this is a money-handling placeholder, not cosmetic); either implement or remove the password-change and Telegram-bot actions; persist language/timezone once i18n exists, or remove the selectors until it does.

---

# 5. Components

| Component | File | Reused in | Reusable as-is? | Improvement notes |
|---|---|---|---|---|
| `Card` | `ui.jsx` | Every page | Yes — pure presentational wrapper around `.tf-card`. | None needed. |
| `StatCard` | `ui.jsx` | Dashboard | Yes. | `index` prop only drives an animation delay — fine. |
| `Badge` | `ui.jsx` | Dashboard, Trades, Payouts, BuyUsdt, Notifications, Offers, Smartphones | Yes, widely and consistently reused. | Color prop is a closed enum (`BADGE_HEX`) — extend the map rather than passing raw hex when adding new statuses. |
| `Toggle` | `ui.jsx` | Sidebar, Dashboard, Offers (multiple), BuyUsdt indirectly | Yes. | Good accessible base (`role="switch"`, `aria-checked`). |
| `SearchInput` | `ui.jsx` | Dashboard, Trades, Notifications, Offers, Smartphones | Yes. | Purely controlled, no debounce built in — `HeaderSearch` reimplements its own debounced input from scratch rather than wrapping this one (duplication). |
| `Select` | `ui.jsx` | Trades, Notifications, Smartphones, Offers, Settings | Yes. | Simple native `<select>` — fine for this app's needs. |
| `Button` | `ui.jsx` | Everywhere except Login | Yes. | Three variants (`primary`/`ghost`/`danger`); Login reimplements its own button styling instead of using this — inconsistency. |
| `Tabs` | `ui.jsx` | Payouts | Only one current usage. | Reusable, just underused — `BuyUsdt` reimplements a near-identical tab strip manually (with count pills) instead of reusing this component; worth consolidating. |
| `Pagination` | `ui.jsx` | Trades, Payouts, Notifications | Yes. | Consistent across all three. |
| `PageHeader` | `ui.jsx` | Every page | Yes. | Good, consistent pattern. |
| Icon set | `icons.jsx` | Everywhere | Yes — no external icon lib dependency for these. | Coexists with `lucide-react` (used directly in `Sidebar`, `TraderLayout`, `HeaderSearch`, `NotificationBell`, `DashboardSections`) — **two icon systems in one app**; pick one and migrate the other out. |
| `Toaster` / `toast()` | `Toaster.jsx` | Global (mounted once in `TraderLayout`), called from Offers/Settings/TraderLayout | Yes, clean module-level pub/sub — no context/provider boilerplate needed. | Fixed 5s duration, no manual "action" buttons in a toast — fine for current usage. |
| `NotificationBell` | `NotificationBell.jsx` | `TraderLayout` only | Not designed for reuse (single call site), but internally fine. | Refetches on `payment:detected`/`order:confirmed` socket events "since no dedicated notification channel exists" — a documented workaround, worth adding a real channel if notification volume grows. |
| `HeaderSearch` | `HeaderSearch.jsx` | `TraderLayout` only | Same as above. | Loads *all* orders + payment details client-side then filters in memory — will not scale past a few hundred records without a real search endpoint. |
| `DeviceManager` | `DeviceManager.jsx` | **Nowhere** — not imported by any page or layout. | Dead code. | Duplicates ~70% of `Smartphones.jsx`'s device list + pairing-code modal logic, with a different (older, hardcoded-dark) visual style and its own `handleGenerateLicense`. Also the only place in the frontend that listens for a `screenshot-received` socket event and renders a captured payment screenshot inline — a feature that appears to have been superseded (or never finished) by the `Smartphones` page. See [Technical Debt](#technical-debt). |
| `DashboardSections` (`CommissionSection`, `StatisticSection`) | `DashboardSections.jsx` | Dashboard only | `CommissionSection` yes (real data, self-contained); `StatisticSection` is demo-data-only, not reusable until wired to a real endpoint. | See Dashboard page notes above. |

---

# 6. API Layer

Two entirely separate clients. Every endpoint below is confirmed against the backend route files (`backend/src/routes/traderRoutes.js`, `authRoutes.js`; `ngo-backend/src/routes/apk.js`, `ngo.js`) — all frontend calls have a matching backend route.

## 6.1 Gateway API (`src/services/api.js`) — axios, JWT, base `VITE_API_BASE_URL`

**Cross-cutting behavior:**
- Request interceptor attaches `Authorization: Bearer <accessToken>` from `localStorage` to every call.
- Response interceptor: on `401` + `code === 'TOKEN_EXPIRED'`, transparently refreshes once (`/auth/refresh`) and retries the original request; on any other `401` (except from `/auth/login` itself), clears storage and hard-redirects to `/login`; on a pure network error (no `response` at all) for any non-login request, **serves a mocked success response** (`mockResponseFor`) instead of surfacing the failure — this is what lets the panel run with zero backend connectivity.

| Function | Method & Path | Purpose | Used in |
|---|---|---|---|
| `authApi.login` | `POST /auth/login` | Trader login; body includes `role: 'trader'` so the backend can reject non-trader accounts. | `AuthContext` |
| `authApi.logout` | `POST /auth/logout` | Invalidate refresh token. | `AuthContext` |
| `authApi.me` | `GET /auth/me` | Rehydrate user on app load. | `AuthContext` |
| `authApi.twoFAStatus` | `GET /auth/2fa/status` | Is 2FA enabled. | `Settings` |
| `authApi.twoFASetup` | `GET /auth/2fa/setup` | Get QR/secret to begin enabling 2FA. | `Settings` |
| `authApi.twoFAVerifySetup` | `POST /auth/2fa/verify-setup` | Confirm TOTP code, finish enabling; returns backup codes. | `Settings` |
| `authApi.twoFADisable` | `POST /auth/2fa/disable` | Disable 2FA (requires TOTP + password). | `Settings` |
| `authApi.twoFAValidate` | `POST /auth/2fa/validate` | Step 2 of login when 2FA required. | `AuthContext`/`Login` |
| `traderApi.dashboard` | `GET /trader/dashboard` | Balance, rate, commission summary, today's trade counts. | `TraderLayout`, `Dashboard`, `Trades` |
| `traderApi.commission` | `GET /trader/commission?period=` | Commission total (INR+USDT) + trade count + delta% for today/week/month. | `CommissionSection` |
| `traderApi.setOnline` | `PUT /trader/online-status` | Toggle trader online/offline. | `TraderLayout` |
| `traderApi.orders` | `GET /orders?status=` | List the trader's orders. | `Trades`, `HeaderSearch`, `Dashboard` (indirectly via details, not orders) |
| `traderApi.notifications` | `GET /trader/notifications` | Gateway-side notification feed. | `NotificationBell` only — note `Notifications.jsx` the *page* uses the NGO feed instead, a naming collision worth flagging to new engineers. |
| `traderApi.payouts` | `GET /trader/payouts` | Legacy incoming payout queue. | `Payouts` |
| `traderApi.paymentDetails` | `GET /trader/payment-details` | List the trader's payment accounts. | `Dashboard`, `Offers`, `Smartphones`, `HeaderSearch` |
| `traderApi.addPaymentDetail` | `POST /trader/payment-details` | Create a payment detail. | `Offers` |
| `traderApi.updatePaymentDetail` | `PUT /trader/payment-details/:id` | Update/toggle a payment detail. | `Offers` |
| `traderApi.deletePaymentDetail` | `DELETE /trader/payment-details/:id` | Delete a payment detail. | `Offers` |
| `traderApi.payoutRequests` | `GET /trader/payout-requests?status=` | List merchant payout requests by status. | `BuyUsdt` |
| `traderApi.acceptPayout` | `POST /trader/payout-requests/:id/accept` | Claim a request for processing. | `BuyUsdt` |
| `traderApi.processPayout` | `GET /trader/payout-requests/:id/process` | Open full detail for processing (GET that appears to also start a clock — see 4.5). | `BuyUsdt` |
| `traderApi.transferredPayout` | `POST /trader/payout-requests/:id/transferred` | Mark as transferred (+ optional receipt URL). | `BuyUsdt` |
| `traderApi.cancelPayout` | `POST /trader/payout-requests/:id/cancel` | Cancel a request. | `BuyUsdt` |
| `traderApi.problemPayout` | `POST /trader/payout-requests/:id/problem` | Flag a dispute. | `BuyUsdt` |

Note: `traderRoutes.js` also exposes `GET /trader/balance-logs`, `PUT /trader/heartbeat`, and `POST /trader/payouts` — **none of these are called anywhere in the trader frontend**, i.e. backend surface with no current frontend consumer (possibly used by the APK directly, or dead backend code — out of scope to determine here).

## 6.2 NGO API (`src/lib/ngoApi.js`) — raw `fetch`, own token, base `VITE_NGO_API_BASE_URL`

All requests authenticate via `getNGOAuth()`, which logs in with a **hardcoded credential pair** (`staff@bright.org` / `staff123`) baked directly into the frontend source, caches the resulting token + a resolved `ngoId` in `localStorage` for 6 hours, and silently re-logs-in on cache miss/expiry or a `401`. Every trader using this panel shares this one NGO identity — there is no per-trader NGO account.

| Function | Method & Path | Purpose | Used in |
|---|---|---|---|
| `saveAPKAccount` | `POST /ngo/accounts` (`type: 'apk'`) | Declared but **not called anywhere** in the current pages (the APK flow instead goes through `traderApi.addPaymentDetail`). | Unused. |
| `saveWebAccount` | `POST /ngo/accounts` (`type: 'web'`) | Create a Web Login account (with provider login credentials in the body). | `Offers` |
| `getAccounts` | `GET /ngo/accounts` | List all NGO accounts (web + apk-tagged). | `Offers` |
| `toggleAccount` | `PATCH /ngo/accounts/:id/toggle` | Flip live/paused. | `Offers` |
| `updateAccount` | `PATCH /ngo/accounts/:id` | Edit account fields / limits / `gatewayPaymentDetailId` mirror link. | `Offers` |
| `deleteAccount` | `DELETE /ngo/accounts/:id` | Permanently delete (closes any live scraper session server-side). | `Offers` |
| `getTransactions` | `GET /ngo/transactions` | Raw scraped/APK-sourced payment transactions. | `Notifications` |
| `getNGOStats` | `GET /ngo/stats` | Declared, **not called anywhere** in the current pages. | Unused. |
| `connectAccount` | `POST /ngo/accounts/:id/connect` | Start/retry a web-login scraper session; may require OTP. | `Offers` |
| `verifyOTP` | `POST /ngo/accounts/:id/verify-otp` | Submit OTP to complete connect. | `Offers` |
| `getAccountStatus` | `GET /ngo/accounts/:id/status` | Liveness check for a web session. | `Offers` |
| `syncAccount` | `POST /ngo/accounts/:id/sync` | Declared, **not called anywhere** in the current pages. | Unused. |
| `generateLicense` | `POST /apk/generate-license` | Issue a device-pairing code. | `Smartphones`, `DeviceManager` (dead) |
| `getDevices` | `GET /apk/devices/:ngoId` | List paired APK devices. | `Smartphones`, `Offers` (device dropdown + liveness check), `DeviceManager` (dead) |
| `renameDevice` | `PATCH /apk/devices/:id` | Rename a paired device. | `Smartphones` |
| `deleteDevice` | `DELETE /apk/devices/:id` | Remove a paired device. | `Smartphones` |
| `getDeviceLiveness` | (derived, calls `getDevices` and finds by id) | Convenience wrapper — no dedicated endpoint. | Declared, not currently called (Offers does its own inline equivalent lookup). |

---

# 7. State Management

- **No global state library in active use.** `zustand` is a `package.json` dependency with zero imports anywhere in `src/` — either an abandoned plan or leftover from scaffolding.
- **React Context:** exactly one, `AuthContext` — `user`, `loading`, `login`, `validate2fa`, `logout`, `isAuthenticated`. Everything else is local component state or passed through `Outlet context` (`{ online, setOnline, connected }` from `TraderLayout` down to routed pages).
- **Custom hooks:**
  - `useApi(fetcher, { fallback, deps })` — the app's de facto data-fetching abstraction. Starts with `fallback` so the UI paints instantly, overlays real data on success, and **keeps the fallback silently on error** while exposing an `error` object the caller may or may not check. This "always show *something*" philosophy is why the app never has a true global loading spinner for its main content, but it also means a real backend outage can look identical to "no data yet" unless a page explicitly renders its `error`/`loading` flags (not all of them do — e.g., `Dashboard` shows a small "Loading…" text but no explicit error state banner).
  - `useSocket()` — establishes exactly one socket connection per hook call, reports `connected`, exposes the raw `socket` object. Each consumer (`TraderLayout`, `NotificationBell` via prop, `Smartphones`/`Offers` for narrower purposes) wires its own `.on()` handlers directly onto the object rather than there being a shared event-bus/subscription API.
- **Local component state** is the dominant pattern everywhere — most pages hold 3–10 independent `useState` calls rather than a `useReducer`, including `Offers.jsx`, which has enough interacting state (list data, two modal-open flags, per-row menu/rename ids, per-account OTP values, link-blocked map) that a reducer would likely reduce bugs from state calls getting out of sync.
- **Polling** (the app's substitute for a richer realtime layer in several places):
  - `BuyUsdt`: active tab re-fetched every 8s.
  - `Smartphones`: device list re-fetched every 15s (to catch stale "online" status the backend itself doesn't clear).
  - `Offers`: NGO accounts re-fetched every 5s while any account is `pending`/`paused`.
- **Caching:** none beyond `useApi`'s in-memory `data` state (re-fetches fully on every mount/dep change) and `localStorage` for auth tokens, theme, sidebar-collapsed state, notification-seen id, and NGO token/ngoId. There is no shared cache (no React Query/SWR) — the same data (e.g. `paymentDetails`) is independently fetched by `Dashboard`, `Offers`, `Smartphones`, and `HeaderSearch`, each keeping its own copy with no invalidation between them (editing a detail on `Offers` does not update what `HeaderSearch` already loaded until it re-fetches on next focus).
- **Realtime updates:**
  - One shared socket connection is established per page/component that needs it (`useSocket` in `TraderLayout`; ad hoc `io(...)` calls in `Smartphones` and, implicitly, wherever `NotificationBell` is passed the layout's socket).
  - `TraderLayout` listens for `order:new` and re-broadcasts it as a plain **`window` `CustomEvent`** (`order:new`) so pages that don't have direct socket access (`Dashboard`, `CommissionSection`) can still react — a lightweight but easy-to-miss cross-cutting mechanism; grepping for `socket.on` alone would not reveal that `Dashboard` and `CommissionSection` are realtime-reactive.
  - `NotificationBell` listens for `payment:detected` and `order:confirmed` as a proxy for "something changed, refetch notifications," explicitly because no dedicated notification socket event exists server-side.
  - `Smartphones`'s pairing-code modal opens its own **separate** socket connection (to the NGO backend's socket origin, joining the trader's `ngoId` room) only while the modal is open, for a single `device-registered` event.

---

# 8. Design System

There isn't a formal design system document or token file — it's reconstructed here from what the code actually does.

### Colors
- **Theme engine:** CSS custom properties on `.tf-scope` (see [index.css](src/index.css)): `--bg`, `--card`, `--sidebar`, `--cardborder`, `--text`, `--muted`, `--shadow`, `--hover`, `--headbar`, `--accent`, `--input-bg`, `--input-border`, `--track`. Light and dark values both defined; `--accent` (`#14b8c4`, teal) is identical in both themes.
- **Semantic/status colors** are a second, parallel palette defined as raw hex directly in JS (`ACCENT_HEX`/`BADGE_HEX` in `ui.jsx`, `ACCOUNT_TYPES` colors in `mock.js`, `STATUS_BADGE` in `BuyUsdt.jsx`, `CIRCLE` in `Offers.jsx`): emerald `#22c55e`, sky `#3b82f6`, violet `#8b5cf6`, amber `#f59e0b`, red `#ef4444`, teal `#14b8c4`, gray `#94a3b8` — the same six-ish colors are re-declared as separate constants in at least four files rather than imported from one shared palette module.
- **Non-theme-aware surfaces:** a third palette of literal dark-slate hex values (`#111827`, `#1f2937`, `#0b0f19`-ish grays) hardcoded in `DeviceManager.jsx` and the `Smartphones.jsx` pairing modal (`popupStyles`), and Tailwind's `gray-900`/`gray-800`/`gray-950` classes used directly (not via CSS vars) across `Login`, `Trades`, `Payouts`, `Notifications`, `Settings`, most of `Offers`'s modals.

### Typography
- Font stack set once, on `.tf-scope`: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. No custom webfont.
- No type-scale constants — font sizes are inline pixel values chosen per element (`fontSize: 26` for a stat value, `13` for labels, `11` for sub-text, etc.), duplicated across files rather than centralized (e.g. "13px muted label" appears with the same literal value in `ui.jsx`, `Sidebar.jsx`, `DashboardSections.jsx`, `Offers.jsx` independently).
- Weight convention is consistent in *practice* even if not centralized: 800 for hero numbers, 700 for headings, 600 for emphasis/badges, 500 for labels, 400 default.

### Spacing
- No spacing scale constant; see [Layout § Spacing/Grid](#spacing--grid) above — inline pixel values and Tailwind spacing utilities coexist without a documented boundary.

### Buttons
- One shared primitive (`Button` in `ui.jsx`) with `primary`/`ghost`/`danger` variants, all theme-aware via CSS vars.
- Several pages/components bypass it: `Login`'s submit button, `Smartphones`'s pairing-modal buttons (`popupStyles.primaryBtn`/`copyBtn`/`closeBtn`), `BuyUsdt`'s "I have a problem" button (raw `<button style={...}>`), and multiple icon-only buttons across the app (`tf-hbtn` class, used directly rather than through a shared `IconButton` component).

### Cards
- One shared primitive (`Card`/`.tf-card` — theme-aware, rounded 18px, subtle shadow), used consistently everywhere data is grouped. Modals (`Offers`, `BuyUsdt`) reimplement their own card-like container inline rather than reusing `Card` for the modal body.

### Inputs
- `SearchInput`/`Select` (theme-aware, `ui.jsx`) used consistently on list/filter pages.
- Form inputs inside modals (`Offers`'s wizards, `Settings`, `Login`) use a locally-defined `inputCls` Tailwind string per file instead of a shared `Input`/`TextField` component — at least three near-identical but independently-maintained input class strings exist across the codebase.

### Tables
- No shared `Table` component. `Trades`, `Payouts`, `BuyUsdt`, `Notifications`, `Smartphones` each hand-roll their own `<table>` markup with very similar (but not identical) header/row Tailwind classes (`border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500`, repeated near-verbatim five times) — a natural extraction candidate.

### Charts
- One hand-rolled inline-SVG bar chart (`StatisticSection` in `DashboardSections.jsx`) — animated bars, hover tooltips, vertical/horizontal orientation toggle, all built from scratch with no charting library. It is currently the only chart in the app, and it renders demo data.

### Badges
- `Badge` (`ui.jsx`) — single implementation, consistent everywhere it's used (status pills across Trades/Payouts/BuyUsdt/Offers/Notifications/Smartphones/Dashboard).

### Icons
- Two coexisting icon systems: a hand-rolled inline-SVG set (`icons.jsx`) and the `lucide-react` package (imported directly in `Sidebar`, `TraderLayout`, `HeaderSearch`, `NotificationBell`, `DashboardSections`). No functional problem today, but it's two dependencies doing the same job and a new engineer has to know both exist.

### Modals
- No shared `Modal` component at the app level — `Offers.jsx` defines its own local `Modal`; `BuyUsdt`'s `ProcessModal` and `Smartphones`'s pairing popups each hand-roll their own fixed-overlay markup independently, with three different visual treatments (one theme-aware, two hardcoded-dark).

### Animations
- CSS keyframes in `index.css`: `tf-float` (floating stat-card icon badges, staggered via inline `animationDelay`), `tf-in` (card/section entrance fade+slide). Both respect `prefers-reduced-motion: reduce`.
- `CommissionSection`'s big number "counts up" via a hand-rolled `requestAnimationFrame` easing loop (cubic ease-out, 800ms), also gated behind `prefers-reduced-motion`.
- `StatisticSection`'s SVG bars animate height/width via native SVG `<animate>` elements (not CSS/JS) — a third, independent animation technique in the same file family.

---

# 9. UX Flow

## 9.1 Primary trader session flow
```
Login (email + password)
  ↓ (if 2FA enabled)
Enter 6-digit authenticator code
  ↓
Dashboard  ← default landing page
  ↓
Toggle "Online" (Sidebar / Dashboard header) to start receiving orders
  ↓
Offers & Details → Add Payment Detail
  ├─ APK Connection tab → Select Bank → Fill details (+ optional device link) → Set limits → Save
  │     └─ (separately) Smartphones → Add Smartphone → PaymentBot → install → generate code → pair device → link device to the payment detail
  └─ Web Login tab → provider credentials → auto-connect → (optional) enter OTP → live
  ↓
Order arrives (socket `order:new`) → toast + Dashboard/Commission auto-refresh
  ↓
Trades ("Sell USDT") — trader can see the order land in the table; Order System v2 status progresses server-side
  ↓
Buy USDT — separately, merchant payout requests appear in "Awaiting Processing"
  → Accept for Processing → Process (opens modal with recipient bank/UPI/IFSC)
  → "I have transferred" (+ optional receipt URL) → Awaiting Settlement
  → (admin/backend confirms) → Settlement Completed, trader credited USDT
  (branches: Cancel → Canceled; "I have a problem" → Dispute)
  ↓
Notifications — raw feed of detected payments (informational, no actions)
  ↓
Settings — 2FA, deposit address, preferences (mostly read-only/decorative today)
```

## 9.2 Popups / modals inventory
| Modal | Triggered from | Purpose |
|---|---|---|
| Add Payment Detail (tabbed: APK / Web Login) | `Offers` → "Add Payment Detail" / per-bank "+" | Create a new receiving account, either device-linked or provider-web-login. |
| Edit Payment Detail | `Offers` → pencil icon on a detail row | Edit name/UPI/org/limits; delete (trader-native only). |
| Install PaymentBot | `Smartphones` → "Add Smartphone" → "PaymentBot" | Instructions + APK download link (currently dead `href="#"`) + "app is installed" continue action. |
| Enter pairing code | `Smartphones` (auto-follows Install modal) | Shows a server-issued, countdown-limited pairing code; auto-closes on a `device-registered` socket event. |
| Process payout | `BuyUsdt` → "Process" on an in-processing row | Shows recipient bank/UPI/IFSC + amount + rate; actions: transferred / transferred-without-receipt / cancel / report problem. |
| Native `confirm()` dialogs | `Offers` (delete NGO account), `Smartphones` (delete device) | Browser-native confirm, not a styled in-app modal — inconsistent with the rest of the UI's custom modal styling. |
| Native `alert()` dialogs | `DeviceManager` (dead code, license error), `Smartphones` (device-registered success, rename/delete failure) | Same inconsistency — blocking native browser dialogs used alongside a custom toast system that exists specifically to avoid this. |

## 9.3 Cross-cutting UX threads worth knowing before changing anything
- **Realtime feedback is toast-based**, not a persistent banner — `order:new` shows a toast and quietly triggers page refreshes; a trader who missed the toast has no persistent "new order" indicator besides re-checking Trades/Dashboard (the sidebar's `notifications` badge count is hardcoded to 0 and never reflects this — see Technical Debt).
- **Two "you're not really connected" affordances exist independently and can disagree:** the topbar's "Realtime connected/offline" pill (gateway socket) and the Smartphones online dot (APK device heartbeat, NGO backend) — a trader can be "Realtime connected" (gateway socket fine) while every device shows offline (APK side down), with nothing in the UI explaining the two are unrelated systems.
- **Offline/mock mode is invisible to the user.** When the gateway backend is unreachable, `services/api.js` silently serves mocked empty/zero responses for most endpoints — the trader sees a normally-rendering, just quietly empty, dashboard rather than an explicit "can't reach server" state, which could be confused with "you genuinely have zero trades" during a real outage.

---

# 10. Technical Debt

Ordered roughly by severity/risk, not by file location.

1. **Hardcoded demo login bypass in production code.** `AuthContext.isDemoLogin`/`DEMO_PASSWORD` (`Trader@123456`) lets any email containing "trader" log in with a fixed password whenever the login request hits a pure network error — this is a client-side authentication bypass shipped in the same bundle as real trader accounts. If this ever runs where the gateway backend can be intentionally blocked/DoS'd by an attacker (rather than just "genuinely down"), it's a real vulnerability, not just a demo convenience.
2. **Hardcoded shared credentials to a second backend.** `lib/ngoApi.js`'s `NGO_CREDENTIALS` (`staff@bright.org` / `staff123`) is a literal, unencrypted service-account login baked into the frontend JS bundle, used by every trader session to authenticate against the NGO backend. Anyone who opens devtools/network tab or reads the built JS gets a working credential to that entire backend, with no per-trader scoping.
3. **Fake/inert buttons that look fully functional.** Confirmed inert (no `onClick`, does nothing when clicked):
   - `Payouts.jsx` — "Accept for processing" button.
   - `Settings.jsx` — "Change password", "Connect" (PayIn Bot), "Open link" (Notification Bot).
   - `Smartphones.jsx` — "Download Android APK" link (`href="#"`).
   These are indistinguishable from working buttons by look/hover state; a trader has no way to know they're non-functional except by clicking and observing nothing happens.
4. **Placeholder financial data presented as real.** `Settings.jsx`'s USDT deposit address is a literal hardcoded demo string with a working copy button — the highest-severity "cosmetic" bug in the app, since it involves a wallet address.
5. **Dead component with duplicated + diverging logic.** `DeviceManager.jsx` is not imported anywhere, yet duplicates a large fraction of `Smartphones.jsx`'s device list, license/pairing-code modal, and adds a `screenshot-received` socket listener + inline image viewer that doesn't exist anywhere else in the live app. Anyone searching for "where does the screenshot viewer live" will find only dead code.
6. **Dual theme systems, inconsistently applied.** Roughly half the app (Login, Trades, Payouts, Notifications, Settings, most of Offers' modals, Smartphones) is hardcoded to dark Tailwind classes or literal hex values and does not respond to the light/dark toggle at all, while the other half (Dashboard, Sidebar, topbar, Offers' account-list panels, BuyUsdt) is fully theme-aware via CSS vars. The toggle exists and is discoverable in the header, so this reads as a broken feature rather than an intentional dark-only design for those pages.
7. **Sidebar badge counts are hardcoded to zero.** `Sidebar`'s `notifications`/`smartphones` badge props come from `utils/mock.js`'s `counts` object, which is a static `{ notifications: 0, smartphones: 0, payoutsAwaiting: 0 }` — these badges can never show a real unread/pending count regardless of actual backend state, even though `NotificationBell` (topbar) computes a real unread count independently right next to it.
8. **Two backends, two auth systems, no unified error surface.** When the NGO backend is unreachable, most `lib/ngoApi.js` calls throw and are caught individually per call site (sometimes a toast, sometimes only `console.error`, sometimes a bare `alert()`) — there's no consistent "NGO service unavailable" UX the way `services/api.js`'s mock-fallback gives the gateway backend.
9. **Naming collision: two different "notifications".** `traderApi.notifications()` (gateway) powers `NotificationBell`; the `Notifications` *page* uses an entirely different data source (`getTransactions()` from the NGO backend) and calls its rows "notifications" too. A new engineer fixing "the notifications page" bug could easily patch the wrong client.
10. **`Offers.jsx` at ~2,000 lines.** Six-plus locally-defined components (two full wizards, two list columns, a shared modal shell, a limits-form builder) live in one file with a large, flat page-level state surface (a dozen-plus independent `useState`s). This is the highest-risk file to modify safely and the best candidate for splitting into a small module folder.
11. **Best-effort data sync with silent failure paths.** `syncNgoAccountToPaymentDetail()` (Offers) and its backfill caller both catch and only `console.error` on failure — a trader can have a "Live" Web Login account that's actually invisible to the order router with zero UI indication.
12. **Unused dependencies / dead folders.** `zustand` is declared in `package.json` with zero usages. `src/store/` and `src/assets/` are empty except for `.gitkeep`. `README.md` still says "Business logic is not implemented yet — scaffold only," which is significantly out of date given the current feature set.
13. **Two icon libraries** (`icons.jsx` hand-rolled set + `lucide-react`) doing the same job with no clear rule for which to use where.
14. **Nav list and route table are separately maintained.** `Sidebar.jsx`'s `NAV` array and `App.jsx`'s `<Routes>` are two independent sources of truth; `Payouts` has a route but no nav entry, `Downloads` has a nav entry but no route. Adding/removing a page requires remembering to update both.
15. **`GET` performing a state-changing action.** `traderApi.processPayout` is a `GET` request that (per the "Time left" countdown appearing once the modal opens) appears to also start/confirm a processing window server-side — worth a backend-side review even though it's outside this doc's stated scope.
16. **All client-side filtering/pagination on unbounded lists.** `Trades`, `HeaderSearch`, and `Offers`'s device/account filters all fetch the full collection and filter/paginate in the browser — fine at current data volumes, a scaling risk once any trader accumulates thousands of orders/details.
17. **No shared `Table`/`Modal`/`Input` components** despite 4–5 near-identical hand-rolled implementations of each across pages — see [Design System](#design-system) for specifics. Not urgent, but every new page currently means re-deriving these from scratch or copy-pasting an existing page's markup.
18. **`StatisticSection`'s pay-in/payout chart is permanently demo data** with no in-UI indicator that it isn't real — a trader has no way to know the "Statistic" card on their own Dashboard isn't reflecting their own trades.
19. **Decorative-only controls:** `Settings`'s Language/Timezone selectors (no persistence, no effect); Dashboard's "Values by Currency" progress bars (always 100% width regardless of data).
20. **Plaintext provider credentials in the Web Login flow.** The "Web Login" tab in `Offers.jsx` collects and transmits the trader's UPI-provider login email/password/phone directly to the NGO backend over a normal fetch call, with a static "256-bit encrypted" trust badge that isn't backed by any verifiable client-side behavior (TLS aside, which is a deployment concern, not something this code controls or proves).

---

# 11. Final Score

| Dimension | Score (1–10) | Rationale |
|---|---|---|
| **Architecture** | 4 | Functionally coherent given the constraint of two independent backends, and the mirroring bridge is a reasonable (if fragile) solution to a real integration problem — but the dual-backend/dual-auth split is under-abstracted (raw `fetch` vs axios, two token systems, no shared client), and there's no clear ownership boundary enforced in code (any page can reach either backend directly). |
| **Code Quality** | 4 | Generally readable, well-commented in the tricky spots (the comments explaining *why* the mirroring bridge and readiness gate exist are genuinely good), but `Offers.jsx`'s size, the amount of copy-pasted table/modal/input markup, and several silent-failure (`console.error`-only) paths pull this down. |
| **Maintainability** | 3 | The biggest risk factors are structural: one 2,000-line page owning six components and a dozen state variables, two parallel-but-not-identical payout pages (`Payouts` vs `BuyUsdt`), a nav list disconnected from the route table, and a dead component (`DeviceManager`) that could mislead a future search. New engineers need a guide like this one before they can safely touch `Offers.jsx` or the NGO integration. |
| **UI** | 5 | The design-system primitives (`ui.jsx`, `icons.jsx`, the CSS-var theme layer) are genuinely well-built where they're used — but they're used inconsistently, so half the app looks like a different, older product (hardcoded dark theme, different modal chrome, different input styling). |
| **UX** | 4 | Core flows (login → go online → manage payment details → process orders/payouts) are logically sound and the readiness-gate / polling patterns show real thought about failure modes. Undercut by inert-looking buttons, a fake wallet address, a cosmetic refresh button, and two independent "connection status" indicators that can silently disagree. |
| **Accessibility** | 3 | Some good signals (`Toggle` uses `role="switch"`/`aria-checked`, reduced-motion is respected for the custom animations, most icon-only buttons have `aria-label`) — but no visible focus-state audit, heavy reliance on color alone for status (badges/dots) without a consistent text-alternative pattern, and native `alert()`/`confirm()` mixed in with custom modals creates an inconsistent screen-reader experience. |
| **Performance** | 5 | No obvious runtime performance problems at current scale (React Router v6, no unnecessary re-render patterns observed, animations gate on `prefers-reduced-motion`), but several pages fetch entire collections and filter/paginate client-side, multiple pages independently re-fetch the same `paymentDetails` data with no shared cache, and polling (5s/8s/15s intervals across three different pages) adds sustained request volume that will compound as the trader base grows. |
| **Scalability** | 3 | The architecture (two separate backends bridged by best-effort client-side sync) is the main scalability risk — every new "account type" or data source likely means another bespoke bridge like the NGO mirroring logic rather than a generalized integration layer. Client-side filtering/pagination and duplicate independent data-fetching compound this at the data-volume level too. |

**Overall read:** a functionally complete, actively-developed panel (not a "scaffold," despite what its own README claims) built by someone solving real integration problems under real constraints (a legacy MySQL-side order-routing engine that can't see a newer Mongo-backed device/scraper system) — but with enough unfinished-migration debris (a half-abandoned `Payouts` page, a dead `DeviceManager`, several inert buttons, a placeholder wallet address) that a maintaining engineer's first task should be a debris-clearing pass before adding new features, not after.
