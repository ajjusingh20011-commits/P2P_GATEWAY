# P2P UPI Payment Gateway — Project Overview

A beginner-friendly map of the whole project. Read this first, then dive into
[API_MAP.md](API_MAP.md), [DATABASE_MAP.md](DATABASE_MAP.md), and
[DEVELOPMENT_TODO.md](DEVELOPMENT_TODO.md).

---

## 1. What this project is (in one paragraph)

This is a **P2P (peer-to-peer) UPI payment gateway**. A **merchant** (an online shop)
wants to collect ₹ from customers. Instead of a bank, the platform routes each
payment to a **trader** — a real person who owns UPI accounts (GPay/PhonePe/etc.).
The customer pays the trader's UPI, the trader's phone detects the incoming money,
the order is confirmed, and the platform settles the value in **USDT** (a crypto
stablecoin) between trader, merchant, and platform. There are **four web panels**
(Admin, Trader, Merchant, Checkout) and one **backend API** that ties it all together.

---

## 2. Folder structure

```
p2p-upi-gateway/
├─ backend/                  ← Node.js + Express API (the brain). Port 4000.
│  ├─ src/
│  │  ├─ server.js           ← Starts the HTTP + WebSocket server (entry point)
│  │  ├─ app.js              ← Builds the Express app (middleware + mounts routes)
│  │  ├─ config/             ← Reads .env into a settings object; CLI DB config
│  │  ├─ loaders/            ← Connect MySQL (database.js) and Redis (redis.js)
│  │  ├─ routes/             ← URL definitions (which URL → which controller)
│  │  ├─ controllers/        ← Handle each request (validate, respond)
│  │  ├─ services/           ← Business logic (routing, rates, balances, auth…)
│  │  ├─ middleware/         ← Auth guards + error handling
│  │  ├─ models/             ← Database tables as Sequelize models
│  │  ├─ migrations/         ← Versioned scripts that BUILD the DB schema
│  │  ├─ seeders/            ← Insert demo accounts/data
│  │  ├─ jobs/               ← Background tasks (expiry, settlement, webhooks)
│  │  ├─ websocket/          ← Real-time events (Socket.IO)
│  │  └─ utils/              ← Small helpers (logger, response helpers, id gen)
│  ├─ .env                   ← REAL secrets (DB, JWT). NEVER commit this.
│  └─ package.json           ← Backend scripts: dev, worker, migrate, seed
│
├─ frontend/                 ← Four separate React (Vite) apps
│  ├─ admin/     (port 5173) ← Platform operator console (red theme)
│  ├─ trader/    (port 5174) ← Trader dashboard (teal theme)
│  ├─ merchant/  (port 5175) ← Merchant dashboard (purple theme)
│  └─ checkout/  (port 5176) ← Customer payment page (teal, no login)
│
├─ ngo-backend/              ← SEPARATE, unrelated scraper service (MongoDB +
│                              Puppeteer). NOT part of the gateway. Ignore it.
│
└─ package.json              ← Root: `npm run dev` starts all 6 processes at once
```

**Which folder is what:**
- **Frontend:** `frontend/*`
- **Backend / API:** `backend/src/routes` + `backend/src/controllers`
- **Business logic:** `backend/src/services`
- **Database:** `backend/src/models` + `backend/src/migrations` + `backend/src/loaders/database.js`
- **Config:** `backend/src/config` + `.env` files
- **Auth:** `backend/src/services/authService.js` + `backend/src/middleware/auth.js`
- **Payment logic:** `backend/src/services/{routingEngine,smartMerge,rateService,balanceService,upiService}.js`
- **Admin logic:** `backend/src/controllers/adminController.js`
- **Utils:** `backend/src/utils`

---

## 3. Most important files (and which to treat carefully)

| File | What it does | Careful? |
|---|---|---|
| `backend/src/server.js` | Boots DB, Redis, WebSocket, and the 30s in-process order sweep. | ⚠️ Yes |
| `backend/src/app.js` | Wires middleware + mounts every route group under `/api`. | ⚠️ Yes |
| `backend/src/config/index.js` | Central settings from `.env` (port, DB, JWT, rates, expiry). | ⚠️ Yes |
| `backend/src/services/routingEngine.js` | Picks which trader/UPI gets an order; locks it. | 🚫 Don't touch without understanding |
| `backend/src/services/smartMerge.js` | Merges payment signals, decides when to auto-confirm. | 🚫 Don't touch without understanding |
| `backend/src/services/rateService.js` | INR↔USDT rate + all margin/fee math. | 🚫 Don't touch without understanding |
| `backend/src/services/balanceService.js` | Moves USDT between trader/merchant/platform on confirm. | 🚫 Don't touch without understanding |
| `backend/src/models/*.model.js` | Your database tables. Changing = a migration. | ⚠️ Yes |
| `backend/src/migrations/*` | The real DB schema history. | ⚠️ Yes |
| `backend/.env` | Real secrets. | 🚫 Never commit |
| `frontend/*/src/services/api.js` | Where each panel calls the backend + base URL. | ⚠️ Yes |
| `frontend/checkout/src/pages/CheckoutPage.jsx` | The live customer payment flow. | 🚫 Payment logic — careful |

