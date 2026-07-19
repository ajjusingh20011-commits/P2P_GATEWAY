# Development TODO & Status — P2P UPI Gateway

A snapshot of what's done, what's incomplete, what's risky, and what to build next.
Status as analyzed from the codebase (no code changed during this analysis).

---

## ✅ What looks complete

- **Full backend API surface** — auth, orders/checkout, payment-detection engines,
  device/APK, trader, merchant, admin. See [API_MAP.md](API_MAP.md).
- **Auth** — JWT access+refresh, bcrypt hashing, optional TOTP 2FA, role guards.
  Trader & merchant panels do transparent token refresh.
- **Data model** — 15 Sequelize models with full relationships and a migration
  history (incl. the rate/margin system). See [DATABASE_MAP.md](DATABASE_MAP.md).
- **Order lifecycle** — routing engine (trader selection + locking), one-live-order-
  per-UPI safety, in-process 30s **expiry + retry-assign sweep** that works even
  without Redis.
- **Settlement math** — three-way USDT split (trader deduction / merchant settlement
  / platform revenue) recorded on each order + `balance_logs` ledger.
- **Real-time** — Socket.IO rooms and events wired to all panels + checkout.
- **Four frontends** — all build, navigate, and share one theme system; dark/light
  toggle; per-panel accents.
- **One-command dev** — `npm run dev` starts all 6 processes.

---

## 🟡 What looks incomplete / stubbed

| Item | Where | Notes |
|---|---|---|
| **Live exchange-rate fetch** | `services/rateService.js` (`TODO(live)`) | Uses a fixed/settings rate + `FALLBACK_RATE=100`; no live Binance-P2P pull. |
| **Real UPI acquirer** | `UPI_PROVIDER_*` env (empty) | No external payment provider wired; confirmation relies on the APK/manual engines. |
| **Trader "Smartphones" page** | `frontend/trader/pages/Smartphones.jsx` | Explicitly mock-only ("do not wire until an endpoint exists"). Model exists, flow doesn't. |
| **Automated tests** | `backend/tests/` = `.gitkeep` | Jest + supertest installed but no tests anywhere. |
| **Some admin pages** | admin Payments/Payouts/Settlement/Smartphones | Render mock/static data; not all wired to `adminApi`. |
| **Hard-coded 89 INR/USDT** | `traderController.requestPayout`, `settlementJob` | Bypass `rateService` — should use the real rate. |
| **`ngo-backend` scraper** | `ngo-backend/services/scraperEngine.js` | `scrapePlatform()` returns `[]` — separate, non-functional subsystem. Ignore for the gateway. |

---

## 🔴 What is risky or can bite you

1. **Background jobs are OFF on old Redis.** With Redis 3.0.504 (local), BullMQ is
   disabled, so **heartbeat-check** and **settlement** jobs do **not** run (only the
   in-process expiry+retry sweep does). Traders may not auto-go-offline; daily
   settlement won't auto-run (use `POST /api/admin/settlements/trigger` manually).
   → *Fix by using Redis ≥ 5, or add in-process fallbacks for those two jobs.*
2. **Frontends mask a down backend with mock data.** `useApi` + `utils/mock.js` show
   fake data on network error (trader `api.js` even mock-resolves requests). A page
   can *look* like it works while nothing is being saved. → *Add a visible "offline
   / demo data" banner, or disable mock mode outside development.*
3. **No rate limiting is actually mounted** despite the dependency + config. → *Add
   `express-rate-limit` to `app.js`, especially on `/auth/login` and `/orders/create`.*
4. **Shared demo password** (`Demo@12345`) on all accounts. Fine locally, **unsafe
   online**. → *Change/disable demo accounts before deploying.*
5. **Public customer endpoints** (`/orders/:id/*`) are guarded only by the order
   `uuid`. Acceptable, but keep the uuid unguessable and consider rate limits.
6. **`.env` vs `.env.example` drift** (`API_PREFIX`, `JWT_SECRET` vs
   `JWT_ACCESS_SECRET`) and **DB-name default mismatch**. Works now because `.env`
   is set; will confuse a fresh deploy. → *Align them.*
7. **Migrate/seed foot-gun.** `npm run migrate`/`seed` must be run **inside
   `backend/`** (they use `.sequelizerc`). The root-level `backend/migrations/` and
   `backend/seeders/seed.js` are legacy/empty — don't rely on them.
8. **Leftover debug `console.log`s** in `orderController.checkout`,
   `merchantController.createOrder`, `balanceService.settleOrder`. → *Remove for prod.*

---

## 🎯 What to build next (suggested priority)

### P0 — before any real use / deployment
- [ ] Move **heartbeat-check** and **settlement** to an in-process fallback (like the
      expiry sweep) **or** provision Redis ≥ 5 so BullMQ runs.
- [ ] Mount **rate limiting** on auth + order-create.
- [ ] **Change/disable demo accounts**; generate strong per-env secrets.
- [ ] Add a **"demo/offline data" banner** (or gate mock mode to `import.meta.env.DEV`).
- [ ] Align `.env`/`.env.example` and pin `DB_NAME` explicitly.
- [ ] Remove debug `console.log`s.

### P1 — correctness & trust
- [ ] Replace hard-coded `89` rate in payout/settlement with `rateService`.
- [ ] Add a **smoke test suite** (login → create order → checkout → confirm → settle)
      with jest + supertest.
- [ ] Wire the admin pages that still show mock data (Payments/Payouts/Settlement).
- [ ] Decide the "Smartphones" feature: build the endpoint or hide the page.

### P2 — product depth
- [ ] Implement **live exchange-rate** fetch (or a proper admin-set rate workflow).
- [ ] Integrate a real **UPI acquirer / webhook-in** if moving beyond APK detection.
- [ ] Add **payout processing** flow (currently request-only).
- [ ] Observability: request logging IDs, error monitoring, `/metrics`.

---

## Quick reference

- Overview & run steps → [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
- All endpoints → [API_MAP.md](API_MAP.md)
- Tables & relationships → [DATABASE_MAP.md](DATABASE_MAP.md)
- Demo logins: `admin@p2p.com` / `trader1@p2p.com` / `merchant@p2p.com`, password
  `Demo@12345` (checkout has no login).
