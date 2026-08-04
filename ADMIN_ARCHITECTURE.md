# Max Pay — Admin Panel Architecture & UX Audit

**Scope:** `frontend/admin` (React/Vite) + the MySQL backend (`backend/`) admin surface it talks to.
**Method:** every file in `frontend/admin/src` was read in full; every route/controller/service/model touched by an Admin API call was traced to its Sequelize model and DB effect; every button, modal, and table was checked against its actual `onClick`/API call, not its visual appearance.
**Non-goals:** no code was modified. `ngo-backend` was inspected only to confirm whether the Admin panel depends on it (it does not — see §1 and §12).

---

## 1. Executive Summary

The Admin Panel is a single-role (`admin`) React console for operating the Max Pay P2P UPI payment gateway: managing traders (the individuals who receive UPI payments on the platform's behalf) and merchants (API clients who create payment orders), reviewing/settling orders, moderating disputes, approving merchant "Buy USDT" payout requests, and adjusting a handful of platform-wide rate settings.

It talks to exactly **one** backend: the MySQL/Express service in `backend/` (`VITE_API_BASE_URL` → `http://localhost:4000/api` in dev, `http://198.44.140.74:4000/api` in `.env`). It has **no dependency on `ngo-backend`** — that service is a separate NGO/partner integration consumed transitively by the order-verification pipeline (`Order.payer_name/payer_upi/auto_verified`, set by an NGO callback per `order.model.js:75-78`), never called directly by any Admin frontend code.

**What is genuinely production-shaped:**
- **Traders** (`Traders.jsx`) — list, create (with generated credentials shown once), edit commercial terms, adjust USDT balance, suspend/activate, toggle online — all real, all hitting `adminController` endpoints that write to MySQL inside transactions and emit socket events.
- **Merchants** (`Merchants.jsx`) — list, create, edit payin/payout fees — real and wired, though several row actions are decorative (see below).
- **Orders** (`Orders.jsx`) — the v2 review/settle/reject/dispute lifecycle is fully wired to `adminController`, which in turn calls the same `balanceService.settleOrder`/`smartMerge` path used by the automated confirmation flow. This is the most correctly engineered page in the panel.
- **Payouts** (`Payouts.jsx`) — the merchant "Buy USDT" payout-request moderation queue (approve/reject/dispute-resolve) is fully wired to `payoutService`, including real-time refresh on socket events.
- **Disputes** (`Disputes.jsx`) — listing and resolving is real; the intermediate "mark reviewing" step is not (local-only).
- **Settings → Rate & Revenue** — the four fields that actually exist as backend settings (`base_exchange_rate`, `admin_default_margin`, `trader_default_margin`, read-only `platform_revenue_usdt`) are genuinely loaded and saved.

**What is UI-only or disconnected, despite looking finished:**
- **Payments / Transactions** (`Payments.jsx`) — zero API calls of any kind. Filters, export-to-CSV, and the table all operate over a mock array that is now permanently empty. There is a real backend endpoint for admin-side manual payment matching (`POST /api/payment/manual`) that this page never calls.
- **Smartphones** (`Smartphones.jsx`) — zero API calls. The backend has working `GET /admin/smartphones` and `PUT /admin/smartphones/:id/disconnect` endpoints; the frontend never calls either. The "Force disconnect" button only flips local React state.
- **Settlement** (`Settlement.jsx`) — zero API calls. The backend has `GET /admin/settlements` and `POST /admin/settlements/trigger`; neither is called. "Trigger manual settlement" is a `setTimeout` that fakes a 1.2s loading spinner and does nothing.
- **Settings → everything except Rate & Revenue** (fees, order expiry, exchange-rate source, Telegram bot tokens, email-alert/maintenance toggles, IP whitelist) — all local component state, seeded with **hardcoded placeholder values** (including two RFC 5737 documentation IP addresses), and the page's main "Save changes" button performs no network call at all.
- **Dashboard** charts and "Top Traders/Merchants" lists — the six headline `StatCard`s are real (`GET /admin/dashboard`); the 7-day volume chart, success/fail donut, and both "Top by volume" lists are bound to mock arrays that are now permanently empty, so they render as blank/zero-state UI forever.
- **Sidebar badge counts** (Orders/Payouts/Disputes) are hardcoded to `0` in `utils/mock.js` and never populated from any API — they can never show a non-zero number, regardless of real backlog.

**A genuine bug, not just a stub:** Dashboard's "Live Transaction Feed" (`Dashboard.jsx:112-134`) runs a `setInterval` that indexes into the (now-empty) mock `merchants`/`traders` arrays using `seed % merchants.length`. Because `merchants.length === 0`, this is `seed % 0 → NaN`, so `merchants[NaN]` is `undefined`, and the next line dereferences `merchant.businessName` on `undefined` — throwing an uncaught `TypeError` every 3.5 seconds, forever, silently, in the browser console. The feed never populates. This is classified **BROKEN**, not merely disconnected.

**Distinguishing "looks done" from "is done":** a successful-looking toast (`toast('Fees updated', 'success')`) always follows a real `await adminApi.*()` call that resolved — the panel does not fake success toasts. Where the panel fakes success, it fakes it structurally (no API call exists at all), which is why the page-by-page audit in §7 is necessary — visual inspection alone would rate every page "done."

---

## 2. Complete Project Structure

```
frontend/admin/
├── .env / .env.example / .env.local   # VITE_API_BASE_URL, VITE_WS_URL, VITE_APP_NAME
├── index.html                          # <title>P2P UPI — Admin Panel</title>, mounts #root
├── package.json                        # react 18.3, react-router-dom 6.23, axios, socket.io-client, zustand (unused), lucide-react, tailwind
├── postcss.config.js / tailwind.config.js
├── vite.config.js                      # port 5173, proxies /api and /socket.io to :4000
├── README.md                           # says "Business logic is not implemented yet — scaffold only" (STALE — see §14)
├── dist/                               # committed build output (stale artifact, not source)
└── src/
    ├── main.jsx                        # ReactDOM.createRoot → <App/>
    ├── App.jsx                         # router: /login public, everything else behind ProtectedRoute+AdminLayout
    ├── index.css                       # `.tf-scope` design-token layer (light/dark), shared with the Trader panel
    ├── layouts/
    │   └── AdminLayout.jsx             # sidebar + topbar shell, theme state, useSocket(), <Outlet context={{connected}}/>
    ├── routes/
    │   └── ProtectedRoute.jsx          # redirects to /login if !isAuthenticated; NO role check
    ├── context/
    │   └── AuthContext.jsx             # login/logout/me, localStorage session, mock-login fallback on network error
    ├── hooks/
    │   ├── useApi.js                   # generic {data,loading,error,refetch} wrapper around a fetcher promise
    │   └── useSocket.js                # socket.io client; joins 'admin' room; re-broadcasts as window 'order:update' events
    ├── components/
    │   ├── Sidebar.jsx                 # nav list, collapse toggle, badge counts (hardcoded 0 — see §5)
    │   ├── HeaderSearch.jsx            # live cross-entity search (orders/traders/merchants), real API, client-side filter
    │   ├── NotificationBell.jsx        # "recent activity" = last 20 orders, real API, unread-count via localStorage watermark
    │   ├── toast.jsx                   # module-level pub/sub toast system + <Toaster/>
    │   ├── icons.jsx                   # 24 inline SVG icons (no external icon lib dependency for these)
    │   └── ui.jsx                      # Card, StatCard, Badge, Toggle, SearchInput, Select, Input, Button, Tabs, Pagination, PageHeader, Modal, Field, Section, InlineLoader, EmptyRow
    ├── pages/
    │   ├── Admin.jsx                   # login screen (route: /login)
    │   ├── Dashboard.jsx                # route: /dashboard
    │   ├── Traders.jsx                  # route: /traders
    │   ├── Merchants.jsx                # route: /merchants
    │   ├── Orders.jsx                   # route: /orders
    │   ├── Payments.jsx                 # route: /payments  — 100% mock, see §7.6
    │   ├── Payouts.jsx                  # route: /payouts
    │   ├── Disputes.jsx                 # route: /disputes
    │   ├── Smartphones.jsx              # route: /smartphones — 100% mock, see §7.9
    │   ├── Settlement.jsx               # route: /settlement — 100% mock, see §7.10
    │   └── Settings.jsx                 # route: /settings — hybrid, see §7.11
    ├── services/
    │   └── api.js                       # axios instance + interceptors, authApi, adminApi, orderApi (the entire API surface)
    ├── utils/
    │   └── mock.js                      # formatters (inr/usdt/pct/maskUpi/…) + data arrays, ALL now empty (see §13)
    ├── store/                           # empty (.gitkeep only) — zustand is a dependency but is never imported anywhere
    └── assets/                          # empty (.gitkeep only)
```

**Dead/legacy artifacts found:**
- `store/` — zustand is listed in `package.json` and the README's structure diagram, but no file in `src/` imports `zustand`. Dead dependency.
- `dist/` is committed to the repo (build output, not source) — not something a repo audit should treat as current state, but worth flagging for cleanup.
- `README.md:34` — "⚠️ Business logic is not implemented yet — scaffold only" is stale; most business logic (Traders/Merchants/Orders/Payouts) is implemented. Leaving this note in place risks a new contributor underestimating what already exists.
- No `frontend/admin` file exists outside `src/` that is imported by another panel, and nothing in `frontend/trader` or `frontend/merchant` (if present) imports from `frontend/admin` — the panel is self-contained.

---

## 3. Admin Roles and Permissions

**There is exactly one role: `admin`.** `backend/src/models/user.model.js:20` defines `role: ENUM('admin','trader','merchant')` — no sub-roles (no Super Admin, Finance Admin, Support Admin, read-only Admin) exist anywhere in the schema, JWT payload, or middleware.

- **Authentication:** JWT (`authService.issueTokens`), access + refresh pair, stored in `localStorage` (`accessToken`, `refreshToken`, `user`). `AuthContext.jsx` attaches `Authorization: Bearer <token>` via an axios request interceptor (`api.js:31-35`).
- **Authorization:** `backend/src/routes/adminRoutes.js:14` — `router.use(verifyToken, checkRole('admin'))` gates the entire `/api/admin/*` namespace at the router level. `checkRole` (`middleware/auth.js:48-58`) checks `req.user.role` decoded from the JWT — this is genuine server-side enforcement, not a UI-only gate.
- **Frontend route protection:** `ProtectedRoute.jsx` only checks `isAuthenticated` (`!!user`) — **it does not check `user.role === 'admin'`.** In practice this is low-risk because (a) `authApi.login` is called with `role: PANEL_ROLE` ('admin') and the backend rejects a non-admin login attempt (`authController.js:56-58`), and (b) every subsequent admin API call is independently role-checked server-side. But it means the client-side gate itself provides no real protection — it is UX plumbing, not a security boundary.
- **Security-relevant weakness — mock-login on network failure:** `AuthContext.jsx:65-76` — if `authApi.login` throws with `!err.response` (i.e., the backend is unreachable, not a credential rejection), the panel **logs the user in locally as a hardcoded `MOCK_USER` (`role: 'admin'`, `email: 'admin@p2p.com'`) with mock tokens**, regardless of what credentials were typed. This is intentional "offline demo mode" (per the code comment and the login page's own text, `Admin.jsx:104`: *"Demo mode · any email & password signs you in as admin"*), but it means: **anyone with network access to the panel's static assets, on a machine that cannot reach the API host, can self-grant an admin session with no credentials at all.** Any subsequent API call will fail its own `verifyToken` check server-side (mock tokens aren't valid JWTs), so no *data* is exposed — but the app renders the entire authenticated admin shell (sidebar, all page chrome) to an unauthenticated visitor. Flagged in §17 (Security).
- **Session rehydration** (`AuthContext.jsx:18-53`): on load, if a token exists, `authApi.me()` is called to confirm it; on failure it falls back to the `user` JSON cached in `localStorage` **without re-validating role or expiry** — i.e., a stale/edited `localStorage.user` is trusted whenever the network call fails, for the same reason as above.
- **Permissions storage:** role lives only in the JWT payload (`decoded.role`, set at issuance) and the `users.role` column. There is no permissions table, no per-action ACL, no admin-of-admin distinction.
- **2FA exists in the backend** (`authController.js` — `validate2fa`, `setup2fa`, `verifySetup2fa`, `disable2fa`, `status2fa`, all mounted under `/api/auth/2fa/*`) **but the Admin frontend never uses it.** `Admin.jsx`'s login handler calls `login(email, password)` and immediately `navigate('/dashboard')` on success; it never inspects `data.requires_2fa` (which `authController.js:68-74` returns when the account has 2FA enabled) and never renders a TOTP-entry step. **If an admin account has 2FA enabled, login through this panel is broken**: the backend responds `{ requires_2fa: true, temp_token, role }` with no `accessToken`/`user`, `AuthContext.login` destructures `data.user`/`data.accessToken`/`data.refreshToken` as `undefined`, persists `undefined` into `localStorage`, and calls `setUser(undefined)` — the UI will appear to "succeed" (no thrown error) and navigate to `/dashboard`, but `isAuthenticated` (`!!user` → `!!undefined` → `false`) will immediately bounce the user back to `/login` via `ProtectedRoute`. No 2FA entry screen exists to recover from this.

---

## 4. Routing and Navigation

Router: `react-router-dom` v6, `BrowserRouter`, defined entirely in `App.jsx`.

| Path | Component | Layout | Auth required | Sidebar item | Notes |
|---|---|---|---|---|---|
| `/login` | `Admin.jsx` | none | No | — | Public. If already authenticated, no redirect away from `/login` is implemented (a logged-in admin can still navigate here and see the form). |
| `/dashboard` | `Dashboard.jsx` | `AdminLayout` | Yes | Dashboard | Default landing after login. |
| `/traders` | `Traders.jsx` | `AdminLayout` | Yes | Traders | |
| `/merchants` | `Merchants.jsx` | `AdminLayout` | Yes | Merchants | |
| `/orders` | `Orders.jsx` | `AdminLayout` | Yes | Orders (badge) | Badge always 0, see §5. |
| `/payments` | `Payments.jsx` | `AdminLayout` | Yes | Payments | No badge; page is mock-only. |
| `/payouts` | `Payouts.jsx` | `AdminLayout` | Yes | Payouts (badge) | Badge always 0, see §5. |
| `/disputes` | `Disputes.jsx` | `AdminLayout` | Yes | Disputes (badge) | Badge always 0, see §5. |
| `/smartphones` | `Smartphones.jsx` | `AdminLayout` | Yes | Smartphones | Mock-only. |
| `/settlement` | `Settlement.jsx` | `AdminLayout` | Yes | Settlement | Mock-only. |
| `/settings` | `Settings.jsx` | `AdminLayout` | Yes | Settings | Hybrid. |
| `*` (catch-all) | — | — | — | — | `<Navigate to="/dashboard" replace/>` — this fires even for an unauthenticated visitor hitting an unknown URL, who is then bounced by `ProtectedRoute` to `/login`. There is no dedicated 404 page. |

- **No nested/child routes, no query-param-driven routing, no modal routes** (every modal in the app is `useState`-driven, not URL-addressable — deep-linking to "Trader #12, balance modal open" is not possible).
- **Session-expiry behavior:** handled centrally by the axios response interceptor (`api.js:39-53`) — any `401` (except a failed `/auth/login` attempt) clears `localStorage` and hard-navigates (`window.location.href`) to `/login`, which causes a full page reload rather than a client-side route transition. This is simple and reliable but means an admin mid-form-entry loses any unsaved local state on token expiry with no warning dialog.
- **Browser refresh behavior:** `AuthContext`'s rehydration effect re-validates via `/auth/me`; if the API is reachable, this is correct. If not, session falls back to cached `localStorage` (see §3).
- **No orphaned page components:** all 11 files in `pages/` are routed. No route points at a missing component and no sidebar item points at an unregistered path.

---

## 5. Global Admin Layout

Defined in `layouts/AdminLayout.jsx` + `components/Sidebar.jsx`, `HeaderSearch.jsx`, `NotificationBell.jsx`.

- **Sidebar** (`Sidebar.jsx`): fixed width 256px expanded / 72px collapsed, collapse state persisted to `localStorage['sidebar-collapsed']`. 10 nav items with inline SVG icons; three (Orders, Payouts, Disputes) render a `CountBadge` sourced from `AdminLayout.jsx:35` → `counts={{ disputes: counts.disputes, payouts: counts.payouts, orders: counts.orders }}`, imported from `utils/mock.js:123-127`, which hardcodes `{ disputes: 0, payouts: 0, orders: 0 }`. **Nothing in the codebase ever mutates or re-fetches this object** — the badges are permanently invisible (`CountBadge` returns `null` when `value === 0`, `Sidebar.jsx:33`), even when the Orders/Payouts/Disputes pages themselves show a real backlog. This is a fake/dead counter, not merely an unpolished one.
- **Top bar** (`AdminLayout.jsx:39-89`): realtime connection pill (green dot "Realtime connected" / gray "Realtime offline", driven by `useSocket().connected` — genuine, not decorative), a transient "N new paid" pill while the socket session is open, `HeaderSearch`, a static "Administrator" badge (hardcoded label — there being only one role, this is accurate but also unconditional/uninformative), `NotificationBell`, a light/dark theme toggle (persisted to `localStorage['panel-theme']`, genuinely functional), and a user avatar/email/role block sourced from `AuthContext`'s `user`.
- **Content container:** `<main className="tf-scroll flex-1 overflow-y-auto">`, single vertical scroll region; sidebar and header are fixed (`height: 100vh; overflow: hidden` on the shell).
- **No footer** anywhere in the shell.
- **Mobile / responsive behavior:** there is no hamburger menu, no sidebar auto-collapse breakpoint, and no CSS media query that changes the sidebar's rendering below any width — the 256px/72px sidebar is always present. `HeaderSearch`'s dropdown is a fixed 380px width absolutely positioned box that will overflow a narrow viewport. Several page-level grids use Tailwind responsive classes (`sm:grid-cols-2`, `lg:grid-cols-4`) so *cards* reflow, but the *chrome* (sidebar + topbar) does not. This is a genuine mobile gap, not a design choice — see §15.
- **Duplicate/inconsistent controls:** none found — the header's controls are each single-purpose and non-duplicated.
- **Scroll/overflow:** tables in every page use `overflow-x-auto` wrappers; `Traders.jsx`'s row-action dropdown menu is explicitly rendered via a `createPortal` into `document.body` specifically because a normal in-flow dropdown was being clipped by that `overflow-x-auto` wrapper (`Traders.jsx:126-129` — documented in a code comment, i.e., a previously-hit and fixed bug pattern that other pages' menus, e.g. `Merchants.jsx`'s `RowMenu`, do *not* use — so Merchants' dropdown menu risks the same clipping bug the Traders page comment describes, on a narrow/scrolled table).

---

## 6. Current Design System

Defined in `src/index.css` under the `.tf-scope` class, applied via `data-theme="light"|"dark"` on the `AdminLayout` root. **This is the same token system used by the Trader panel** (confirmed by the CSS comment "Same design system as the trader panel — identical tokens, keyframes, scrollbar…").

### Colors (CSS custom properties, light / dark)
| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f4f6f8` | `#0f172a` |
| `--card` / `--sidebar` (light) / `--headbar` (light) | `#ffffff` | `#1e293b` (card) / `#0b1220` (sidebar, headbar) |
| `--cardborder` | `rgba(0,0,0,.04)` | `rgba(255,255,255,.06)` |
| `--text` | `#1e293b` | `#f1f5f9` |
| `--muted` | `#94a3b8` | `#94a3b8` (unchanged) |
| `--hover` | `rgba(0,0,0,.03)` | `rgba(255,255,255,.05)` |
| `--accent` | `#ef4444` (red) | `#ef4444` (unchanged) |
| `--input-bg` / `--input-border` | `rgba(0,0,0,.03)` / `rgba(0,0,0,.08)` | `rgba(255,255,255,.05)` / `rgba(255,255,255,.1)` |
| `--shadow` | `0 2px 12px rgba(0,0,0,.05)` | `0 2px 12px rgba(0,0,0,.3)` |

Semantic status colors are **not** tokenized — they are hardcoded hex/Tailwind utility classes scattered across `ui.jsx` and every page: success `#22c55e`/`emerald`, warning `#f59e0b`/`amber`, error `#ef4444`/`red`, info `#3b82f6`/`sky`, plus `violet #8b5cf6`, `rose #f43f5e`, `teal #14b8c4`, `gray #94a3b8`. `ui.jsx:11-23` (`ACCENT_HEX`) and `:74-77` (`BADGE_HEX`) are two **separate, slightly different** name→hex maps used by `StatCard`/icon accents vs. `Badge` — e.g. `Badge` has no `rose`/`teal` mapping, `StatCard`'s `ACCENT_HEX` has no direct equivalent check for `BADGE_HEX`'s `red`/`green` aliasing. Not a bug today (all current call sites happen to use supported keys) but a latent inconsistency if a new page reuses a color name only defined in one map.

### Typography
- Font: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (`index.css:26`) — no custom webfont.
- No type scale is centrally defined; every heading/label size is set inline per component: page titles `23px/800`, section headers `16px/700`, stat values `26px/800`, table headers `11-12px uppercase/500-600`, body/table cells default to Tailwind's `text-sm` (14px). This works but means changing the type scale later requires touching every page file — there is no `h1`/`h2` style layer.

### Spacing
- Page content padding: `20px 22px` (`AdminLayout.jsx:92`).
- Card padding: inconsistent by convention rather than token — `StatCard` uses `20px 22px`; most `Card`+section combos use Tailwind `p-4`/`p-5`; `Modal` body uses `p-5`.
- Grid gaps: `.tf-grid` (stat card grid) = `18px`; most page-local grids use Tailwind `gap-3`/`gap-4`/`gap-6`.

### Components (as implemented in `ui.jsx`)
- **Buttons** (`Button`): 5 variants (primary/ghost/danger/success/subtle), 2 sizes (sm/md) — no `lg`, no icon-only variant (icon buttons are hand-rolled per use with `tf-hbtn` class in the header, and ad-hoc classes elsewhere, e.g. `Traders.jsx`'s pencil-icon action button uses raw Tailwind, not `Button`).
- **Inputs/Select/SearchInput:** consistent `rounded-xl`, theme-token background/border, single focus-ring treatment. Native `<select>`/`<input type=date>` in `Payments.jsx` are **not** run through the shared `Input`/`Select` primitives — they use a locally-defined `dateInput` Tailwind string, which is hardcoded to dark-mode-only colors (`bg-gray-800`, `text-gray-100`, `[color-scheme:dark]`) — i.e., **this one page's date filters do not respect the light/dark theme toggle** that every other themed element does.
- **Toggle, Tabs, Pagination, Modal, Field, Section, Badge, StatCard, PageHeader, InlineLoader, EmptyRow** — all implemented once in `ui.jsx` and reused consistently; genuinely centralized, no per-page reimplementation found for these.
- **Tables:** no shared `<Table>` component — every page hand-rolls `<table className="w-full text-sm">…` with its own header/row markup. Column styling (padding `px-4 py-3`, header `text-xs uppercase tracking-wide text-gray-500`) is consistent by convention/copy-paste, not by a shared component, so a future global tweak (e.g. row height) requires editing 8 files.
- **Toasts:** 4 semantic types (info/success/error/warning), fixed top-right stack, auto-dismiss 4s, no manual-dismiss control, no stacking/limit cap (could overflow visually under a rapid-fire error loop).
- **Empty/loading/error states:** `InlineLoader` (spinner+label) and `EmptyRow` (centered "No records found" table row) are shared primitives; most pages use them; `Payments.jsx`, `Smartphones.jsx`, `Settlement.jsx` render an inline `No … match your filters` string directly rather than the shared component — no functional difference, just inconsistent reuse.
- **Skeletons:** none exist anywhere — every loading state is either a spinner (`InlineLoader`) in the page header or nothing.

### Shape & elevation
- Card radius `18px` (`.tf-card`), Modal radius `rounded-2xl` (Tailwind, ~16px) — a **visible mismatch**: cards and modals use different radii (18px vs ~16px) despite both being "container" surfaces on the same page.
- Shadows: single `--shadow` token reused for cards, dropdowns, and modals (consistent).
- Icon containers (`StatCard`): 48×48px, `border-radius:14px`.

### Motion
- `StatCard` icon badges float via a `tf-badge`/`@keyframes tf-float` (3s ease-in-out loop, staggered per card via inline `animationDelay`), respects `prefers-reduced-motion` (`index.css:118-120`).
- Dashboard's live-indicator dot uses Tailwind's `animate-ping`.
- Modal/dropdown open/close have **no transition** — they mount/unmount instantly (no fade/scale).
- Table row highlight on a fresh "live feed" row (`Dashboard.jsx:253`) uses `animate-[pulse_1s_ease-in-out_1]` — moot in practice since the feed never populates (see §1, §13).

**Where the design system is inconsistent, summarized:** two divergent color-name maps (`ui.jsx`), one page (`Payments.jsx`) that hardcodes dark-only input styling and breaks theme parity, no shared `<Table>` primitive despite 8 near-identical hand-rolled tables, card vs. modal radius mismatch, and icon buttons implemented three different ways (`tf-hbtn` class, raw Tailwind, and the shared `Button` component) depending on which page you're in.

---

## 7. Page-by-Page Audit

### 7.1 Login (`pages/Admin.jsx`, route `/login`)

**A. Purpose:** authenticate an administrator; the only entry point to the panel.

**B. UI inventory:** logo mark, "Admin Console" heading, subtitle "Restricted access — administrators only", error banner (conditional), email input, password input with Show/Hide toggle, submit button (spinner while `loading`), a static "Demo mode · any email & password signs you in as admin" disclaimer box, footer tagline. No "forgot password" link, no 2FA step, no "remember me".

**C. Data sources:** entirely local component state (`email`, `password`, `showPassword`, `error`, `loading`).

**D. API trace:**
| Action | Handler | Method/Endpoint | Backend | Response used |
|---|---|---|---|---|
| Submit form | `handleSubmit` → `useAuth().login(email,password)` → `authApi.login` (`api.js:59-60`) | `POST /api/auth/login` `{email,password,role:'admin'}` | `authController.login` → `db.User.scope('withSecret').findOne` → bcrypt compare → `authService.issueTokens` (MySQL `users` table) | `{user, accessToken, refreshToken}` persisted to `localStorage`; navigates to `/dashboard` |

**E. Business logic:** role is asserted client-side in the request (`role:'admin'`) and re-checked server-side (`authController.js:56-58`, 403 if mismatched); account `status !== 'active'` is rejected (403); 2FA-enabled accounts return `requires_2fa:true` which this page **does not handle** (see §3).

**F. Functionality status:** **FULLY WIRED** for the plain-credential happy path; **BROKEN** for any account with 2FA enabled; **client-trust weakness** via the mock-login-on-network-error fallback (§3).

**G. UX problems:** the "Demo mode" disclaimer is factually wrong once a real backend is deployed (any-password no longer signs anyone in — only a *network failure* does) and will actively mislead an admin into thinking the login is not real. No visible way to know 2FA exists or is required until it silently fails.

**H. Improvement opportunities:** remove or correct the demo-mode text before production; add a 2FA step; add "forgot password" (no such flow exists anywhere in the backend either — out of scope to build, but worth flagging as a missing workflow, §8).

---

### 7.2 Dashboard (`pages/Dashboard.jsx`, route `/dashboard`)

**A. Purpose:** platform-wide at-a-glance health: volume, active traders/merchants, success rate, revenue, and a live activity pulse.

**B. UI inventory:** 6 `StatCard`s (Today's Volume, Active Traders, Active Merchants, Today's Transactions, Success Rate, Platform Revenue), a 7-day bar chart ("Transaction Volume"), a donut chart ("Success vs Failed"), two "Top by volume" ranked lists (Traders, Merchants), a "Live Transaction Feed" table (Time/Amount/Merchant/Trader/Method/Status). No filters, no date-range picker, no drill-down links from any chart/list item to the underlying entity.

**C. Data sources:**
- 6 `StatCard`s: `useApi(() => adminApi.dashboard())` (real), with a mock-default fallback object (`dashboardStats`, all zeros) merged in via `??` per field (`Dashboard.jsx:139-149`).
- Volume chart, donut chart, Top Traders, Top Merchants: **directly imported mock arrays** (`volume7Days`, `successVsFailed`, `topTraders`, `topMerchants`) — no API call exists for any of these. Since `utils/mock.js` now defines them as empty (`[]`/`{success:0,failed:0}`), these render as empty/zero-state permanently, not as fake-looking numbers.
- "Live Transaction Feed": seeded from `liveFeedSeed` (`[]`) and then a client-side `setInterval` synthesizes fake rows every 3.5s from `merchants[...]`/`traders[...]` mock arrays.

**D. API trace:** single call, `GET /api/admin/dashboard` → `adminController.dashboard` → 8 parallel Sequelize queries (`Trader.count`, `Order.count`×2, `Order.sum`, `Dispute.count`, `settingsService.getNumber`) against MySQL → `{volume_today_inr, active_traders, online_traders, active_merchants, transactions_today, success_rate, open_disputes, platform_revenue_usdt}`. `online_traders` and `open_disputes` are computed server-side but **never rendered** anywhere on the page (dead response fields from the frontend's perspective).

**E. Business logic:** `success_rate` = confirmed-today / orders-today × 100, computed server-side; `volume_today_inr` sums `amount_inr` for `status='success'` orders created since local midnight.

**F. Functionality status:** StatCards = **FULLY WIRED**. Volume chart, donut chart, Top Traders, Top Merchants = **MOCK DATA / effectively empty, no backend call exists**. Live Transaction Feed = **BROKEN** (crashes every tick, see §1).

**G. UX problems:** three of the page's five visual sections are permanently blank with no messaging explaining why ("no data" vs. "not implemented" look identical here — an admin cannot tell whether the platform truly has zero volume or whether the feature is unfinished). The live feed's perpetual background exception is invisible to the user (console-only) but represents real, ongoing wasted work in the browser.

**H. Improvement opportunities:** either wire the three blank sections to real aggregation endpoints or replace them with an explicit "Coming soon" state so they don't read as "the business did zero volume this week." Remove or fix the live-feed simulator regardless of data source — an admin console must not carry a permanently-throwing timer.

---

### 7.3 Traders (`pages/Traders.jsx`, route `/traders`) — the most complete page

**A. Purpose:** onboard and manage the traders who service incoming UPI payments — their credentials, commercial terms (margins), balance, and online/suspended state.

**B. UI inventory:** page header with trader count and "Add Trader" button; filter bar (search, status select, online/offline select); 10-column table (ID, Trader, Balance USDT, Commission, Types [FTD/STD badges], Today Volume, Success, Status, Presence [online toggle pill], Actions); pagination (12/page); per-row action menu (Edit Balance, Edit Commercial, Edit Details, View Details, Suspend/Activate) rendered via `createPortal`; 5 modals — **Trader detail** (read-only profile + earnings breakdown + bank accounts + smartphones + recent transactions), **Balance adjustment** (add/deduct + note), **Edit trader** (commission_rate, payout_commission, rate_label, daily_limit, status, deposit types), **Edit Commercial** (trader/admin margin with a live math preview — see below), **Add Trader** (full onboarding form with password auto-generate), and a one-time **"credentials created"** modal with copy-to-clipboard.

**C. Data sources:** `useApi(() => adminApi.listTraders())`, mapped through `mapTrader()` (`Traders.jsx:40-66`) which normalizes backend `Trader`+`User` fields (derives a display `name` from the email local-part since no real name field exists — see §13) into the table/modal shape. `seedTraders` (mock, empty) is only the *pre-fetch* placeholder.

**D. API trace:**
| Action | Frontend call | Endpoint | Backend | DB effect |
|---|---|---|---|---|
| Load list | `adminApi.listTraders()` | `GET /admin/traders?page&limit` | `adminController.listTraders` | `Trader.findAndCountAll` + `User` join (paginated, server-side) |
| Create trader | `adminApi.createTraderFull(payload)` | `POST /admin/traders/create` | `adminController.createTraderFull` (Joi-validated) | Transaction: `User.create` (bcrypt hash) + `Trader.create`; `BalanceLog.create` if opening balance > 0; `emitToAdmin('trader:created')` |
| Adjust balance | `adminApi.updateTraderBalance(id,{action,amount_usdt,note})` | `PUT /admin/traders/:id/balance` | `adminController.updateTraderBalance` → `balanceService.adminAdjust` | Transaction: trader `balance_usdt` mutated, `BalanceLog` row written; `emitToTrader`+`emitToAdmin` |
| Edit commercial | `adminApi.updateTraderCommission(id,{...})` | `PUT /admin/traders/:id/commission` | `adminController.updateTraderCommission` | `Trader.update({trader_margin, admin_margin, commission_rate, payout_commission})`; server **re-validates** `trader_margin < admin_margin` (422 if violated) — a genuine defense-in-depth check, not just a UI guard |
| Edit details | `adminApi.updateTrader(id,{...})` | `PUT /admin/traders/:id` | `adminController.updateTrader` | Whitelisted-field `Trader.update` + optional `User.update({status})` |
| Toggle online (demo) | `adminApi.setTraderOnline(id,bool)` | `PUT /admin/traders/:id/online-status` | `adminController.updateTraderOnlineStatus` | `Trader.update({is_online, last_heartbeat})`; `emitToTrader`+`emitToAdmin` |
| Suspend/Activate | `adminApi.suspendTrader(id,bool)` | `PUT /admin/traders/:id/suspend` | `adminController.updateTraderSuspend` | `User.update({status})`; if suspending, also forces `Trader.update({is_online:false})` — genuine business rule enforced server-side |

**E. Business logic:** the "Edit Commercial" modal implements a real live-math preview (`Traders.jsx:476-490`) mirroring the backend's rate-margin model (`balanceService.js` comment block) — trader rate/admin rate/deduction/merchant-settlement/platform-profit per ₹100 — and **client-side enforces `traderMargin < adminMargin`** before enabling Save; the **backend independently re-enforces the same rule**, so this is correctly defense-in-depth, not merely trusted client validation.

**F. Functionality status:** **FULLY WIRED** end-to-end for every primary action. Two cosmetic gaps: the Trader detail modal's footer has a **"Reset password" button with no `onClick` handler at all** (`Traders.jsx:214`) and an **"Add balance" button with no `onClick` handler** (`Traders.jsx:215`) — both are **DEAD BUTTONS**, clicking them does nothing. (The separate, properly-wired "Edit Balance" row-menu action is the real path to adjust balance — these two are leftover/incomplete affordances in the detail modal.)

**G. UX problems:** the Trader detail modal shows Bank Accounts, Smartphones, Phone, Joined date, and Recent Transactions sections that are **always empty** because `mapTrader()` hardcodes `bankAccounts:[]`, `smartphones:[]`, `phone:'+91 —'`, `joinedAt:'—'` (`Traders.jsx:61-63`) — the backend `Trader` model has no such fields/associations wired into this endpoint's response shape, so these sections are permanently blank scaffolding, not intermittently-empty real data. An admin has no way to actually see a trader's bank accounts or devices from this panel despite the UI implying it's one click away.

**H. Improvement opportunities:** wire the detail modal's bank-accounts/smartphones/phone/joined-date to real associated data (the `Smartphone` model already exists and belongs to `Trader` — see §12), or remove those sections until backed. Fix or remove the two dead footer buttons.

---

### 7.4 Merchants (`pages/Merchants.jsx`, route `/merchants`)

**A. Purpose:** onboard merchant API clients, manage their fee structure and API credentials.

**B. UI inventory:** header + "Add Merchant"; filters (search, status); 8-column table (ID, Business, API Key [masked], Balance USDT, PayIn %, Payout %, Status, Actions); pagination (10/page); per-row "Edit Fees" quick button + `⋮` dropdown (View details / Edit / Deactivate-Activate / Regenerate API key / Set commission); Merchant detail modal (business info, masked API key+secret with reveal/copy, webhook URL, recent transactions); Edit Fees modal; Add Merchant modal; one-time credentials modal.

**C. Data sources:** `useApi(() => adminApi.listMerchants())` → `mapMerchant()` (`Merchants.jsx:18-35`).

**D. API trace:**
| Action | Frontend call | Endpoint | Backend | DB effect |
|---|---|---|---|---|
| Load list | `adminApi.listMerchants()` | `GET /admin/merchants` | `adminController.listMerchants` | `Merchant.findAndCountAll` + `User` join |
| Create merchant | `adminApi.createMerchantFull(payload)` | `POST /admin/merchants/create` | `adminController.createMerchantFull` | Transaction: `User.create` + `Merchant.create` with generated `api_key`/`api_secret`; `emitToAdmin` |
| Edit fees | `adminApi.updateMerchantFees(id,{payin_fee_percent,payout_fee_percent})` | `PUT /admin/merchants/:id/fees` | `adminController.updateMerchantFees` | `Merchant.update`; `emitToMerchant('fees:updated')` |

**F. Functionality status — the row menu is mostly decorative:**
- **Edit Fees** (dedicated button) — **FULLY WIRED**.
- **View details** — real (opens the modal with live-mapped data).
- **"Edit"** row-menu item — `fn: () => {}` (`Merchants.jsx:78`), a literal no-op. **DEAD BUTTON.**
- **"Activate"/"Deactivate"** — `toggleStatus()` (`Merchants.jsx:232-233`) only flips local React state (`setList`). **No API call.** The backend *does* support this (`adminController.updateMerchant` accepts `is_active`), but this button never calls it — a refresh (or any refetch) silently reverts the merchant to its real, unchanged status, likely surprising an admin who believed they'd deactivated a merchant.
- **"Regenerate API key"** — `regen()` (`Merchants.jsx:235-236`) generates a **fake client-side string** (`pk_live_${...}regenkey...`) and only updates local state. **No backend endpoint for API-key rotation exists at all** (`adminController` only ever generates keys at creation time). This is the highest-risk fake action in the panel: if an admin uses this believing they've rotated a compromised merchant key, **the real, still-valid key is untouched server-side** while the UI displays a new key that will never authenticate anything.
- **"Set commission"** row-menu item — `fn: () => {}`, **DEAD BUTTON**, and the Merchant detail modal's footer "Set commission" button also has **no `onClick`** — same dead affordance in two places.

**G. UX problems:** three of five row-menu actions (Edit, Activate/Deactivate, Regenerate key, Set commission — four of five) are either no-ops or fake, against one that works (View details) and one separate always-visible working button (Edit Fees). An admin cannot distinguish real from fake actions from the UI alone.

**H. Improvement opportunities:** this is the single highest-priority page to either finish or visibly gate ("Coming soon") before shipping — the Regenerate-API-key action in particular should be disabled or removed until backed, since its current behavior is actively misleading in a way that could cause a real security incident (false belief that a leaked key was rotated).

---

### 7.5 Orders (`pages/Orders.jsx`, route `/orders`) — second most complete page

**A. Purpose:** review and settle the v2 order lifecycle (`pending → checkout_open → claimed_paid → under_review → success/failed/rejected/disputed`); the core money-movement decision surface.

**B. UI inventory:** search bar; status tabs (All + 8 statuses, each with a live count); 9-column table (Gateway ID, Merchant, Customer, Amount [INR+USDT], Type [FTD/STD badge], Trader, Created, Status, Actions); inline per-row action buttons (Review/Confirm/Reject/Dispute, shown only for actionable statuses); pagination (15/page); Order detail modal with full field grid, a same-amount-lock explainer, an order timeline, a "Payment Detection" section (confidence score + engine badges — always empty, no engines are ever populated, see §13), a raw-SMS block (conditional, never populated), and a manual-override control (status select + Apply, distinct from the row actions).

**C. Data sources:** `useApi(() => adminApi.listOrders())` → `mapOrder()` (`Orders.jsx:13-41`); **live-updates via the socket bridge** — a `window.addEventListener('order:update', refetch)` (`Orders.jsx:223-227`) means any `order:paid/confirmed/cancelled/disputed` event relayed by `useSocket()` triggers a full list refetch, so this page genuinely reflects real-time backend state without a manual reload.

**D. API trace:**
| Action | Frontend call | Endpoint | Backend | Notes |
|---|---|---|---|---|
| Load | `adminApi.listOrders()` | `GET /admin/orders?status` | `adminController.listOrders` | Paginated, `Merchant`+`Trader` joins |
| Review | `adminApi.reviewOrder(id)` | `PUT /admin/orders/:id/review` | `claimed_paid → under_review` only; 400 otherwise | |
| Confirm | `adminApi.confirmOrderV2(id)` | `PUT /admin/orders/:id/confirm` | Creates an audit `Transaction` row (`engine_used:'manual'`), then calls `smartMerge.confirmOrder` → the **same settlement path** used by automated confirmation (`balanceService.settleOrder`): trader USDT debited, merchant USDT credited, `platform_revenue_usdt` setting incremented | Real money movement, transactional |
| Reject | `adminApi.rejectOrderV2(id,reason)` | `PUT /admin/orders/:id/reject` | Sets `rejected`, releases the trader via `routingEngine.releaseTrader` so they can receive new orders again | |
| Dispute | `adminApi.disputeOrderV2(id,reason)` | `PUT /admin/orders/:id/dispute` | Sets `disputed`, creates a `Dispute` row (feeds the Disputes page) | |
| Manual override (modal) | `orderApi.overrideOrder`/`disputeOrder` → `adminApi.updateOrder` or `POST /orders/:id/dispute` | `PUT /admin/orders/:id` or `POST /api/orders/:id/dispute` | Legacy generic-status endpoint; maps `success/rejected/failed/cancelled` onto the same settlement/release logic for backward compatibility | |

**E. Business logic:** `REVIEWABLE_STATUSES = ['claimed_paid','under_review']` gates which orders can be confirmed/rejected/disputed, enforced **both** client-side (`canReview`/`canSettle` in `Orders.jsx:91-92`, which hide buttons) **and** server-side (`adminController` returns 400 outside those statuses) — correct defense-in-depth.

**F. Functionality status:** **FULLY WIRED.** This is the panel's best-engineered workflow — every visible action maps to a real, correctly-guarded, transactional backend operation, and the page self-updates via sockets.

**G. UX problems:** "Payment Detection" (confidence score, engine badges) and "Raw SMS / Notification Data" sections are permanently empty because `mapOrder()` hardcodes `confidence: null, engines: [], rawSms: null` (`Orders.jsx:35-37`) — no backend field is ever mapped into them, so (like the Trader detail modal) this reads as a promised-but-unbuilt investigative view. The order Timeline only ever shows a single synthetic "Order created" entry (`Orders.jsx:39`) — status transitions (claimed→reviewed→confirmed) are not appended to it even though the backend records `reviewed_at`/`reviewed_by`/`confirmed_at`/`rejected_at` timestamps that could populate a real timeline.

**H. Improvement opportunities:** build the timeline from the real timestamp fields already returned by the API (`reviewed_at`, `confirmed_at`, `rejected_at`, `claimed_paid_at`) instead of a single hardcoded entry — this is a case where the backend already has the data and only the frontend mapping is missing.

---

### 7.6 Payments / Transactions (`pages/Payments.jsx`, route `/payments`) — entirely disconnected

**A. Purpose (as designed):** a cross-trader notification/detection log — every SMS/notification/screen-scrape/manual payment-match event, for investigation and CSV export.

**B. UI inventory:** filter bar (Trader select, Merchant select, Method select, Engine select, Amount search, date-from, date-to), "Export CSV" button, 9-column table (Notification ID, Time, Trader, Merchant, Amount, Method, Captured By [engine], Transaction ID, Status), pagination (15/page).

**C. Data sources:** **100% mock.** `import { payments, traders, merchants, ACCOUNT_TYPES, ENGINES, inr, maskUpi } from '../utils/mock'` (`Payments.jsx:4`) — **there is no `adminApi` import anywhere in this file.** All four filter dropdowns derive their option lists from mock arrays that are now empty, so in practice only "All …" options render; the table has no rows to show, ever.

**D. API trace:** **none exists.** No fetch, no `useApi`, no `adminApi.*` call of any kind.

**E. Business logic:** the CSV export (`toCsv`/`exportCsv`, `Payments.jsx:16-23,55-63`) is real, functioning client-side CSV-generation logic — it would work correctly if given real data, it simply has none to work with.

**F. Functionality status:** **MOCK DATA (effectively DEAD — zero backend wiring).** Note this is different from "backend endpoint missing": the backend *does* have a related capability — `POST /api/payment/manual` (`paymentRoutes.js`, `checkRole('trader','admin')`, `paymentController.manual`) lets an admin manually record a payment match — but this page never calls it, and there is no `adminApi` wrapper for it in `services/api.js` at all. Also relevant: `NotificationLog` is a real Sequelize model (`models/notificationLog.model.js`) associated to `Trader` — a real notification-log table exists in the schema and is simply never queried by any admin route.

**G. UX problems:** this page will present as "we have had zero payment notifications ever," which is indistinguishable from "this feature isn't built," to anyone without codebase access.

**H. Improvement opportunities:** either add a `GET /admin/notification-logs`-style endpoint reading `db.NotificationLog` and wire this page to it, or explicitly mark the page "Coming soon" so it doesn't misrepresent platform activity.

---

### 7.7 Payouts (`pages/Payouts.jsx`, route `/payouts`)

**A. Purpose:** moderate the merchant "Buy USDT" payout-request queue — approve/settle, reject, and resolve disputes.

**B. UI inventory:** 6 status tabs with live counts (Awaiting Processing, In Processing, Awaiting Settlement, Settlement Completed, Canceled, Dispute); table columns vary by tab (ID, Merchant, Trader, Amount, [Rate/Trader-credit columns shown only on rate-relevant tabs], [Reason column only on Dispute tab], Updated, Action); per-tab action buttons (Approve & settle / Reject on Awaiting Settlement; Reject on Awaiting Processing; Settle / Void on Dispute; a read-only status badge elsewhere).

**C. Data sources:** entirely real — `adminApi.listPayoutRequests({status})` on tab change, plus a `window.addEventListener('order:update', ...)` socket-bridge refresh (reused from the same channel Orders uses, despite the event name implying orders — a naming leak, see §11).

**D. API trace:**
| Action | Frontend call | Endpoint | Backend service call | Effect |
|---|---|---|---|---|
| Load tab | `adminApi.listPayoutRequests({status})` | `GET /admin/payout-requests?status=` | `payoutService.listForAdmin` + `adminCounts` | Real paginated-by-status query, `Merchant`+`assignedTrader` joins |
| Approve & settle | `adminApi.approvePayoutRequest(id)` | `POST /admin/payout-requests/:id/approve` | `payoutService.approve` → `settleAndCredit` (row-locked transaction) | Trader **credited** USDT at the frozen rate snapshot; guards against double-settlement | 
| Reject | `adminApi.rejectPayoutRequest(id,reason)` | `POST /admin/payout-requests/:id/reject` | `payoutService.reject` | From `awaiting_processing` → `canceled`; from `awaiting_settlement` → `dispute` (cannot be silently voided once a trader has transferred funds — real business-safety rule) |
| Dispute settle/void | `adminApi.resolvePayoutDispute(id,{action})` | `POST /admin/payout-requests/:id/dispute-resolve` | `payoutService.disputeResolve` | `settle` → same credited settlement path; `void` → cancels without crediting |

**F. Functionality status:** **FULLY WIRED**, transactionally sound (row locking prevents double-settlement), correctly guards the "trader has already sent money, can't just cancel" edge case. This is the panel's second cleanest page after Orders.

**G. UX problems:** none structural; minor — the merchant-supplied sensitive recipient fields (`account_number`, `upi_id`, `ifsc_code`, `recipient_name`, `bank_name`) are stripped from the trader's *pooled* (unassigned) view server-side (`payoutService.sanitizePool`) but this admin page receives the **unsanitized** admin listing and doesn't visually distinguish "sensitive financial recipient data" from ordinary fields — not a bug, but worth a design pass given it's real bank/UPI recipient PII on-screen.

---

### 7.8 Disputes (`pages/Disputes.jsx`, route `/disputes`)

**A. Purpose:** review and resolve disputes raised against orders.

**B. UI inventory:** status tabs (All/Open/Reviewing/Resolved) with counts; 8-column table (Dispute ID, Order ID, Raised By, Reason, Amount, Created, Status, Action); Dispute detail modal (status/raised-by/created/reason/amount/order fields, an "Evidence/Screenshots" gallery, a resolution-notes textarea, Mark-reviewing / Resolve buttons).

**C. Data sources:** `useApi(() => adminApi.listDisputes())` → `mapDispute()`.

**D. API trace:**
| Action | Frontend call | Endpoint | Backend | Effect |
|---|---|---|---|---|
| Load | `adminApi.listDisputes()` | `GET /admin/disputes?status` | `adminController.listDisputes` | `Dispute.findAll` + `Order` join |
| Resolve | `adminApi.resolveDispute(id,{resolution})` | `PUT /admin/disputes/:id/resolve` | `adminController.resolveDispute` | `Dispute.update({status:'resolved', resolution})`; optionally sets the underlying order's status if `order_status` were sent (frontend never sends it — dead optional param) |
| Mark reviewing | `review(id)` local function (`Disputes.jsx:124`) | **none** | **none** | `setList` local-state-only mutation |

**E. Business logic:** `raisedBy`/`raisedByRole` are always rendered as the hardcoded literals `'—'`/`'merchant'` (`mapDispute`, `Disputes.jsx:19-20`) — the backend *does* store `raised_by` (a `User` FK) but the admin listing query never includes/joins that user, so the frontend has nothing real to map. "Evidence/Screenshots" always renders zero items (`evidence: 0` hardcoded, `Disputes.jsx:25` — the `Dispute` model has an `evidence_url` column that is simply never surfaced here).

**F. Functionality status:** **Resolve = FULLY WIRED. "Mark reviewing" = local-state-only, no backend call, no `open→reviewing` endpoint exists at all** — refreshing the page (or any refetch) silently reverts a dispute an admin believed they'd moved into "Reviewing" back to "Open." **PARTIALLY WIRED** overall.

**G. UX problems:** "Raised By" column/field is permanently the literal string "—" for every dispute — misleading in a way that looks like a data-loading bug rather than an intentional gap.

---

### 7.9 Smartphones (`pages/Smartphones.jsx`, route `/smartphones`) — entirely disconnected

**A. Purpose (as designed):** monitor and force-disconnect the trader-owned Android devices that capture UPI payment notifications.

**B. UI inventory:** status filter (All/Online/Offline), device-name search, connection-type search, 7-column table (Device, Owner [Trader], Connection, Banks, Last Ping, Status, Actions), per-row "Disconnect" button (disabled when already offline), device detail modal (status, last ping, connection type, bank-account count, owner, registered date, an "Activity Log" list) with a "Force disconnect" footer button.

**C. Data sources:** **100% mock** — `import { smartphones as seedPhones } from '../utils/mock'` (`Smartphones.jsx:4`). **No `adminApi` import in this file at all.**

**D. API trace:** **none.** The backend has both `GET /admin/smartphones` (`adminController.listSmartphones` — real `Smartphone.findAll` with `Trader`+`User` joins) and `PUT /admin/smartphones/:id/disconnect` (`adminController.disconnectSmartphone` — sets `is_online:false`, emits `device:disconnected` to the trader and admin rooms) fully implemented and ready to call. **Neither is ever invoked by this page.**

**F. Functionality status:** **BACKEND EXISTS BUT UI DOES NOT USE IT.** The "Disconnect" button (`disconnect()`, `Smartphones.jsx:61`) only sets `{online:false, lastPing:'just now'}` in local React state — it does not call the backend, does not actually disconnect anything, and will silently revert on any refresh/refetch. **DEAD BUTTON** masquerading as a real device-control action.

**G. UX problems:** this is a security-adjacent false affordance — an admin who clicks "Force disconnect" believing they've cut off a compromised/rogue device has done nothing; the device (and whatever it's capturing) remains live.

**H. Improvement opportunities:** highest-priority wiring gap in the panel from a risk perspective — trivial to fix (both endpoints already exist and match the page's exact needs), and the current state is actively dangerous if relied upon during an incident.

---

### 7.10 Settlement (`pages/Settlement.jsx`, route `/settlement`) — entirely disconnected

**A. Purpose (as designed):** view daily settlement totals per trader/merchant and trigger a manual settlement run.

**B. UI inventory:** 4 summary `StatCard`s (Total Received Today, Platform Fees, Trader Commissions, Pending Settlements), "Trigger manual settlement" button, 3 tabs (Per Trader / Per Merchant / History) each with its own table.

**C. Data sources:** **100% mock** — `settlementTraders`, `settlementMerchants`, `settlementHistory` from `utils/mock.js`, all empty arrays. **No `adminApi` import in this file at all.**

**D. API trace:** **none.** The backend has `GET /admin/settlements` (`adminController.listSettlements` — real `Settlement.findAll` with `Trader`+`Merchant` joins, capped at 200 rows) and `POST /admin/settlements/trigger` (`adminController.triggerSettlement` → `jobs/settlementJob.runSettlement()`, which genuinely groups today's `success` orders by trader/merchant, computes fees, writes `Settlement` rows, and credits balances). **Neither is called.** "Trigger manual settlement" (`runSettlement()`, `Settlement.jsx:25-31`) is a **pure `setTimeout` fake**: sets `running=true`, waits 1200ms, sets `running=false` and stamps `lastRun` with the current time — no network request of any kind.

**E. Business logic note (backend-only, still worth flagging):** `jobs/settlementJob.js` uses **`config.platform.exchangeRate`** (a static env-configured rate, default `89.0`) and static `feePercent`/`traderCommissionPercent` env values to compute settlement — this is a **different, legacy calculation model** from the per-order rate-margin settlement (`balanceService.settleOrder`, using the dynamic `base_exchange_rate`/`trader_margin`/`admin_margin` settings) that actually runs on every order confirmation via the Orders page. If this endpoint were ever wired up and triggered, it would **double-count and re-settle already-settled orders under an inconsistent rate model** — this is latent technical debt independent of the frontend gap, flagged again in §14.

**F. Functionality status:** **BACKEND EXISTS BUT UI DOES NOT USE IT**, and even if wired naively, the backend's own settlement-trigger logic is inconsistent with the real settlement path already running automatically. "Trigger manual settlement" is a **fake/theatrical button** — it produces a convincing loading-spinner-then-success UX with zero effect.

**G. UX problems:** an admin clicking "Trigger manual settlement" gets full loading-state feedback and a "Last run HH:MM:SS" confirmation — the strongest false-success signal found anywhere in the panel, because unlike the Merchants "Activate" button (which at least shows correct-looking data that then reverts), this one performs a visible multi-second "action" with a definitive completion timestamp for something that never happened.

---

### 7.11 Settings (`pages/Settings.jsx`, route `/settings`) — hybrid

**A. Purpose:** platform-wide configuration — economics, order lifecycle, integrations, and access control.

**B. UI inventory:** maintenance-mode banner (conditional); **Rate & Revenue** card (base exchange rate, admin default margin, trader default margin, read-only accumulated platform revenue, "Save rates" button); then a 2-column grid of `Section`s: **Fees & Commissions** (platform fee %, default trader commission %), **Orders & Exchange Rate** (order expiry minutes, exchange-rate source select), **Telegram Bots** (PayIn bot token, Notification bot token), **Notifications & Mode** (email-alerts toggle, maintenance-mode toggle), **IP Whitelist** (add/remove IP chips); a single page-level "Save changes" button in the header.

**C. Data sources:** Rate & Revenue section: `adminApi.getSettings()` on mount (real). Every other field (`fee`, `commission`, `expiry`, `rateSource`, `maintenance`, `emailAlerts`, `telegram`, `ips`) is initialized to a **hardcoded literal** and never fetched from anywhere (`Settings.jsx:14-23`) — including `ips = ['203.0.113.7', '198.51.100.24']`, which are **RFC 5737 TEST-NET-3 documentation-range addresses** presented as if they were real whitelisted IPs.

**D. API trace:**
| Action | Frontend call | Endpoint | Backend | Real? |
|---|---|---|---|---|
| Load Rate & Revenue | `adminApi.getSettings()` | `GET /admin/settings` | `settingsService.getAll()` (MySQL `settings` k/v table + Redis cache) | Yes |
| Save Rate & Revenue | `adminApi.updateSettings({base_exchange_rate, admin_default_margin, trader_default_margin})` | `PUT /admin/settings` | `settingsService.set()` per allowed key | Yes |
| "Save changes" (page header, everything else) | `save()` — `setSaved(true); setTimeout(...,2000)` | **none** | **none** | **No — pure local UI theater** |

**E. Business logic — a specific, checkable gap:** the backend's `updateSettings` allow-list (`adminController.js:461-467`) includes `order_expiry_minutes`, `min_order_amount`, `max_order_amount`, and `platform_name` as legitimately settable keys — **the frontend has UI for `order_expiry_minutes` (the "Order expiry time (minutes)" field) but never sends it**, because that field lives in the fake "Orders & Exchange Rate" section wired to the do-nothing `save()` handler rather than `saveRates()`. This is a case where the backend is ready for a field the frontend visually offers but structurally never transmits.

**F. Functionality status:** Rate & Revenue = **FULLY WIRED**. Fees & Commissions, Orders & Exchange Rate, Telegram Bots, Notifications & Mode, IP Whitelist = **entirely local state, HARD-CODED initial values, no load, no save — UI-ONLY.**

**G. UX problems:** two "Save" buttons exist on one page (header "Save changes" and the Rate & Revenue card's own "Save rates") with **no visual distinction in weight/placement** suggesting one is real and the other is decorative — a genuinely reasonable admin would assume the prominent header button saves the whole page. The maintenance-mode toggle, if an admin believed it worked, would create a serious false sense of control (they'd think they can take the gateway offline and cannot).

**H. Improvement opportunities:** this page most urgently needs either full backend wiring (a `system_settings`-style table for fee/expiry/telegram/maintenance/IP-whitelist) or explicit "Coming soon" labeling — the current combination of a fully-functional-looking form with a definitive Save button and zero persistence is the single most consequential trust gap in the panel, because Settings is exactly the surface where an admin is least likely to double check that a change "took."

---

## 8. Complete Admin User Flows

### Authentication
```
Admin visits any URL
  → ProtectedRoute checks isAuthenticated
     → false → redirect to /login
        → submit email+password
           → POST /auth/login {role:'admin'}
              → 200 + tokens           → persist localStorage → navigate /dashboard
              → 401 invalid creds      → inline error shown, stays on /login
              → 403 wrong role/status  → inline error shown
              → requires_2fa:true      → BROKEN: no 2FA UI exists; login "succeeds" then
                                          silently bounces back to /login (see §3)
              → network error (no response) → MOCK admin session created locally,
                                                 navigate /dashboard (see §3)
     → true → render AdminLayout + routed page
Token expiry (401 on any subsequent call, except /auth/login itself)
  → localStorage cleared → window.location.href = '/login' (full reload)
Logout (sidebar button)
  → POST /auth/logout (best-effort; failure ignored) → localStorage cleared → in-memory user cleared
```

### Trader management
```
Traders page loads → GET /admin/traders → table renders
Admin clicks "Add Trader" → fills form (or auto-generates password)
  → POST /admin/traders/create → 201 → credentials modal shown ONCE (copy buttons)
  → list refetched
Admin clicks row → Trader detail modal (read-only; bank accounts/devices/phone always empty — §7.3)
Admin uses row menu:
  Edit Balance → modal → PUT /admin/traders/:id/balance → toast → list refetched
  Edit Commercial → modal (live margin preview, client+server validated) → PUT .../commission → toast
  Edit Details → modal → PUT /admin/traders/:id → toast
  Suspend/Activate → PUT /admin/traders/:id/suspend → toast (optimistic UI, reverted on error)
Presence pill (Online/Offline) → PUT /admin/traders/:id/online-status (demo helper) → toast
```

### Merchant management
```
Merchants page loads → GET /admin/merchants → table renders
Admin clicks "Add Merchant" → POST /admin/merchants/create → 201 → API key/secret shown ONCE
Admin clicks "Edit Fees" → PUT /admin/merchants/:id/fees → toast
Admin opens row menu:
  View details → real (masked API key/secret, reveal+copy)
  Edit                 → NO-OP (dead)
  Activate/Deactivate  → LOCAL STATE ONLY, reverts on refresh (not real)
  Regenerate API key   → LOCAL FAKE KEY, no backend rotation occurs (not real, risky)
  Set commission       → NO-OP (dead)
```

### Order operations (v2 lifecycle)
```
pending → checkout_open → claimed_paid → [admin: Review] → under_review
                                        → [admin: Confirm] ─────────────┐
                              under_review → [admin: Confirm] ──────────┤
                                                                        ▼
                                                          smartMerge.confirmOrder
                                                                        ▼
                                                     balanceService.settleOrder (TXN)
                                                     trader.balance_usdt -= deduction
                                                     merchant.balance_usdt += settlement
                                                     settings.platform_revenue_usdt += profit
                                                                        ▼
                                                              status = 'success'
claimed_paid/under_review → [admin: Reject] → status='rejected', trader released
claimed_paid/under_review → [admin: Dispute] → status='disputed', Dispute row created
                                                     → feeds Disputes page
Any of the above → emitToAdmin/emitToMerchant/emitToTrader/emitToOrder (socket)
                 → Admin's useSocket() re-broadcasts window 'order:update'
                 → Orders.jsx + Payouts.jsx (shared listener) + NotificationBell all refetch
```

### Payout-request operations
```
(merchant creates request, out of Admin's flow) → awaiting_processing (global pool)
  → (trader accepts) → in_processing
     → (trader marks transferred) → awaiting_settlement
        → [admin: Approve & settle] → settleAndCredit (TXN, row-locked)
                                     → trader.balance_usdt += trader_credit_usdt
                                     → status = settlement_completed
        → [admin: Reject] → status = dispute (cannot silently cancel a transferred payout)
     → (trader hits a problem) → dispute
        → [admin: Settle] → settleAndCredit → settlement_completed
        → [admin: Void]   → status = canceled (no credit)
  awaiting_processing → [admin: Reject] → canceled
  in_processing (timer elapsed, background job) → dispute automatically
```

### Disputes
```
Order disputed (by admin action above, or by trader/merchant via POST /orders/:id/dispute)
  → Dispute row created, status='open'
Disputes page loads → GET /admin/disputes
Admin opens dispute → detail modal
  "Mark reviewing" → LOCAL STATE ONLY (not persisted)
  "Resolve dispute" (with notes) → PUT /admin/disputes/:id/resolve → status='resolved'
```

### Smartphones — NOT genuinely connected
```
Smartphones page loads → renders empty mock array (no API call)
Admin clicks "Disconnect" → LOCAL STATE ONLY → device remains connected server-side
```

### Settlement — NOT genuinely connected
```
Settlement page loads → renders empty mock arrays (no API call)
Admin clicks "Trigger manual settlement" → setTimeout(1200ms) → fake "Last run" timestamp
  → no backend call, no Settlement rows created, no balances touched
```

### Settings
```
Settings page loads → GET /admin/settings → Rate & Revenue fields populated; everything else
                                              initialized to hardcoded literals
Admin edits Rate & Revenue → "Save rates" → PUT /admin/settings → toast → persisted
Admin edits any other field → header "Save changes" → 2s fake "✓ Saved" flash → NOT persisted
```

---

## 9. Table Audit

| Page | Purpose | Columns | Data source | Server-side sort | Server-side search | Client filter | Pagination | Row select | Sticky header | Export | Real/Mock |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Traders | trader roster | 10 | `adminApi.listTraders` | No (fixed `id ASC`) | No | Yes (client) | Client-side over full fetched set (`limit` default 25 unless requested higher) | No | No | No | **Real** |
| Merchants | merchant roster | 8 | `adminApi.listMerchants` | No (fixed `id ASC`) | No | Yes (client) | Client-side | No | No | No | **Real** |
| Orders | order queue | 9 | `adminApi.listOrders` | No (fixed `created_at DESC`) | No | Yes (client, over current page only — see §16) | Client-side | No | No | No | **Real** |
| Payments | notification log | 9 | mock (empty) | — | — | Yes (client, over nothing) | Client-side | No | No | **Yes (CSV, functional logic, no data)** | **Mock/dead** |
| Payouts | payout-request queue | up to 9 (tab-dependent) | `adminApi.listPayoutRequests` | No (fixed `created_at DESC`) | No | No (server filters by tab status) | **None** (all rows for the tab render at once) | No | No | No | **Real** |
| Disputes | dispute queue | 8 | `adminApi.listDisputes` | No (fixed `created_at DESC`) | No | Tab-only (client) | **None** | No | No | No | **Real** |
| Smartphones | device roster | 7 | mock (empty) | — | — | Yes (client, over nothing) | **None** | No | No | No | **Mock/dead** |
| Settlement (3 tabs) | settlement views | 6/5/7 | mock (empty) | — | — | No | **None** | No | No | No | **Mock/dead** |
| Dashboard live feed | activity pulse | 6 | broken client simulator | — | — | No | Capped at last 20 (client `.slice`) | No | Yes (`sticky top-0`) | No | **Broken** |

**Notable duplication/merge candidates for a future redesign:** Traders and Merchants tables both carry an "ID / entity name+email" combined first two columns and a similarly-structured status badge column — a shared `<EntityTable>` primitive would remove ~150 lines of duplicated markup. Orders' "Amount" column already merges INR+USDT into one cell (`Orders.jsx:334-336`) — a good precedent the other money-columns (Traders' Balance/Today-Volume, Merchants' Balance) don't follow. None of the 9 tables implement server-side sort or true server-side search (Orders/Traders/Merchants search only what's already been fetched into memory) — a real scalability gap, see §16.

---

## 10. Modal and Form Audit

| Modal/Form | Trigger | Fields | Validation | API call | Success behavior | Failure behavior | Duplicate-submit guard |
|---|---|---|---|---|---|---|---|
| **Add Trader** | Traders → "Add Trader" | full_name, email, password (+auto-gen), commission_rate, payout_commission, initial_balance_usdt, daily_limit, telegram_chat_id, deposit_types (≥1 required, client-enforced) | Client: email/password required. Server: Joi schema (`createTraderFullSchema`), email uniqueness (409 if taken) | `POST /admin/traders/create` | Toast, one-time credentials modal, list refetch, form reset | Toast with server message | `saving` flag disables the button |
| **Edit Trader** | Traders row menu → Edit Details | commission_rate, payout_commission, rate_label, daily_limit, status, deposit_types | Server: whitelist patch only | `PUT /admin/traders/:id` | Toast, refetch | Toast | `saving` flag |
| **Adjust Balance** | Traders row menu | action (add/deduct), amount_usdt (>0, client-checked), note | Client: positive-amount check. Server: Joi + insufficient-balance 422 on deduct | `PUT /admin/traders/:id/balance` | Toast, refetch | Toast | `saving` flag |
| **Edit Commercial** | Traders row menu | trader_margin, admin_margin, payout_commission | Client: `trader_margin < admin_margin` (Save disabled otherwise) + live math preview. Server: same rule re-checked (422) | `PUT /admin/traders/:id/commission` | Toast, refetch | Toast | `saving` flag |
| **Trader detail** | Traders row click | read-only | — | none (data already loaded) | — | — | — |
| **Add Merchant** | Merchants → "Add Merchant" | businessName, email, password (+auto-gen), payin/payout fee %, webhook_url, daily_limit_inr | Client: required-field check. Server: Joi | `POST /admin/merchants/create` | Toast, credentials modal, list refetch | Toast | `saving` flag |
| **Edit Fees** | Merchants → "Edit Fees" | payin_fee_percent, payout_fee_percent | Server: Joi | `PUT /admin/merchants/:id/fees` | Toast, refetch | Toast | `saving` flag |
| **Merchant detail** | Merchants row click | read-only + "Regenerate key"/"Set commission" footer buttons | — | Regenerate = **fake local**, Set commission = **dead** | — | — | — |
| **Order detail / manual override** | Orders row/table click | override target status (select) | none beyond select options | `PUT /admin/orders/:id` (via `orderApi.overrideOrder`) or `POST /orders/:id/dispute` | Toast, local patch, refetch | Toast | `busy` flag shared across all order actions |
| **Dispute detail (resolve)** | Disputes row click | resolution notes (textarea) | none | `PUT /admin/disputes/:id/resolve` | Optimistic local update + refetch (best-effort; error swallowed, see §14) | **Silently ignored** — no toast, no rollback message | none (no explicit saving flag; footer buttons stay clickable during the request) |
| **Smartphone detail / disconnect** | Smartphones row click | read-only + Force-disconnect footer button | — | **none — local state only** | — | — | — |
| **Settings — Rate & Revenue** | inline on page | base_exchange_rate, admin_default_margin, trader_default_margin | Server: numeric coercion only, no bounds validation visible | `PUT /admin/settings` | Toast | Toast | `savingRates` flag |
| **Settings — everything else** | inline on page | fee, commission, expiry, rateSource, telegram×2, emailAlerts, maintenance, ips | none | **none** | 2s fake "✓ Saved" | — | none |

**Accessibility of modals:** `Modal` (`ui.jsx:244-280`) closes on `Escape` and backdrop click — good baseline. No focus trap (Tab can escape into the page behind the backdrop), no `aria-modal="true"`/`role="dialog"` attributes, and no initial-focus management (focus is not moved into the modal on open, nor restored to the trigger element on close) — a genuine keyboard/screen-reader gap present in every modal in the panel, since all of them share this one primitive.

---

## 11. Realtime, Sockets, Polling, and Caching

**Client init:** `useSocket()` (`hooks/useSocket.js`), instantiated once per `AdminLayout` mount. Connects to `VITE_WS_URL` with `transports:['websocket']`, `auth:{token: localStorage.accessToken}`, `reconnection:true` (5 attempts). On `connect`, emits `socket.emit('join','admin')` — **this client-side `join` emit has no corresponding server-side listener.** The backend (`websocket/index.js:68-77`) joins the socket to the `admin` room automatically based on the **JWT's decoded role** at connection time (`if (role==='admin') socket.join(ROOM.admin())`), not based on any client-sent `join` event. The `socket.emit('join','admin')` call is dead code — harmless (the room membership already happens correctly via the JWT), but misleading to a future reader who might assume room membership depends on that emit.

**Authentication:** server (`websocket/index.js:35-58`) verifies the JWT from `handshake.auth.token`; invalid/missing tokens **downgrade to anonymous** rather than rejecting the connection (by design, to support the public checkout page's anonymous order-tracking). For the Admin panel this means an expired/invalid `accessToken` doesn't produce a visible socket error — the connection silently succeeds as anonymous, and the panel would show "Realtime connected" (green) while receiving **no** `admin`-room events at all, because anonymous sockets never join that room. This is a real, non-obvious false-positive: the connection-status pill cannot currently distinguish "connected as admin" from "connected anonymously."

**Event map:**

| Backend emit | Payload | Emitted from | Frontend listener | Page(s) affected | Status |
|---|---|---|---|---|---|
| `order:paid` | `{order_id/orderId/id/uuid,...}` | (order pay-in flow, outside Admin) | `useSocket.js:46-50` → toast + `paidCount++` + re-broadcast `order:update` | AdminLayout (paid pill), Orders, Payouts, NotificationBell | **Working** |
| `order:confirmed` | — | `smartMerge`/order flow | `useSocket.js:52-55` → toast + re-broadcast | same | **Working** |
| `order:cancelled` | — | order flow | `useSocket.js:57-60` → toast + re-broadcast | same | **Working** |
| `order:disputed` | — | order flow, `adminController.disputeOrderV2` | `useSocket.js:62-65` → toast + re-broadcast | same | **Working** |
| `order:updated`, `order:rejected` | — | `adminController` (review/reject/updateOrder) | **no listener** — `useSocket.js` only listens for `order:paid/confirmed/cancelled/disputed`, not `order:updated`/`order:rejected` | none directly (Orders page still gets a correct UI update from its *own* `await` response, but no toast/live-refresh fires for a **second browser tab** watching the same order when it's rejected/reviewed) | **Emitted but unheard** — event-name mismatch between backend and frontend listener set |
| `trader:online` / `trader:offline` | `{trader_id/name/id}` | `updateTraderOnlineStatus`, `updateTraderSuspend`, socket connect/disconnect | `useSocket.js:67-75` → toast only (no state update, no `order:update` re-broadcast) | toast-only | **Working but narrow** — Traders page itself doesn't live-update a trader's presence pill from this event, only from its own manual toggle/refetch |
| `trader:created`, `trader:balance`, `trader:status`, `trader:commission:updated`, `merchant:created`, `settings:updated`, `merchant:fees:updated` | various | `adminController`/`balanceService` | **no listener at all** | none | **Emitted but unheard** — Traders/Merchants/Settings pages rely entirely on their own `refetch()` after the initiating admin's own action, not on these broadcasts, so a **second admin's browser tab never live-updates** for any of these |
| `payout:*` (created/accepted/transferred/canceled/disputed/settled/expired) | — | `payoutService` | **no direct listener** — Payouts page instead listens for the *reused* `order:update` window event (which only fires from the four `order:*` sockets above, never from any `payout:*` socket) | Payouts page | **Not actually live** — despite the code comment "Refresh when a payout socket event is re-broadcast," no `payout:*` socket event is ever translated into the `order:update` window event, so **Payouts only refreshes when an unrelated order event happens to fire**, not when a payout itself changes. A second browser tab does not see a new payout request, an acceptance, or a settlement appear without a manual reload. |

**Reconnect/cleanup:** `useSocket`'s effect returns `() => socket.disconnect()` on unmount — correct, no listener-duplication risk from `AdminLayout` remounting (it's mounted once per authenticated session in practice). No polling fallback exists anywhere — if sockets are down/anonymous, pages are only as fresh as their last `useApi` fetch or manual action-triggered `refetch()`.

**Summary:** of ~15 distinct backend socket events relevant to Admin workflows, **4 are genuinely wired end-to-end** (the four `order:*` toast events feeding the shared `order:update` bridge), **1 fires but is silently dropped** (`order:updated`/`order:rejected`), and **the entire `payout:*` family (7 events) and most `trader:*`/`merchant:*`/`settings:*` broadcasts are emitted by the backend and never consumed** — meaning most of the panel's apparent "real-time" behavior (e.g., Payouts feeling live) is actually **coincidental**, riding on the unrelated order-event bridge, not a real subscription to its own domain's events.

---

## 12. API Inventory

### Admin-namespace endpoints (`/api/admin/*`, all require `verifyToken`+`checkRole('admin')`)

| Frontend method (`services/api.js`) | Method | Endpoint | Backend controller | Service/Model effect | Page(s) using it | Status |
|---|---|---|---|---|---|---|
| `adminApi.dashboard` | GET | `/dashboard` | `adminController.dashboard` | `Trader`/`Order`/`Merchant`/`Dispute` counts+sums, `settingsService` | Dashboard | Reachable |
| `adminApi.listTraders` | GET | `/traders` | `.listTraders` | `Trader.findAndCountAll`+`User` | Traders, HeaderSearch | Reachable |
| `adminApi.createTrader` | POST | `/traders` | `.createTrader` | `User`+`Trader.create` | **none** | **Defined, never called (dead frontend method)** |
| `adminApi.createTraderFull` | POST | `/traders/create` | `.createTraderFull` | `User`+`Trader.create`+`BalanceLog` | Traders | Reachable |
| `adminApi.updateTrader` | PUT | `/traders/:id` | `.updateTrader` | `Trader`/`User.update` | Traders | Reachable |
| `adminApi.updateTraderBalance` | PUT | `/traders/:id/balance` | `.updateTraderBalance` | `balanceService.adminAdjust` → `Trader`+`BalanceLog` | Traders | Reachable |
| `adminApi.updateTraderCommission` | PUT | `/traders/:id/commission` | `.updateTraderCommission` | `Trader.update` | Traders | Reachable |
| `adminApi.setTraderOnline` | PUT | `/traders/:id/online-status` | `.updateTraderOnlineStatus` | `Trader.update` | Traders | Reachable |
| `adminApi.suspendTrader` | PUT | `/traders/:id/suspend` | `.updateTraderSuspend` | `User`+`Trader.update` | Traders | Reachable |
| — (no frontend method) | DELETE | `/traders/:id` | `.deleteTrader` | soft-disable `User`+`Trader` | **none** | **Backend exists, zero frontend reference (no `adminApi` wrapper at all)** |
| `adminApi.listMerchants` | GET | `/merchants` | `.listMerchants` | `Merchant.findAndCountAll`+`User` | Merchants, HeaderSearch | Reachable |
| `adminApi.createMerchant` | POST | `/merchants` | `.createMerchant` | `User`+`Merchant.create` | **none** | **Defined, never called** |
| `adminApi.createMerchantFull` | POST | `/merchants/create` | `.createMerchantFull` | `User`+`Merchant.create` | Merchants | Reachable |
| `adminApi.updateMerchant` | PUT | `/merchants/:id` | `.updateMerchant` | `Merchant`/`User.update` (incl. `is_active`) | **none** (Merchants' Activate/Deactivate button doesn't call it) | **Defined, never called — a real fix for a fake button already exists server-side** |
| `adminApi.updateMerchantFees` | PUT | `/merchants/:id/fees` | `.updateMerchantFees` | `Merchant.update` | Merchants | Reachable |
| `adminApi.getSettings` | GET | `/settings` | `.getSettings` | `settingsService.getAll` | Settings | Reachable |
| `adminApi.updateSettings` | PUT | `/settings` | `.updateSettings` | `settingsService.set` (allow-listed keys) | Settings (Rate & Revenue only) | Reachable |
| `adminApi.listOrders` | GET | `/orders` | `.listOrders` | `Order.findAndCountAll`+`Merchant`+`Trader` | Orders, HeaderSearch, NotificationBell | Reachable |
| `adminApi.updateOrder` | PUT | `/orders/:id` | `.updateOrder` | status-mapped `smartMerge`/release logic | Orders (manual override + `orderApi` wrappers) | Reachable |
| `adminApi.reviewOrder` | PUT | `/orders/:id/review` | `.reviewOrder` | `Order.update` | Orders | Reachable |
| `adminApi.confirmOrderV2` | PUT | `/orders/:id/confirm` | `.confirmOrderV2` | `Transaction.create`+`smartMerge.confirmOrder`+`balanceService.settleOrder` | Orders | Reachable |
| `adminApi.rejectOrderV2` | PUT | `/orders/:id/reject` | `.rejectOrderV2` | `Order.update`+`routingEngine.releaseTrader` | Orders | Reachable |
| `adminApi.disputeOrderV2` | PUT | `/orders/:id/dispute` | `.disputeOrderV2` | `Order.update`+`Dispute.create` | Orders | Reachable |
| `adminApi.listDisputes` | GET | `/disputes` | `.listDisputes` | `Dispute.findAll`+`Order` | Disputes | Reachable |
| `adminApi.resolveDispute` | PUT | `/disputes/:id/resolve` | `.resolveDispute` | `Dispute.update` | Disputes | Reachable |
| — (no frontend method) | GET | `/settlements` | `.listSettlements` | `Settlement.findAll`+`Trader`+`Merchant` | **none** | **Backend exists, zero frontend reference** |
| — (no frontend method) | POST | `/settlements/trigger` | `.triggerSettlement` | `jobs/settlementJob.runSettlement` | **none** | **Backend exists, zero frontend reference; also internally uses a legacy rate model — see §14** |
| — (no frontend method) | GET | `/smartphones` | `.listSmartphones` | `Smartphone.findAll`+`Trader`+`User` | **none** | **Backend exists, zero frontend reference** |
| — (no frontend method) | PUT | `/smartphones/:id/disconnect` | `.disconnectSmartphone` | `Smartphone.update({is_online:false})` | **none** | **Backend exists, zero frontend reference** |
| `adminApi.listPayoutRequests` | GET | `/payout-requests` | `payoutController.adminList` | `payoutService.listForAdmin`+`adminCounts` | Payouts | Reachable |
| `adminApi.approvePayoutRequest` | POST | `/payout-requests/:id/approve` | `.adminApprove` | `payoutService.approve`→`settleAndCredit` | Payouts | Reachable |
| `adminApi.rejectPayoutRequest` | POST | `/payout-requests/:id/reject` | `.adminReject` | `payoutService.reject` | Payouts | Reachable |
| `adminApi.resolvePayoutDispute` | POST | `/payout-requests/:id/dispute-resolve` | `.adminDisputeResolve` | `payoutService.disputeResolve` | Payouts | Reachable |

### Outside `/api/admin` but reachable by an admin JWT

| Frontend method | Method | Endpoint | Backend | Used by Admin UI? |
|---|---|---|---|---|
| `authApi.login` | POST | `/auth/login` | `authController.login` | Yes (Login) |
| `authApi.logout` | POST | `/auth/logout` | `authController.logout` | Yes (Sidebar logout) |
| `authApi.me` | GET | `/auth/me` | `authController.me` | Yes (session rehydration) |
| `orderApi.disputeOrder` | POST | `/orders/:id/dispute` | `orderController.dispute` (`verifyToken`, any role) | Yes (Orders manual override → dispute) |
| — | POST | `/orders/:id/cancel` | `orderController.cancel` (`checkRole('trader','admin')`) | **No — backend permits admin, UI never calls it** |
| — | POST | `/orders/:id/expire` | `orderController.expire` (`checkRole('trader','admin')`) | **No — backend permits admin, UI never calls it** |
| — | POST | `/payment/manual` | `paymentController.manual` (`checkRole('trader','admin')`) | **No — the manual payment-match endpoint Payments.jsx should be using** |
| 2FA endpoints (`/auth/2fa/*`) | — | — | `authController` | **No — see §3, causes a broken login path** |

### Summary lists (per the audit's required breakdown)

- **API methods defined in `services/api.js` but never called by any page:** `adminApi.createTrader`, `adminApi.createMerchant`, `adminApi.updateMerchant`.
- **Backend endpoints with no frontend UI at all (no `adminApi` wrapper exists):** `DELETE /admin/traders/:id`, `GET /admin/settlements`, `POST /admin/settlements/trigger`, `GET /admin/smartphones`, `PUT /admin/smartphones/:id/disconnect`, `POST /orders/:id/cancel`, `POST /orders/:id/expire`, `POST /payment/manual`.
- **Frontend methods with no backend handler:** none found — every method in `services/api.js` maps to a real, existing route.
- **Duplicated endpoints:** `adminApi.confirmOrder`/`cancelOrder`/`overrideOrder` (in `orderApi`) are three named wrappers around the same single `adminApi.updateOrder` call (`api.js:112-117`) — not a backend duplication, but a frontend naming layer that obscures that they all hit one endpoint.
- **Legacy endpoints:** `PUT /admin/orders/:id` (generic `updateOrder`) is explicitly commented in the backend as "kept for backward compatibility" (`adminController.js:583`) alongside the newer, more explicit v2 endpoints it partially overlaps with.
- **Risky endpoints:** `updateSettings` accepts `admin_default_margin`/`trader_default_margin`/`base_exchange_rate` with **no min/max bound validation** server-side (`updateSettings` just string-coerces and stores whatever is sent) — an admin (or a compromised admin session) could set `trader_default_margin` above `admin_default_margin` at the *global default* level (the **per-trader** commission update endpoint enforces `trader_margin < admin_margin`, but this global-default endpoint does not), which would make every *newly created* trader's default configuration immediately unprofitable for the platform until manually corrected per-trader.
- **Endpoints missing authorization narrower than "any admin":** none — there being only one admin role, this isn't applicable (see §3), but it does mean every admin action here is available to every admin account with no finer-grained control (e.g., balance adjustments have the same authorization requirement as viewing a dashboard).
- **Endpoints with weak validation:** `updateSettings` (above); `updateTrader`/`updateMerchant` generic patch endpoints whitelist *which fields* can change but don't validate the *values* of those fields (e.g., `daily_limit` accepts any number sent, including negative).

---

## 13. Mock, Hardcoded, and Fake Data Audit

| Item | File:Line | Rendered where | Could be mistaken for real? | Recommended treatment |
|---|---|---|---|---|
| `utils/mock.js` formatters (`inr`, `usdt`, `pct`, `maskUpi`, `maskKey`, `compact`) | `utils/mock.js:10-33` | Every page | N/A — these are real, generic formatting utilities, not fake data | Keep |
| `traders`, `merchants`, `orders`, `payments`, `payouts`, `disputes`, `smartphones`, `settlementTraders/Merchants/History`, `volume7Days`, `successVsFailed`, `topTraders/Merchants`, `liveFeedSeed` | `utils/mock.js:52-121` | Dashboard charts/lists, Payments, Smartphones, Settlement, Traders/Merchants/Orders pre-fetch state | **No** — these are now all empty (`[]`/zeroed objects), so they render as blank/zero states rather than misleading fake numbers | Replace with real fetches (Payments/Smartphones/Settlement) or delete the unused exports once those pages are wired |
| `dashboardStats` (all-zero fallback) | `utils/mock.js:102-109` | Dashboard StatCards, merged via `??` with live API data | No — only visible if the live API call fails, and would show `₹0`/`0` clearly | Fine as a fallback |
| Settings `ips` default | `Settings.jsx:23` | Settings → IP Whitelist | **Yes** — `203.0.113.7`/`198.51.100.24` look like plausible real IPs unless the reader recognizes the RFC 5737 documentation range | Replace with an empty list loaded from a real backend allow-list, or clearly label as example/placeholder |
| Settings `fee='0.6'`, `commission='0.4'`, `expiry='15'`, `rateSource='binance'` defaults | `Settings.jsx:14-17` | Settings → Fees/Orders sections | **Yes** — presented identically to the genuinely-loaded Rate & Revenue fields immediately above them on the same page | Load from backend or visually distinguish as "not yet configurable" |
| Merchants "Regenerate API key" fake key | `Merchants.jsx:235-236` | Merchants table, after clicking the action | **Yes, seriously** — format (`pk_live_...`) mimics the real key format exactly | Remove until backed by a real rotation endpoint |
| Dashboard live-feed synthetic rows | `Dashboard.jsx:112-134` | Dashboard "Live Transaction Feed" | Would have been yes, but currently **crashes before rendering anything** (see §1) | Fix the divide-by-zero and decide whether a simulated feed belongs in an admin console at all, or wire it to real order events |
| "Administrator" badge, static text | `AdminLayout.jsx:60-67` | Top bar, always visible | No — accurate (there's only one role) but uninformative | Fine as-is given single-role reality |
| Trader detail modal empty sections (bank accounts, smartphones, phone, joined date) | `Traders.jsx:61-63` | Trader detail modal | Could read as "this trader genuinely has none," not "this isn't wired" | Wire to real associations or hide the sections |
| Order detail "Payment Detection"/raw SMS | `Orders.jsx:35-37` | Order detail modal | Same ambiguity | Wire to real `Transaction`/detection data or hide |
| Dispute "Raised By: — (merchant)" | `Disputes.jsx:19-20` | Disputes table + modal | **Yes** — reads as a data-loading failure rather than an intentional placeholder | Join the real `raised_by` user in the backend listing query |

---

## 14. Technical Debt

**Critical**
- Merchants "Regenerate API key" fakes a credential rotation with no server effect (§7.4) — active security-incident risk if relied upon.
- Smartphones "Force disconnect" fakes a device kill-switch with no server effect (§7.9) — active incident-response risk.
- Settlement's "Trigger manual settlement" fakes a financial operation end-to-end, including a fabricated success timestamp, with zero backend call (§7.10).
- Login has no working path for 2FA-enabled admin accounts (§3, §7.1) — a hard authentication break, not a cosmetic gap.
- Settings page mixes one genuinely-persisted section with five non-persisted sections behind visually-equal "Save" affordances (§7.11) — the page most likely to cause a real operational mistake.

**High**
- `updateSettings` has no bound validation on margin/rate fields, unlike the equivalent per-trader endpoint (§12) — global defaults could be set into an unprofitable configuration.
- `jobs/settlementJob.runSettlement` (reachable only via an unwired endpoint today) uses a **different, legacy rate/fee model** than the real per-order settlement path — if ever wired up naively, it would double-settle and misprice already-settled orders (§7.10, §14).
- The `payout:*` socket family (7 event types) is emitted by the backend and never consumed by the frontend; Payouts' apparent "live" refresh is riding on unrelated order events, not real payout events (§11).
- Sockets silently downgrade to "anonymous" on an invalid/expired token with no visible error, while the UI still reports "Realtime connected" (§11) — a false-positive connectivity indicator.
- `Modal` has no focus trap, no `role="dialog"`/`aria-modal`, and no focus restoration — affects every modal in the app (§10, §15).

**Medium**
- No shared `<Table>` component despite 8 near-identical hand-rolled tables (§6, §9).
- Two divergent color-name→hex maps (`ACCENT_HEX` vs `BADGE_HEX`) in `ui.jsx` (§6).
- `Payments.jsx`'s native date inputs hardcode dark-mode-only styling, breaking theme parity on that one page (§6).
- Client-side-only search/sort/pagination on Traders/Merchants/Orders — works today, will not scale (§16).
- Sidebar badge counts are permanently hardcoded to zero (§5) — a dead feature that looks intentionally "all clear."
- Dead frontend API methods (`createTrader`, `createMerchant`, `updateMerchant`) and 8 backend endpoints with no frontend caller at all (§12).
- `resolveDispute`'s failure path is silently swallowed (empty `catch`) with no user-facing error (`Disputes.jsx:120-122`).
- `README.md` claims "business logic is not implemented yet" — stale and actively misleading to new contributors (§2).
- `store/` directory and the `zustand` dependency are entirely unused (§2).

**Low**
- `socket.emit('join','admin')` on connect has no server-side handler — dead code, harmless (§11).
- Card vs. Modal border-radius mismatch (18px vs ~16px) (§6).
- `dist/` build output committed to the repository.
- Three different icon-button implementations (`tf-hbtn` class, raw Tailwind, `Button` component) depending on page (§6).

---

## 15. Responsive and Accessibility Audit

*(Based on the actual CSS/JSX implementation — no live browser testing was performed as part of this documentation-only task; the below is what the code guarantees or fails to guarantee, not a rendered-screenshot review.)*

- **Sidebar/topbar chrome:** no responsive behavior at all. The 256px/72px sidebar and the topbar's flex row of controls (search, badge, bell, theme toggle, avatar) are present unconditionally at every viewport width — there is no hamburger/drawer pattern and no CSS breakpoint that hides or collapses them. On a narrow viewport, the topbar's `flex items-center gap-2.5` cluster of ~6 controls plus `HeaderSearch`'s `minWidth:200` box will overflow or wrap unpredictably; this was not visually verified but is guaranteed by the absence of any responsive class on `AdminLayout.jsx`'s header markup.
- **Page content:** most page-level card grids do use Tailwind responsive classes (`sm:grid-cols-2`, `lg:grid-cols-4`, etc.), so `StatCard` grids and filter bars are designed to reflow on smaller screens.
- **Tables:** every table sits in an `overflow-x-auto` wrapper — the mechanism for surviving narrow viewports is horizontal scroll, not column-hiding/stacking. No table implements a responsive card-list fallback for mobile.
- **Modals:** `Modal` sizes are `max-w-lg/2xl/4xl` with `w-full` and `p-4` on the backdrop, so a modal will shrink to fit a narrow viewport width-wise, but its **max-height is fixed at `70vh` for the body** regardless of viewport height — on a short viewport (e.g. a phone in landscape) this could still be awkward, though not verified visually.
- **Touch targets:** icon-only buttons (`tf-hbtn`, 38×38px) and the Traders row-menu trigger meet a reasonable ~38-40px minimum; some inline table actions (e.g., the copy-icon button in Orders' `CopyId`) are smaller and tightly padded (`p-1`), likely below comfortable touch-target size.
- **Keyboard navigation:** standard tab order should work for form fields and buttons (no `tabIndex` overrides found). `Modal` closes on `Escape` (good) but does **not** trap focus inside itself, so `Tab` can cycle into the backdrop-obscured page behind it — a real keyboard-trap-avoidance gap that also happens to be a focus-visibility gap (a sighted keyboard user can tab to an invisible, backdrop-hidden control).
- **Visible focus:** no custom `:focus` styling was found for buttons/links beyond the browser default and the `focus:ring-2` utility applied to form inputs (`Input`/`Select`/`SearchInput` in `ui.jsx`) — buttons rely entirely on the browser's native focus ring, which is inconsistent across browsers but at least present (not suppressed via `outline:none` without a replacement).
- **Semantic headings:** `PageHeader` renders an `<h1>` per page and `Section`/`Card` internals use `<h2>`/`<h3>` — a real, if unverified-for-perfect-nesting, heading hierarchy exists.
- **Form labels:** every form field in the audited modals uses a `<label>` element positioned immediately above its input (not programmatically `htmlFor`-bound to the input's `id` — no `id`/`htmlFor` pairing was found anywhere in `ui.jsx`'s `Input`/`Select` or any page's inline `<label>`/`<input>` pairs), which is a **visual** association a sighted user reads correctly but **not a programmatic** one a screen reader announces correctly.
- **ARIA:** `Toggle` correctly implements `role="switch"` + `aria-checked` (`ui.jsx:95-96`) — a genuine accessibility-aware primitive. `Modal`'s close button has `aria-label="Close"`. Icon-only header buttons (theme toggle, sidebar collapse, notification bell) have `aria-label`s. Beyond these specific instances, no `aria-live` regions exist anywhere — toast notifications (`Toaster`) are not announced to screen readers, and neither are async loading states (`InlineLoader`) or the socket connection-status pill.
- **Color contrast:** not independently verified (would require rendered-page measurement); the token palette (§6) uses `--muted: #94a3b8` on both light and dark card backgrounds, which is a mid-gray likely to be borderline against `--card:#ffffff` in light mode for small text (11-13px table metadata) — flagged as worth a contrast check, not confirmed as a failure.
- **Reduced motion:** the one continuous animation in the system (`tf-badge`/`tf-float`) correctly respects `prefers-reduced-motion` (`index.css:118-120`). No other page-level animation (chart transitions, toast entry) has an equivalent guard, though none of them are continuous/looping, so the impact is smaller.
- **Icon-only buttons without a visible label:** row-menu triggers (Traders' `✎▼`, Merchants' `⋮`), table action icons — all have either a `title`/`aria-label` or adjacent text; no unlabeled icon-only interactive element was found.

---

## 16. Performance and Scalability

- **Traders/Merchants/Orders:** backend pagination exists (`pagination()` helper, default `limit:25`, `maxLimit:100`) and is genuinely used server-side — **but the frontend never sends a `page` parameter**, so every list call fetches only the backend's *default* first page/limit and then does all filtering/searching/pagination **client-side over that single fetched batch** (`Traders.jsx`'s `filtered`/`pageRows` `useMemo`s operate on the in-memory `list`, not on a re-fetched page). At small scale (tens of traders/merchants) this is invisible; at the audit's stress-test reference points:
  - **100 traders:** still within the default 25-limit fetch's neighborhood but the "12/page" client pagination would only ever paginate through whatever the *first* server page contained — an admin could believe they're seeing "page 2 of all traders" when they're actually paginating within a 25-row (or whatever default) server slice. This is a **correctness** bug at moderate scale, not just a performance one.
  - **1,000 traders / 10,000 orders:** the current architecture would require the frontend to explicitly request higher `limit`/`page` values (which `adminApi.listOrders`/`listTraders`/`listMerchants` *do* accept as passthrough params, e.g. `HeaderSearch.jsx` already calls `{limit:100}` for its own purposes) — but no page's primary table currently does this, so an admin's default landing view of Traders/Merchants/Orders is silently incomplete at this scale, with no "showing X of Y total" indicator reflecting the true total (the `Pagination` component's `total` prop is fed `filtered.length` — the in-memory count — not the server's real `pagination.total`).
- **HeaderSearch** fetches 100 rows each of orders/traders/merchants **on first focus** (not on every keystroke — debounced client-side filtering happens after that one fetch) — reasonable at today's scale, but a fixed `limit:100` means search silently misses anything beyond the 100 most recent/first rows once real volume exceeds that.
- **NotificationBell** re-fetches the last 20 orders on every `order:update` window event — with frequent order activity this is a poll-like pattern riding on socket events rather than the socket payload itself, doubling network calls (one socket message, one follow-up REST fetch) for every relevant event.
- **No client-side table virtualization anywhere** — all tables render every row in the current (already client-truncated) page directly into the DOM; not a concern at current row counts (≤100), would become one if the pagination gap above were fixed by simply raising `limit` rather than adding true server pagination.
- **Chart computation:** `VolumeChart`/`DonutChart` are pure, cheap SVG/inline-style renders with no expensive recomputation — not a bottleneck even when populated with real data.
- **Repeated API calls:** `useApi`'s `refetch()` re-runs the full fetch and replaces state; used liberally (every mutating action calls it) — correct for freshness, but combined with the no-pagination gap above, means every single trader/merchant/order mutation re-fetches the *entire* (unpaginated) list, which will scale linearly with total record count regardless of how many rows are visible.
- **CSV export** (Payments) operates entirely client-side over already-fetched data with no server-side generation — fine for the row-counts the frontend fetches today, would need revisiting if a real, larger, server-paginated dataset were wired up (exporting "all payments" would then require either a dedicated export endpoint or fetching all pages first).
- **Polling:** none — the panel relies entirely on user-triggered refetch + the socket-driven `order:update` bridge (§11) for freshness; there is no periodic auto-refresh interval anywhere except the (broken) Dashboard live-feed simulator.

---

## 17. Security Review

*(Documentation of risk only — no exploitation performed.)*

- **Token storage:** access + refresh tokens and the `user` object are stored in `localStorage` (`AuthContext.jsx:6-10`), not an httpOnly cookie — standard XSS-exfiltration exposure for a JWT-in-localStorage pattern; any successful script injection on this origin can read and exfiltrate a live admin session.
- **Authentication fallback:** on a network error during login, the panel **locally fabricates an authenticated admin session** (`MOCK_USER`/`MOCK_TOKENS`, `AuthContext.jsx:65-76`) regardless of the credentials entered — see §3 for full detail. This is the single highest-severity finding in this audit: it means the authenticated admin *shell* (not real data, since mock tokens fail every subsequent server call) can be entered with zero valid credentials whenever the API host is unreachable from the browser.
- **Role validation:** enforced server-side on every `/api/admin/*` route (`verifyToken`+`checkRole('admin')`) — genuine, not bypassable by a crafted frontend request alone. `ProtectedRoute.jsx` performs **no** client-side role check (only `isAuthenticated`), which is a defense-in-depth gap, not by itself exploitable given the server-side enforcement, but means the client trusts "a user object exists" rather than "this user is an admin."
- **Session rehydration on unreachable backend:** falls back to trusting cached `localStorage.user` JSON without re-validating role/expiry (`AuthContext.jsx:37-47`) — same class of risk as the login fallback, triggered on any transient network blip during app load, not only full outages.
- **Credential/secret exposure in the UI:** merchant API secrets and generated trader/merchant passwords are displayed **once**, in a dedicated post-creation modal, with explicit "won't be shown again" copy (`Traders.jsx:817`, `Merchants.jsx:414`) — a correct pattern. The Merchant detail modal additionally supports **revealing the API secret again later** (`Secret` component, `Merchants.jsx:45-63`, toggled via an eye icon) — this means the secret **is** returned by `GET /admin/merchants` in plaintext for any admin to view repeatedly, not shown only once as the creation-flow copy implies; worth confirming this is the intended lifetime exposure for that credential.
- **Password handling:** backend hashes with bcrypt (`authService.hashPassword`, salt rounds from `config.security.bcryptSaltRounds`, default 12) before storage — correct. Auto-generated passwords (`genPassword()`, duplicated verbatim in both `Traders.jsx` and `Merchants.jsx`) use `window.crypto.getRandomValues` — a CSPRNG, correct choice, though the modulo-based character mapping (`chars[n % chars.length]`) has a very slight non-uniform bias (charset length 66 doesn't evenly divide 2^32) — cryptographically immaterial at 16 characters but worth noting as an imprecision.
- **Unsafe HTML / XSS surface:** no `dangerouslySetInnerHTML` or raw HTML injection was found anywhere in the audited files — all rendered content goes through normal JSX text interpolation.
- **CSRF:** the API is Bearer-token-authenticated (not cookie-session-based for the protected routes), which inherently avoids classic CSRF for state-changing requests — appropriate for this architecture.
- **Sensitive data in logs:** not assessable from the frontend alone; backend `logger.info` calls in `payoutService`/`balanceService` log trader/merchant IDs and amounts, not raw secrets — no plaintext credential logging was found in the files read.
- **Destructive actions without confirmation:** Suspend/Activate (Traders), Reject/Void (Payouts), and the order Reject/Dispute actions all fire **immediately on click with no confirmation dialog** — for financially/operationally consequential actions (suspending a trader mid-shift, rejecting a payout after a merchant has been told it's processing) the absence of a confirm step is a real UX-safety gap, not just a security one.
- **Authorization enforcement recap:** every genuinely-wired mutating endpoint traced in §12 does enforce `checkRole('admin')` server-side — the panel's *real* actions are not exposed to non-admins. The gaps documented in this audit are almost entirely about **actions that look real but aren't** (fake buttons), not about **actions that are real but under-protected**.
- **Local-state-only "security controls":** the Smartphones "Force disconnect" and Merchants "Deactivate"/"Regenerate key" buttons are the closest things to a security control in this panel (kill a device, disable a merchant, rotate a leaked key), and **all three are fake** (§7.4, §7.9) — meaning the panel currently offers no working emergency-response tooling through its UI for these specific scenarios, despite appearing to.

---

## 18. Final Feature Matrix

| Feature | Page | UI exists | API exists | Backend handler exists | DB effect exists | Fully reachable | Uses real data | Realtime | Production-ready | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Login (password) | Login | Y | Y | Y | Y | Y | Y | — | Y | |
| Login (2FA) | Login | N | Y | Y | Y | N | — | — | **N** | Backend ready, frontend missing — broken path |
| Dashboard stat cards | Dashboard | Y | Y | Y | Y | Y | Y | N | Y | |
| Dashboard charts/top-lists | Dashboard | Y | N | N | — | N | N | N | **N** | No backend endpoint exists for these at all |
| Dashboard live feed | Dashboard | Y | N | N | — | N | N | — | **N (broken)** | Crashes on every tick |
| Trader list/create/edit/balance/commission/suspend/online | Traders | Y | Y | Y | Y | Y | Y | Partial | Y | Detail-modal sub-sections empty |
| Trader "Reset password"/"Add balance" (detail modal) | Traders | Y | — | — | — | N | — | — | **N** | Dead buttons, no handler |
| Merchant list/create/edit fees | Merchants | Y | Y | Y | Y | Y | Y | N | Y | |
| Merchant activate/deactivate | Merchants | Y | Y (unused) | Y | Y | N | N | — | **N** | Backend ready, frontend doesn't call it |
| Merchant regenerate API key | Merchants | Y | N | N | — | N | N | — | **N** | No rotation endpoint exists |
| Merchant "Edit"/"Set commission" | Merchants | Y | — | — | — | N | — | — | **N** | Dead buttons |
| Order review/confirm/reject/dispute/override | Orders | Y | Y | Y | Y | Y | Y | Y | Y | Best-wired workflow in the panel |
| Order detection/timeline detail | Orders | Y | N | N | — | N | N | — | **N** | UI present, no data ever populated |
| Payments/notification log | Payments | Y | N | N (related model exists, unused) | — | N | N | — | **N** | Entirely disconnected |
| Payout-request moderation | Payouts | Y | Y | Y | Y | Y | Y | Partial (coincidental) | Y | Real events not consumed, rides order-event bridge |
| Dispute list/resolve | Disputes | Y | Y | Y | Y | Y | Y | N | Y | |
| Dispute "mark reviewing" | Disputes | Y | N | N | — | N | N | — | **N** | Local-only |
| Smartphone list/disconnect | Smartphones | Y | N (unused, exists) | Y | Y | N | N | — | **N** | Entirely disconnected, both endpoints ready |
| Settlement views/trigger | Settlement | Y | N (unused, exists) | Y | Y | N | N | — | **N** | Entirely disconnected; backend logic itself uses a legacy rate model |
| Settings — Rate & Revenue | Settings | Y | Y | Y | Y | Y | Y | N | Y | |
| Settings — everything else | Settings | Y | N | Partial (some keys accepted, unused) | — | N | N | — | **N** | Hardcoded, unsaved |
| Realtime order/dispute toasts | (global) | Y | — | Y | — | Y | Y | Y | Y | |
| Realtime payout events | (global) | N | — | Y | — | N | N | N | **N** | Emitted, never consumed |
| Sidebar badge counts | (global) | Y | N | — | — | N | N | — | **N** | Hardcoded zero |
| Global search (orders/traders/merchants) | HeaderSearch | Y | Y | Y | Y | Y | Y | N | Y (at current scale) | Fixed `limit:100`, will miss records beyond that |

---

## 19. Final Scores

| Dimension | Score /10 | Justification |
|---|---|---|
| Architecture | 6 | Clean separation (routes→controllers→services→models), consistent response envelope (`ok`/`fail`), transactional money movement where wired — but the frontend has no per-page data layer discipline (mock-vs-real is invisible at the import level) and no shared table/API-pagination pattern. |
| Code quality | 6 | Consistently formatted, well-commented business logic (especially `balanceService`/`payoutService`), Joi validation on real endpoints — offset by silently-swallowed errors (`Disputes.jsx` resolve catch), duplicated `genPassword()`/row-menu patterns across pages, and no shared `<Table>`. |
| Maintainability | 5 | Backend is genuinely maintainable (clear service boundaries); frontend mixes real and fake data sources indistinguishably at a glance, which is itself a maintainability hazard — a contributor cannot tell "is this page done" without reading every handler. |
| Admin business coverage | 5 | Trader/merchant onboarding, order settlement, and payout moderation — the core money-moving workflows — are genuinely covered. Device management, notification/payment investigation, and manual settlement are not, despite being visually present. |
| Backend integration | 6 | Where integrated, it's integration done correctly (transactions, row locks, server-side re-validation of client rules). But roughly a quarter of ready backend admin endpoints (§12) have zero frontend caller, and three pages (Payments/Smartphones/Settlement) have none at all. |
| UI consistency | 6 | A real shared primitive library (`ui.jsx`) is used broadly; undermined by the two color maps, one theme-inconsistent page, and three different icon-button patterns (§6). |
| UX quality | 4 | The panel's biggest issue: multiple flows produce a complete, confident success signal (toast, spinner, timestamp, credential display) for actions that did nothing server-side. This is worse for UX trust than an honest "not implemented" state would be. |
| Information hierarchy | 6 | Individual pages are well laid out (filters → table → actions, header stat cards); the Dashboard's blank chart sections and the Settings page's dual-Save-button ambiguity actively hurt hierarchy/clarity. |
| Accessibility | 4 | Some genuine care (ARIA on `Toggle`, `aria-label`s on icon buttons, reduced-motion respect) but no modal focus trap, no `aria-live` for toasts, and label/input association is visual-only, not programmatic. |
| Responsiveness | 3 | Content grids adapt; the sidebar/topbar chrome does not adapt at all, and no breakpoint or drawer pattern exists for the shell. |
| Performance | 6 | Fine at current/demo scale; the pagination gap (§16) is a real correctness-at-scale issue, not just a speed one, once record counts grow past a single default server page. |
| Scalability | 4 | Client-side search/sort/filter over a single, non-paginated fetch is the dominant pattern across Traders/Merchants/Orders — this will not hold up past low thousands of records without frontend changes. |
| Security | 5 | Server-side authorization is sound wherever it's exercised; the mock-login-on-network-failure fallback (§3, §17) is a genuine, non-hypothetical weakness, and three "security-adjacent" UI controls (device disconnect, merchant deactivate, key rotation) are fake. |
| Production readiness | 4 | Not ready to ship as-is: fake financial/security-adjacent actions (regenerate key, force disconnect, trigger settlement) must be fixed or gated before this panel is trusted in a real incident, and the 2FA login gap blocks any admin account that has 2FA enabled today. |

---

# Information Required Before Admin UI Redesign

The following product decisions could not be inferred from the code and must be answered by the owner before a redesign proceeds:

- What should the Admin see first — is the current Dashboard's mix of live stats + permanently-blank charts the right first screen, or should the landing page change entirely?
- Which KPIs are operationally important enough to justify building the missing aggregation endpoints (7-day volume, success/fail trend, top traders/merchants by volume)?
- Should Payments/Smartphones/Settlement be built out to match their current (unfinished) UI, redesigned from scratch around what data is actually available (`NotificationLog`, `Smartphone`, `Settlement` models already exist), or removed from the nav entirely until ready?
- Is a single generic `admin` role sufficient long-term, or should the platform introduce Finance/Support/Read-only tiers — this materially changes route protection, the permission model, and which of the "fake" destructive actions (deactivate merchant, force-disconnect device, regenerate key) should even be admin-wide vs. restricted?
- Which of the currently-fake actions are actually needed as real features (Merchant regenerate-key, Smartphone force-disconnect, Settlement trigger, Dispute mark-reviewing, Merchant activate/deactivate) versus which should simply be removed from the UI?
- What should the real 2FA flow look like for admin login, and is 2FA meant to be mandatory for all admin accounts going forward?
- Should the mock-login-on-network-failure "offline demo mode" be kept as a deliberate feature (with clearer, safer messaging) or removed entirely now that a real backend exists?
- Which financial values should be treated as authoritative when they disagree — the per-order rate-margin settlement (`balanceService`, already running automatically) or the legacy `settlementJob` calculation (static rate/fee env vars) that the unwired "Settlement" page would trigger if connected as-is?
- What should the Settings page's real scope be — which of Fees/Order-expiry/Telegram/Maintenance-mode/IP-whitelist are genuinely going to be built as backend-backed settings, and which should be dropped from the UI?
- How should "real-time" be defined for a future redesign — should Payouts/Traders/Merchants get genuine dedicated socket listeners (the events already exist server-side), or is refetch-after-action considered sufficient?
- What should trader/merchant "risk" or "health" look like, given the current detail modals promise data (bank accounts, devices, notification confidence scores) that isn't populated today — is that a near-term data-completeness project or a scope cut?
- Should list pages (Traders/Merchants/Orders) move to true server-side pagination/search/sort now, ahead of a visual redesign, given it's a correctness issue (not just a performance one) once record counts grow?
- What is the target device/breakpoint list for making the sidebar/topbar shell itself responsive, since no responsive behavior exists for it today?

---

## Audit Statistics

1. **Total Admin frontend files read:** 35 (all non-generated files in `frontend/admin` outside `dist/`, `.gitkeep` placeholders, and `package-lock.json`) — every `.jsx`/`.js`/`.css` source file (27) plus all config/env/doc files (8).
2. **Total backend files inspected:** 31 — `app.js`, `server.js`, `config/index.js`, 2 route files fully read (`adminRoutes.js`, `authRoutes.js`) + 6 more route files inspected for their route tables (`traderRoutes.js`, `merchantRoutes.js`, `orderRoutes.js`, `paymentRoutes.js`, `deviceRoutes.js`, `payoutRoutes.js`, `routes/index.js`), 3 controllers fully read (`adminController.js`, `payoutController.js`, `authController.js`), 3 services fully read (`settingsService.js`, `balanceService.js`, `payoutService.js`), 9 models fully read (`order`, `trader`, `merchant`, `dispute`, `payoutRequest`, `smartphone`, `setting`, `user`, `settlement`), `websocket/index.js`, `middleware/auth.js`, `middleware/errorHandler.js`, `utils/http.js`, `jobs/settlementJob.js`. `ngo-backend` was grep-scanned (not deep-read) to confirm zero Admin-panel dependency.
3. **Total frontend routes found:** 11 (`/login` public + 10 protected pages) + 1 catch-all redirect.
4. **Total API calls traced end-to-end (frontend method → route → controller → service/model):** 33 distinct frontend-reachable backend endpoints (3 auth + 28 `/admin/*` + `orders/:id/dispute`), against 33 total registered `/admin/*` backend routes plus the auth/order/payment routes referenced above.
5. **Fully wired pages:** 3 — Traders, Orders, Payouts (each with minor dead affordances noted, but their primary workflows are fully real).
6. **Partially wired pages:** 4 — Dashboard (stats real, charts/feed not), Merchants (create/list/fees real, row-menu mostly fake), Disputes (resolve real, review-marking fake), Settings (Rate & Revenue real, rest fake).
7. **UI-only / entirely disconnected pages:** 3 — Payments, Smartphones, Settlement (zero `adminApi` calls in any of the three).
8. **Dead buttons/actions identified:** 10 — Trader detail "Reset password", Trader detail "Add balance", Merchant row-menu "Edit", Merchant row-menu "Set commission", Merchant detail "Set commission", Merchant "Activate/Deactivate" (local-only), Merchant "Regenerate API key" (fake), Smartphone "Force disconnect" (local-only), Settlement "Trigger manual settlement" (fake), Disputes "Mark reviewing" (local-only).
9. **Backend endpoints not reachable from Admin UI:** 8 — `DELETE /admin/traders/:id`, `GET /admin/settlements`, `POST /admin/settlements/trigger`, `GET /admin/smartphones`, `PUT /admin/smartphones/:id/disconnect`, `POST /orders/:id/cancel`, `POST /orders/:id/expire`, `POST /payment/manual` (plus 3 dead frontend-defined-but-uncalled methods: `createTrader`, `createMerchant`, `updateMerchant`).
10. **Critical risks found:** 5 — (1) mock-login-on-network-failure grants a visible (if data-empty) admin session with no credentials; (2) fake merchant API-key "regeneration" leaves a real leaked key live while the UI implies it's rotated; (3) fake smartphone "force disconnect" leaves a device live during a believed emergency response; (4) fake "trigger manual settlement" gives a definitive false success confirmation for a financial operation; (5) admin accounts with 2FA enabled cannot log in through this panel at all.