---

## 4. Backend flow (how a request travels)

```
Browser / APK
   │  HTTP request e.g. GET /api/trader/dashboard  (+ Bearer token)
   ▼
server.js  → app.js (Express)
   │  middleware: helmet → cors → compression → json body → morgan logs
   ▼
routes/traderRoutes.js   (matches the URL, applies auth guard)
   ▼
middleware/auth.js  (verifyToken + checkRole('trader'))
   ▼
controllers/traderController.js  (validate input, call services)
   ▼
services/*  (routingEngine / rateService / balanceService / …)
   ▼
models/*  (Sequelize) → MySQL
   ▼
response  { success: true, data: {...} }   ← the standard envelope
```

- **Framework:** Express 4 (REST) + Socket.IO (real-time) + Sequelize (MySQL ORM).
- **Auth styles:** JWT Bearer (panels), API key/secret (merchant server-to-server),
  device token (the trader's Android APK).
- **Standard response:** every endpoint returns `{ success, data }` (or `{ success:false, message }`).
- **Full endpoint list:** see **[API_MAP.md](API_MAP.md)**.

---

## 5. Frontend flow

All three staff panels (admin/trader/merchant) share the same shape:

```
main.jsx → App.jsx
   → AuthProvider (holds user + token in localStorage)
   → BrowserRouter
       /login          → Login page (sends {email, password, role})
       ProtectedRoute  → Layout (sidebar + header) → nested pages
```

- **Where API base URL is set:** `frontend/*/src/services/api.js`, value
  `import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'`.
  Real-time uses `VITE_WS_URL || 'http://localhost:4000'`.
- **Pages per panel:**
  - **Admin (5173):** Dashboard, Traders, Merchants, Orders, Payments, Payouts,
    Disputes, Smartphones, Settlement, Settings.
  - **Trader (5174):** Dashboard, Trades ("Sell USDT"), Offers (UPI details),
    Payouts, Notifications, Smartphones, Settings.
  - **Merchant (5175):** Dashboard, Orders, Transactions, Balance,
    ApiCredentials, Webhooks, Profile.
  - **Checkout (5176):** one public page, no login (opens via a checkout URL).
- **Which API each page calls:** see the per-panel tables in **[API_MAP.md](API_MAP.md)**.
- **Design system:** a shared `.tf-scope` CSS-variable theme (light default +
  dark toggle stored in `localStorage['panel-theme']`). Each panel has one accent
  color — admin red `#ef4444`, trader teal `#14b8c4`, merchant purple `#8b5cf6`,
  checkout teal.
- **Heads-up (important):** the panels ship **mock data** as an offline fallback
  (`utils/mock.js` + `hooks/useApi.js`). If the backend is down, pages still show
  fake data instead of an error. Don't mistake mock data for real, saved data.

---

## 6. The full P2P payment flow (step by step)

```
1. Merchant creates an order
   • Merchant panel "create order" OR server-to-server POST /api/orders/create (API key)
   • File: merchantController.createOrder / orderController.create

2. Platform checks availability BEFORE creating anything
   • routingEngine.findAvailableTrader(amount)
   • Needs: a trader online + USDT balance + active + an eligible UPI that is
     free (one live order per UPI). If none → "P2P unavailable" (HTTP 503).

3. Order is created and ASSIGNED to a trader + UPI
   • routingEngine.assignTraderToOrder(order) locks the trader (Redis or memory)
   • Order status: new → assigned. A checkout URL is returned.

4. Customer opens the checkout page
   • frontend/checkout → GET /api/orders/:id/checkout (UPI id, QR, amount, timer)
   • Customer pays that UPI from their own phone.

5. Payment is detected (4 possible "engines")
   • Trader's Android APK posts to /api/payment/{sms|notification|screen} OR
     the trader manually confirms (/api/payment/manual).
   • File: paymentController.ingest → smartMerge.mergePaymentData
   • smartMerge scores confidence; ≥85 auto-confirms. Customer can also press
     "I've paid" (+ UTR) → status becomes 'paid'.

6. Confirmation + settlement
   • smartMerge.confirmOrder → balanceService.settleOrder:
       - deduct USDT from trader   (amount ÷ trader_rate)
       - credit USDT to merchant   (amount ÷ admin_rate)
       - add the difference to platform_revenue_usdt
   • Order status → confirmed, breakdown saved on the order row.

7. Status updates + webhook/callback
   • Socket.IO emits order:confirmed to merchant/trader/checkout in real time.
   • webhookService.sendWebhook posts 'order.confirmed' to the merchant's
     webhook_url (HMAC-signed). Delivered via BullMQ (if Redis≥5) or directly.

8. Expiry (if the customer never pays)
   • Order past expires_at → jobs/orderExpiry.checkExpiredOrders demotes it to
     'expired' and RELEASES the trader/UPI. Runs in-process every 30s (works
     without Redis) — this is what frees a UPI for the next customer.
```

---

## 7. Environment / config (`.env`)

Full masked catalog is in [DATABASE_MAP.md](DATABASE_MAP.md) and the code, but the
essentials in `backend/.env`:

| Group | Variables | Required? | Notes |
|---|---|---|---|
| **Database** | `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` `DB_DIALECT` | **Yes** | MySQL. `DB_PASSWORD` is blank for local XAMPP. `DB_NAME=p2p_gateway`. |
| **Auth / JWT** | `JWT_SECRET` `JWT_REFRESH_SECRET` `JWT_ACCESS_EXPIRES_IN` `JWT_REFRESH_EXPIRES_IN` `BCRYPT_SALT_ROUNDS` | **Yes** (secrets) | Signs login tokens. Keep secret. |
| **Redis** | `REDIS_HOST` `REDIS_PORT` `REDIS_PASSWORD` `REDIS_DB` | Optional | For background jobs + locks. App runs without it. |
| **Platform** | `PORT` `NODE_ENV` `ORDER_EXPIRY_MINUTES` `PLATFORM_FEE_PERCENT` `DEFAULT_EXCHANGE_RATE` | No (defaults) | Business tuning. Port 4000, expiry 10 min. |
| **Frontend URLs / CORS** | `FRONTEND_ADMIN_URL` etc. | No | Used for CORS + checkout links. |
| **Payment provider** | `UPI_PROVIDER_*` | No | **Empty placeholders** — no real acquirer wired yet. |
| **Notify** | `TELEGRAM_BOT_TOKEN` `TELEGRAM_ADMIN_CHAT_ID` | No | Empty; Telegram alerts are optional. |
| **Frontend (each app)** | `VITE_API_BASE_URL` `VITE_WS_URL` `VITE_APP_NAME` | No (defaults) | Point the panels at the backend. |

⚠️ `.env` vs `.env.example` drift a little (`API_PREFIX`, `JWT_SECRET` vs
`JWT_ACCESS_SECRET`) — the code accepts both, but keep them aligned when deploying.

---

## 8. Run / deploy locally

**Services you need running first:**
- **MySQL** on port 3306 (XAMPP is fine), database `p2p_gateway` created.
- **Redis** — *optional*. Your local Redis 3.0.504 is too old for background jobs,
  so heartbeat + settlement jobs won't run, but the core order flow still works
  because of the in-process 30s sweep. (A modern Redis ≥5 enables full jobs.)

**Commands (from the repo root unless noted):**
```bash
# 1. Install everything (root + all workspaces)
npm run install:all

# 2. Set up the database (run inside backend/)
cd backend
npm run migrate       # builds all tables (uses src/migrations via .sequelizerc)
npm run seed          # creates demo accounts
cd ..

# 3. Start ALL 6 processes (api + worker + 4 frontends)
npm run dev
```

**Demo logins (all panels, password `Demo@12345`):**
- Admin: `admin@p2p.com` · Trader: `trader1@p2p.com` · Merchant: `merchant@p2p.com`
- Checkout has no login (opens from a merchant-created order's checkout URL).

**Common errors you may hit:**
- *"P2P is unavailable / no payment provider"* → no trader online, or the trader's
  only UPI is busy/expired-but-stuck. The 30s sweep frees stuck UPIs; make sure a
  trader is online with a free UPI.
- *"Redis too old / background jobs disabled"* → expected with Redis 3.x; safe locally.
- *500 on login* → MySQL not running or wrong `DB_NAME`/password in `.env`.
- *Port already in use* → another process on 4000/5173–5176; stop it or change the port.
- *`npm run migrate` finds nothing* → make sure you run it **inside `backend/`**
  (it uses `.sequelizerc` → `src/migrations`).

---

## 9. Current completion status (short version)

- ✅ **Working:** full API surface, auth + JWT refresh, order routing + expiry,
  four panels build & navigate, Redis-optional design, one-command dev startup.
- 🟡 **Incomplete:** no automated tests, live exchange-rate fetch is a TODO (uses a
  fixed rate), no real UPI acquirer wired, trader "Smartphones" is mock-only.
- 🔴 **Risky:** background jobs (heartbeat, settlement) silently don't run on old
  Redis; frontends mask a down backend with mock data; demo passwords are shared.

Full breakdown + "what to build next" is in **[DEVELOPMENT_TODO.md](DEVELOPMENT_TODO.md)**.
