# P2P UPI Payment Gateway

A peer-to-peer UPI payment gateway. A merchant creates an order via API; the platform
routes it to an eligible **trader** who owns a real UPI account; the customer pays that
UPI directly; the payment is detected on the trader's own Android phone (or by a web
scraper against the trader's bank/PSP dashboard) and the order is auto-settled in USDT.

There is no acquirer/PSP integration — settlement confidence comes entirely from
receiver-side detection (SMS, app notification, on-screen accessibility capture, or
scraped dashboard transaction).

> **Origins matter for reading this codebase.** The second service is literally named
> `ngo-backend` and still contains `NGO`, `Campaign`, `Ledger`, and donation-webhook
> models. That was the original product: donation tracking for NGOs. The system has since
> been reworked to be **trader-centric** — `traderId` is the real ownership/authorization
> boundary everywhere that matters, and `ngoId` is a deprecated-but-still-load-bearing
> legacy column (see [Per-trader isolation](#per-trader-isolation)). Don't assume anything
> named "ngo" is dead, and don't assume it's current either — check which of the two
> matching paths it feeds.

---

## Table of contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Running locally](#running-locally)
- [Key architectural concepts](#key-architectural-concepts)
- [Deployment](#deployment)
- [Known limitations and open items](#known-limitations-and-open-items)
- [Other documentation in this repo](#other-documentation-in-this-repo)

---

## Architecture

### Two backends, two databases

| | `backend/` | `ngo-backend/` |
|---|---|---|
| Port | **4000** | **3000** |
| Database | **MySQL/MariaDB** via Sequelize | **MongoDB** via Mongoose |
| Cache/queues | Redis + BullMQ (optional) | none |
| Owns | orders, traders, merchants, admins, payment details, settlements, payouts, balances, disputes | trader payment *accounts*, paired Android devices, raw capture events, web-scraper sessions, legacy donation ledger |
| Entry point | `backend/src/server.js` → `src/app.js` | `ngo-backend/server.js` |
| Real-time | Socket.IO (rooms: trader/merchant/admin/order) | Socket.IO (room: `trader:<id>`) |

They are **not** a shared-login system. Neither service can authenticate the other's users.
They talk over two narrow, deliberate channels:

**1. Signed service tokens (trader-scoped, request-level).**
The trader panel never calls `ngo-backend` directly for REST. It calls
`backend/`'s relay at `/api/trader/ngo-proxy/*` using its own normal trader access token.
`backend/` mints a fresh **5-minute HS256 JWT** per call
([`services/ngoServiceAuth.js`](backend/src/services/ngoServiceAuth.js)) containing only
`{ trader_id, type: 'service' }`, signed with a **`SERVICE_AUTH_SECRET` that must be
byte-identical in both `.env` files**, with `issuer: 'p2p-backend'` / `audience:
'ngo-backend'`. It forwards the request verbatim with an `X-Service-Token` header.
`ngo-backend` verifies it in
[`middleware/serviceAuth.js`](ngo-backend/src/middleware/serviceAuth.js) and derives
`req.traderId` from the token — never from anything the client sent.

The same token type authenticates the trader panel's **direct** Socket.IO connection to
`ngo-backend` (`GET /api/trader/ngo-socket-token`, verified in `ngo-backend/server.js`'s
handshake), so the room a client lands in is server-decided.

This replaced an older shared `ngo_staff` human login; that login no longer has a path
into trader-owned data.

**2. Unauthenticated internal endpoints (private-network trust).**
- `ngo-backend` → `backend` `POST /api/internal/match-settlement` — every receiver-side
  payment event triggers order matching/settlement.
- `ngo-backend` → `backend` `GET /api/internal/upi-check` — UPI uniqueness across both DBs.
- `backend` → `ngo-backend` `POST /api/checkout/verify` — the reverse direction.

These have **no auth** by design (both services assumed to be on a private network) and are
configured via `NGO_BACKEND_URL` / `P2P_BACKEND_URL`. See
[Known limitations](#known-limitations-and-open-items) — this is only safe if they aren't
publicly reachable.

### Frontends

Four React 18 + Vite + Tailwind SPAs, each with its own `package.json`, `.env`, and dev
server that proxies `/api/` and `/socket.io` to `localhost:4000`:

| Panel | Path | Port | Auth |
|---|---|---|---|
| Admin | `frontend/admin/` | 5173 | JWT (role `admin`) |
| Trader | `frontend/trader/` | 5174 | JWT (role `trader`) — also reaches `ngo-backend` via the proxy |
| Merchant | `frontend/merchant/` | 5175 | JWT (role `merchant`) |
| Checkout | `frontend/checkout/` | 5176 | none — guarded by the order UUID |

There is a **fifth, legacy** SPA at `frontend/src/` (the original "NGO Dashboard",
`frontend/package.json` / `frontend/vite.config.js`). It talks directly to `ngo-backend`
on port 3000 with the old human-login model. It is **not** started by the root
`npm run dev`, and its Vite config claims **port 5175 — the same port as the merchant
panel**, so the two cannot run at once. Treat it as legacy unless you have a specific
reason to run it.

### Android APK

`apk/` — a **Java-only** (no Kotlin) Android client, package `com.example.paymentbot`,
minSdk 24 / target+compile SDK 34. It runs on the trader's own phone and talks **only to
`ngo-backend` (port 3000)** — `apk/app/src/main/java/com/example/paymentbot/Config.java`
holds the single `SERVER_BASE_URL`.

Three independent detection engines feed a merger:

| Engine | Component | Signal |
|---|---|---|
| SMS | `SMSReceiver` (BroadcastReceiver) | bank/UPI SMS alerts |
| Notification | `NotificationService` (NotificationListenerService) | UPI app notifications |
| Screen | `PaymentBotService` (AccessibilityService) | on-screen text in UPI apps |

Captured events go through an **offline-first queue** (`EventQueue` → Room DB →
`EventUploadWorker`), so a capture on a phone with no signal is delivered on reconnect.
Device pairing uses a short-lived pairing code generated by the trader panel
(`POST /api/apk/register-device`); the device then presents a `deviceToken` header on
every event.

> Note: `backend/` *also* has a device/payment ingest surface (`/api/device/*`,
> `/api/payment/*`, `X-Device-Token`, the `Smartphone` model, `smartMerge.js`). The
> shipping APK does **not** use it — it posts to `ngo-backend/api/apk/*`. Both paths exist
> in the codebase.

### End-to-end payment flow

```
Merchant server ──POST /api/orders/create (X-API-Key + X-API-Secret)──▶ backend:4000
                                                                          │
                                        routingEngine picks trader + UPI  │
                                                                          ▼
Customer ◀──── checkout page (frontend/checkout, order UUID) ──── order (pending)
   │
   │ pays the UPI directly from their own app
   ▼
Trader's phone (APK)  ──event──▶ ngo-backend:3000  /api/apk/event
   or web scraper     ──txn───▶  (RawEvent / Transaction persisted)
                                          │
                                          │ POST /api/internal/match-settlement
                                          ▼
                                    backend matchingEngineV2
                                    → find open order by {upi_ids, amount}
                                    → assign match tier 0/1/2
                                    → smartMerge.confirmOrder
                                    → balances, settlement rows, webhook,
                                      Socket.IO push to trader/merchant/admin
```

---

## Repository layout

Walked from the actual tree (`node_modules/`, `dist/`, `build/` omitted).

```
p2p-upi-gateway/
├── backend/                     # MySQL service, port 4000
│   ├── .sequelizerc             # points sequelize-cli at src/ — see gotchas
│   ├── src/
│   │   ├── server.js            # HTTP+WS entrypoint, boot policy, in-process sweep
│   │   ├── app.js               # express app: middleware + route mounting
│   │   ├── config/
│   │   │   ├── index.js         # all env → config object
│   │   │   └── database.js      # sequelize-cli config (migrations/seeders)
│   │   ├── loaders/             # database.js, redis.js (connection + health)
│   │   ├── middleware/          # auth.js (JWT), apiKeyAuth.js, deviceAuth.js, errorHandler.js
│   │   ├── routes/              # auth, orders, payment, device, trader, merchant,
│   │   │                        #   admin, payout, internal  (index.js is DEAD — unmounted)
│   │   ├── controllers/         # one per route group + ngoProxyController.js
│   │   ├── services/            # see "Key concepts" — matchingEngineV2, routingEngine,
│   │   │                        #   smartMerge, rateService, balanceService, payoutService,
│   │   │                        #   ngoServiceAuth, webhookService, telegramService, …
│   │   ├── models/              # 16 Sequelize models (index.js wires associations)
│   │   ├── migrations/          # 36 Sequelize migrations (the real ones)
│   │   ├── seeders/             # demo-users, demo-test-seed, reset-demo
│   │   ├── jobs/                # BullMQ queues + worker.js + job implementations
│   │   │   ├── queues/          # EMPTY
│   │   │   └── workers/         # EMPTY
│   │   ├── websocket/index.js   # Socket.IO rooms + emit helpers
│   │   ├── validators/          # EMPTY
│   │   └── utils/               # logger, http, ids, utrValidation
│   ├── migrations/              # EMPTY (.gitkeep) — legacy, do not use
│   ├── seeders/seed.js          # legacy standalone seeder — see gotchas
│   └── tests/                   # EMPTY (.gitkeep) — Jest+supertest installed, no tests
│
├── ngo-backend/                 # MongoDB service, port 3000
│   ├── server.js                # entrypoint: CORS, Socket.IO, route mounting, shutdown
│   ├── src/
│   │   ├── config/              # database.js (Mongoose), constants.js (ROLES, statuses)
│   │   ├── middleware/          # auth.js (JWT), serviceAuth.js (X-Service-Token), errorHandler.js
│   │   ├── models/              # Account, Device, Transaction, RawEvent, DebitSMS,
│   │   │                        #   OverlayCapture, OutgoingPayment, CrashLog, Payout,
│   │   │                        #   Webhook, Verification, User, NGO, Campaign, Ledger
│   │   ├── routes/              # apk.js (largest — device pairing + all ingest),
│   │   │                        #   ngo.js (trader accounts/devices/txns), auth, admin,
│   │   │                        #   merchant, checkout, public, webhook, internal
│   │   ├── services/            # matchingEngine (legacy donation + settlement trigger),
│   │   │                        #   webScraper, scraperEngine, proxyManager, SessionStore,
│   │   │                        #   ledgerService, payoutVerifier, ngoService, authService
│   │   └── utils/               # encryption, hashChain, timeHelper, upiUniqueness
│   ├── scripts/test-web-login.js
│   └── fix*.js, test-*.js, try-apis.js, …   # ~15 committed one-off dev scripts
│
├── frontend/
│   ├── admin/     src/{pages,components,services,hooks,layouts,routes,context,store,utils}
│   ├── trader/    same shape + src/lib/ngoApi.js (the ngo-proxy client)
│   ├── merchant/  same shape
│   ├── checkout/  src/pages/CheckoutPage.jsx (single page)
│   └── src/       LEGACY standalone NGO dashboard (see Architecture)
│
├── apk/                         # Java Android client (Gradle Kotlin DSL, JDK 17)
│   └── app/src/main/java/com/example/paymentbot/   # 44 .java files
│
├── deploy/
│   ├── bootstrap-production.sh  # idempotent env/secret/migration bootstrap
│   ├── verify-deploy.sh         # proves the NEW code is actually serving traffic
│   ├── nginx/adminmaxedge.com.conf
│   ├── PRODUCTION_BOOTSTRAP.md
│   └── PHASE2_RUNBOOK.md        # HTTPS/certbot cutover
│
├── docs/                        # EMPTY (.gitkeep) — real docs live at the root
└── package.json                 # monorepo dev orchestration (concurrently)
```

---

## Running locally

### Prerequisites

- **Node.js 18+**
- **MySQL 8+ / MariaDB ≥ 10.2** — the hard floor is real: two migrations create a
  `VIRTUAL GENERATED` column with a `UNIQUE` index (MariaDB 10.2 / MySQL 5.7+). Dev was
  verified on MariaDB 10.4.32.
- **MongoDB 4.4+** — no transactions anywhere, so a replica set is *not* required.
- **Redis ≥ 5** — optional but strongly recommended. BullMQ hard-requires ≥5; below that
  the heartbeat-check and daily settlement jobs silently do not run.
- **Android Studio + JDK 17** (only for `apk/`)
- **Chromium/Playwright** (only if you exercise `ngo-backend`'s web scraper)

### Order of startup

1. MySQL, MongoDB, Redis
2. `backend/` API (4000) — creates/uses `p2p_upi_gateway`
3. `backend/` worker (BullMQ) — separate process
4. `ngo-backend/` (3000)
5. Frontends

### Setup

```bash
# 1. Install everything (root + backend + 4 panels)
npm run install:all
npm --prefix ngo-backend install        # not covered by install:all

# 2. Env files
cp backend/.env.example      backend/.env
cp ngo-backend/.env.example  ngo-backend/.env
for p in admin trader merchant checkout; do
  cp frontend/$p/.env.example frontend/$p/.env
done

# 3. Create the MySQL database, then migrate — MUST be run from inside backend/
cd backend && npm run migrate && cd ..

# 4. (optional) demo data — see the warning below
cd backend && npm run seed && cd ..

# 5. Start backend API + worker + all 4 panels in one command
npm run dev

# 6. ngo-backend, separately (not part of npm run dev)
npm --prefix ngo-backend run dev
```

`npm run dev` runs six processes: `api`, `worker`, `admin`, `trader`, `merchant`,
`checkout`. Subsets: `npm run dev:backend`, `npm run dev:frontends`.

### Required environment variables

**`backend/.env`** — the bootstrap script treats these as mandatory:

```
NODE_ENV PORT
DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
REDIS_HOST REDIS_PORT
JWT_ACCESS_SECRET JWT_REFRESH_SECRET
SERVICE_AUTH_SECRET          # MUST equal ngo-backend's
NGO_BACKEND_URL              # http://localhost:3000
CORS_ORIGINS WS_CORS_ORIGINS
```

Also read by code but absent from `.env.example`: `SERVICE_AUTH_SECRET`,
`NGO_BACKEND_URL`, `CORS_ORIGINS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`.

**`ngo-backend/.env`**:

```
NODE_ENV PORT
MONGODB_URL
JWT_SECRET ENCRYPTION_KEY
SERVICE_AUTH_SECRET          # MUST equal backend's
P2P_BACKEND_URL              # http://localhost:4000
CORS_ORIGINS
# scraper: PROXY_USERNAME PROXY_PASSWORD PROXY_POOL SCRAPER_HEADLESS
# APK auto-update: APK_LATEST_VERSION_CODE APK_LATEST_VERSION_NAME APK_DOWNLOAD_URL
# donation checkout: CHECKOUT_BASE_URL
```

**Frontend `.env`** (Vite, so `VITE_` prefix is required):
`VITE_API_BASE_URL`, `VITE_WS_URL`; the trader panel additionally needs
`VITE_NGO_API_BASE_URL` (socket origin for `ngo-backend`) and `VITE_APK_DOWNLOAD_URL`.

### Common gotchas

**1. `NODE_ENV` decides *which env file is read* — and getting it wrong crash-loops
`ngo-backend`.** Both entrypoints do the same conditional load:

```js
require('dotenv').config({ path: process.env.NODE_ENV === 'production' ? '.env' : '.env.local' });
```

`NODE_ENV` must already be set **in the process environment** before the app starts —
`npm start` does this via `cross-env`. If a process manager runs `node server.js`
directly without `NODE_ENV=production`, it silently reads `.env.local` instead. For
`backend/` that degrades quietly (`src/config/index.js` then fills gaps from `.env`
because `dotenv` never overwrites an already-set var). For **`ngo-backend/` it is fatal**:
no `.env.local` on a production box means no `MONGODB_URL`, `connectDB()` throws,
`process.exit(1)`, and the process manager restarts it forever. Note the chicken-and-egg:
putting `NODE_ENV=production` *inside* `ngo-backend/.env` does not help, because that file
is only read once `NODE_ENV` is already `production`.

**2. Migrations can target a different database than the app.** `backend/src/config/database.js`
(used by `sequelize-cli`) calls bare `require('dotenv').config()` — it reads **`.env` only,
never `.env.local`**, regardless of `NODE_ENV`. The running app in dev reads `.env.local`.
If those two files disagree on `DB_NAME`/`DB_HOST`/`DB_PORT`, you will migrate one database
and run against another. The defaults also drift: `config/index.js` defaults `DB_NAME` to
`p2p_upi_gateway`, `config/database.js` defaults it to `p2p_gateway`.

**3. Two MySQL instances on the same box.** A very common local trap on Windows: a XAMPP
MySQL and a standalone MySQL/MariaDB service both want port 3306, and you end up migrating
one while the app connects to the other (or the wrong one wins on boot and the schema looks
empty). `backend/src/config/database.js` even carries a comment defaulting the password to
empty "for XAMPP/local MySQL". Before debugging anything schema-shaped, confirm exactly one
server is listening and that it's the one holding your data:

```bash
# Windows
netstat -ano | findstr :3306
sc query | findstr /i mysql
mysql -h 127.0.0.1 -P 3306 -u root -p -e "SELECT VERSION(), @@port, @@datadir;"
```

Then confirm the table count matches what `SequelizeMeta` says you migrated.

**4. Run `npm run migrate` / `npm run seed` from inside `backend/`.** They depend on
`backend/.sequelizerc`, which redirects sequelize-cli to `src/migrations` and
`src/seeders`. The root-level `backend/migrations/` is an empty `.gitkeep` placeholder, and
`backend/seeders/seed.js` is a separate legacy script — neither is what you want.

**5. The demo seeder inserts publicly-known credentials.** `backend/src/seeders/` creates
`admin@p2p.com`, `trader1@p2p.com`, `trader2@p2p.com`, `merchant@p2p.com` with hardcoded
passwords that are in git history. It is a no-op if `admin@p2p.com` already exists. Never
run it on a box you intend to expose, and rotate immediately if you do.

**6. Frontends mask a down backend with mock data.** `useApi` + `src/utils/mock.js` fall
back to fake data on network error (the trader panel's `api.js` will even mock-resolve
requests). A page can look fully functional while nothing is being persisted. If data
"saves" but never appears in the DB, check this first.

**7. Redis is optional but the fallbacks aren't equivalent.** Without Redis, `backend/`
still boots: locks fall back to an in-memory `Map`, and an in-process 30s sweep handles
order expiry. But **heartbeat-check and daily settlement do not run at all** — traders can
stay marked online after going offline, and settlement must be fired manually via
`POST /api/admin/settlements/trigger`. `GET /api/health` reports both MySQL and Redis
status.

**8. The merchant panel and the legacy NGO dashboard both claim port 5175.** Only one can
run. `npm run dev` starts the merchant panel.

---

## Key architectural concepts

### Per-trader isolation

`traderId` — the **MySQL `traders.id`**, carried as a plain number into MongoDB — is the
real ownership boundary across both databases. Nothing derives authorization from an
`ngoId` anymore.

- `ngo-backend`'s `Account`, `Device`, `Transaction` are all scoped by `traderId`.
- `middleware/serviceAuth.js` sets `req.traderId` **only** from a verified service token,
  and `resolveTraderFilter(req)` never returns an unfiltered `{}` unless the caller is a
  verified admin. A trader-service call always gets exactly `{ traderId: <their own id> }`.
- `requireTraderId(req, res)` gates writes: a record can only be created under a real
  trader-authenticated request.

`ngoId` is **deprecated but not dead** — `ngo-backend/src/models/Device.js` documents this
explicitly. `routes/apk.js` still stamps it onto `RawEvent` and copies it onto
`DebitSMS`/`OverlayCapture`/`OutgoingPayment`, because the legacy donation-ledger matching
path (`matchingEngine.checkMatch`) and `payoutVerifier.js` still read it. It cannot be
dropped until those are retired or rekeyed.

The legacy NGO-org + `ngo_staff` model survives only behind `GET /api/ngo/ledger` and
`GET /api/ngo/stats`, which are confirmed unreachable from the trader frontend.

### The two matching engines

These are **separate systems that both run**, and confusing them is the single easiest
mistake to make in this codebase.

**`ngo-backend/src/services/matchingEngine.js` — legacy donation matching.**
`checkMatch()` reconciles a scraped `Transaction` against a donor `Webhook` (a donor who
clicked "I've paid"). It requires *both* to exist. Feeds the NGO donation ledger only.

**`backend/src/services/matchingEngineV2.js` — P2P order settlement.** Reached via
`POST /api/internal/match-settlement`, triggered from `ngo-backend` by
`triggerOrderSettlementFromRawEvent` (APK events) and
`triggerOrderSettlementFromTransaction` (scraper). It treats each receiver-side event as
sufficient on its own — no donor-webhook prerequisite. That was the point of v2: a payment
reported only by an APK notification, with no scraper running, previously never settled.

**Which UPIs it matches on.** The scraper knows the exact receiving account and sends
`upi_ids`. The APK path can't — a `Device` belongs to a trader, not to one account — so it
sends `trader_id`, and `upiIdsForTrader()` expands it from `payment_details` on the gateway
side. It used to expand it on the `ngo-backend` side from the Mongo `Account` collection,
which holds **Web Login accounts only**: an APK-linked UPI has no `Account` document, so
those payments were matched against the wrong UPI set (or an empty one, for a pure-APK
trader) and never settled. `payment_details` lives in the gateway's MySQL database, so the
gateway is the only side that can answer this correctly.

It finds every open order (`ACTIVE_STATUSES` = `pending`, `checkout_open`, `claimed_paid`,
`under_review`) matching `{upi_id ∈ upiIds, amount_inr = amount}`, then
`pickClosestByTime()` disambiguates by whichever order's `created_at` is nearest the event
timestamp — never a first-found match.

**Match tiers.** All three settle immediately; they differ only in trust and audit trail:

| Tier | Condition | Side effect |
|---|---|---|
| **0** `EXACT_UTR` | receiver-side UTR == `order.donor_submitted_utr` | — |
| **1** `UTR_MISMATCH` | receiver-side UTR present, but missing/different from the donor's | writes a `utr_discrepancy_logs` row for review, logs a warning |
| **2** `AMOUNT_ONLY` | no receiver-side UTR at all (notification-only sources) | amount + trader + time-window match only |

The tier is persisted on `order.match_tier`. UTR reuse is blocked twice: an app-level
pre-check, plus a `settled_utr_lock_key` generated-column unique index as the DB backstop
if that races.

### Confidence scoring (`smartMerge`)

Independent of the tiers above. `backend/src/services/smartMerge.js` scores the combined
APK engine signals and auto-confirms at **≥ 85**:

| Signal | Score |
|---|---|
| screen scraper (accessibility) | 100 → auto-confirm |
| notification + SMS | 85 → auto-confirm |
| notification only | 60 → wait/manual |
| SMS only | 40 → wait for more |
| manual trader override | 100 |

Guards: a duplicate UTR is never confirmed twice, and the detected amount must match the
order amount within **±1 INR**.

### Routing engine (trader/account selection)

`backend/src/services/routingEngine.js`. A trader is eligible when online, active, holding
a positive USDT balance, and accepting the order's deposit type (FTD/STD). An account is
eligible when active, within its min/max amount, under its hourly/daily count limits, and
**not already holding an active order for the same exact amount**.

That **same-amount lock** is the important one: one account may run many concurrent orders
for *different* amounts, but only one active order per exact amount — otherwise two
customers paying the same UPI the same amount are indistinguishable at settlement. A short
Redis (or in-memory) lock closes the check→create race; an `active_amount_lock` generated-
column unique index is the DB-level backstop.

### Fee model — subtractive, both percentages off the same base

`backend/src/services/rateService.js` → `calculateSettlement(amountInr, traderId, merchantId)`:

```
base_usdt         = amount_inr / base_rate
merchant_fee_usdt = base_usdt × merchant_payin% / 100
merchant_receives = base_usdt − merchant_fee_usdt          → credited to the merchant
trader_deduction  = base_usdt − (base_usdt × trader_margin% / 100)   → deducted from the trader
platform_revenue  = trader_deduction − merchant_receives    → platform wallet
```

Both percentages are taken off the **same** `base_usdt`. `trader_margin%` must be **less
than** `merchant_payin%` or platform revenue is zero/negative — validated when an admin
sets a trader rate, and only warned about here so a settlement never hard-fails.

`base_rate` comes from the `base_exchange_rate` setting, falling back to the legacy
`exchange_rate` setting, then a hardcoded constant. `trader_rate`/`admin_rate` are still
returned but are **derived, display-only** values — they no longer drive the math.

Per-order results land on the `orders` row (`merchant_fee_usdt`, `trader_commission_usdt`,
…), with a `balance_logs` ledger and `settlements` rows.

### Order lifecycle

`pending → checkout_open → claimed_paid → under_review → success | failed | rejected |
disputed | cancelled`. The first four are `ACTIVE_STATUSES`; `cancelled` is deliberately
excluded so "donor cancelled before paying" is distinguishable from a timeout.

### Auth surfaces (five distinct ones)

| Surface | Mechanism | Where |
|---|---|---|
| Panel users | JWT access + refresh, bcrypt, optional TOTP 2FA | `backend` `middleware/auth.js` |
| Merchant server-to-server | `X-API-Key` + `X-API-Secret` | `backend` `middleware/apiKeyAuth.js` |
| APK → `backend` (unused by the shipping app) | `X-Device-Token` | `backend` `middleware/deviceAuth.js` |
| APK → `ngo-backend` (the live path) | `deviceToken` header | `ngo-backend/src/routes/apk.js` |
| `backend` → `ngo-backend` | signed 5-min `X-Service-Token` | `ngo-backend` `middleware/serviceAuth.js` |
| Customer checkout | order UUID only | `backend` `routes/orderRoutes.js` |

---

## Deployment

Production runs on a single VPS at `198.44.140.74`, fronted by Nginx, with domains under
`adminmaxedge.com`:

| Subdomain | Serves |
|---|---|
| `admin.` | admin panel |
| `app.` | trader panel |
| `merchant.` | merchant panel |
| `checkout.` | checkout page |
| `api.` | `backend` (4000) |
| `ngo-api.` | `ngo-backend` (3000) |

Nginx config lives at [deploy/nginx/adminmaxedge.com.conf](deploy/nginx/adminmaxedge.com.conf);
the APK is served as a static file from `/var/www/downloads/paymentbot.apk`.

### Scripts

```bash
git pull origin main
bash deploy/bootstrap-production.sh    # idempotent — safe after every pull
# ... restart the processes ...
bash deploy/verify-deploy.sh           # proves the NEW code is live
```

**[`deploy/bootstrap-production.sh`](deploy/bootstrap-production.sh)** creates both `.env`
files from templates if missing; generates `SERVICE_AUTH_SECRET` if absent from **both**
and keeps them byte-identical (**fatal error if they already differ** — it refuses to guess);
generates `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`ENCRYPTION_KEY`/`JWT_SECRET` if missing;
verifies the full required-env surface and exits 1 rather than letting the app fall back to
an insecure default; `npm install --production` in both services; runs `backend`'s
migrations. It **never rotates an existing value**, and deliberately creates **no seed data,
no first admin, and no NGO org** — those are decisions, not defaults. See
[deploy/PRODUCTION_BOOTSTRAP.md](deploy/PRODUCTION_BOOTSTRAP.md).

**[`deploy/verify-deploy.sh`](deploy/verify-deploy.sh)** is a read-only curl probe that
distinguishes new code from old by **error-message text** — e.g. new middleware returns
`"Missing service token or Authorization header"` where the old returned
`"Missing or malformed Authorization header"`. It exists because a `git pull` without a
process restart looks exactly like a code bug. Run it after every deploy.

**[deploy/PHASE2_RUNBOOK.md](deploy/PHASE2_RUNBOOK.md)** covers the HTTP→HTTPS certbot
cutover, including the `CORS_ORIGINS`/`WS_CORS_ORIGINS` updates, the four frontend `.env`
rebuilds, and the APK's `Config.SERVER_BASE_URL` + `network_security_config.xml` change.

### PM2

**There is no PM2 ecosystem file in this repo, and process names are not
version-controlled.** No `ecosystem.config.js`, no PM2 reference in any script. Whatever
is currently running on the VPS was set up by hand. Three processes need to be managed:
`backend` API (`npm start` in `backend/`), `backend` worker (`npm run worker`), and
`ngo-backend` (`npm start`). Each **must** have `NODE_ENV=production` in its environment —
see gotcha #1. Whether `pm2 startup` + `pm2 save` have been run (i.e. whether a reboot
brings everything back) is unconfirmed. Committing an `ecosystem.config.js` is the
standing recommendation in
[PRODUCTION_READINESS_AUDIT.md §11](PRODUCTION_READINESS_AUDIT.md).

---

## Known limitations and open items

Verified against the current tree. Items marked ⚠ are security-relevant.

### Security

- ⚠ **Real Paytm session cookies are committed to git.** `ngo-backend/paytm-session.json`
  is tracked and contains live-shaped auth cookies (`SESSION`, `UMP_SESSION`,
  `XSRF-TOKEN`, `market-merchant.sid`, `PTSC`) for `dashboard.paytm.com`,
  `accounts.paytm.com`, and `seller.paytm.com`, plus an `accountId`. An untracked sibling
  `paytm-session-<id>.json` exists too. These should be invalidated on Paytm's side,
  removed from the working tree, added to `.gitignore`, and — because they are in
  history — purged if that history is or ever becomes shared.
- ⚠ **`/api/internal/*` is unauthenticated on both services.** Deliberate (private-network
  trust model), and it only ever returns a boolean or performs a settlement. But
  `POST /api/internal/match-settlement` **settles real orders**, so it must not be
  publicly routable. Verify the Nginx config does not expose it.
- ⚠ **`express-rate-limit` is a dependency and is configured, but is never mounted** in
  `backend/src/app.js`. `/api/auth/login` and `/api/orders/create` are unthrottled.
- ⚠ **The demo seeder's passwords are in git history** (`Admin@123456`, and a shared
  `Demo@12345` across demo accounts).
- **Secret rotation for existing live values** (`JWT_SECRET`, `ENCRYPTION_KEY`) is still
  open. `bootstrap-production.sh` only fills missing values; rotating would invalidate
  every live session and encrypted record, so it's a deliberate scheduled action.
- **`ops-admin@adminmaxedge.com` retirement** is still open (see PRODUCTION_BOOTSTRAP.md).

### Incomplete / stubbed

- **No live exchange rate.** `rateService.js` carries `TODO(live): call Binance P2P API`;
  the rate comes from a settings row or a hardcoded fallback.
- **No UPI acquirer.** `UPI_PROVIDER_*` env vars are empty placeholders. Confirmation is
  entirely receiver-side detection.
- **`ngo-backend`'s `scraperEngine.scrapePlatform()` returns `[]`** — the web-scraper
  subsystem is not functional.
- **Zero automated tests.** `backend/tests/` is an empty `.gitkeep`; Jest and supertest are
  installed. `npm test` in `backend/` runs nothing.
- **`backend/src/routes/index.js` is dead code** — a placeholder router that `app.js` never
  mounts. Its "business logic is not implemented yet" comment is stale.
- **`backend/src/jobs/queues/`, `backend/src/jobs/workers/`, `backend/src/validators/`,
  and `docs/` are all empty directories.**
- **Some admin pages render mock/static data** (Payments, Payouts, Settlement,
  Smartphones) rather than calling `adminApi`.
- **Hardcoded 89 INR/USDT** in `traderController.requestPayout` and `settlementJob`
  bypasses `rateService`.
- **~15 committed one-off dev scripts at `ngo-backend/`'s root** (`fix.js` … `fix6.js`,
  `test-paytm.js`, `try-apis.js`, `login-test.js`, `verify-test-data.js`, plus
  `api-responses.txt` / `api-test-results.txt` / `paytm-api-response.txt`). None are
  referenced by the app.

### Operational

- **No automated database backups anywhere in this repo** — no cron, no `mysqldump`/
  `mongodump` script. Needs to exist, rotated and shipped off-box, before real money is on
  the system.
- **No error alerting/monitoring** beyond Winston file logs and the optional Telegram
  admin notifier.
- **No PM2 config in version control** (above).
- **`ngo-backend` is not part of `npm run dev`** and is not covered by `npm run install:all` —
  easy to forget on a fresh clone.
- **`.env` vs `.env.example` drift** on both services (`API_PREFIX`, `JWT_SECRET` vs
  `JWT_ACCESS_SECRET`, `DB_NAME` defaults, and several keys missing from the examples
  entirely).
- **APK auto-update is manual-sync.** `apk/app/build.gradle.kts` currently declares
  `versionCode = 1` / `versionName = "1.0"`, and `GET /api/apk/latest-version` reports
  `APK_LATEST_VERSION_CODE`/`APK_LATEST_VERSION_NAME` from `ngo-backend`'s env. These must
  be bumped **together** with the uploaded `/downloads/paymentbot.apk`, or every device
  either misses the update or downloads a build identical to (or older than) what it has.
  The endpoint's defaults intentionally match the committed version so a fresh deploy
  starts in "no update available".
- **The APK is a debug build served over plain HTTP** with a cleartext exception in
  `network_security_config.xml`; production signing and the HTTPS switch are tracked in
  PRODUCTION_READINESS_AUDIT.md §14 and PHASE2_RUNBOOK.md §5.

---

## Other documentation in this repo

Linked rather than duplicated — these are the authoritative sources for their areas.

| Doc | Covers |
|---|---|
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | Original high-level product overview |
| [API_MAP.md](API_MAP.md) | Full endpoint inventory |
| [DATABASE_MAP.md](DATABASE_MAP.md) | Sequelize models, relationships, migration history |
| [PAYMENT_FLOW_ARCHITECTURE.md](PAYMENT_FLOW_ARCHITECTURE.md) | End-to-end payment/settlement flow (deepest doc here) |
| [ADMIN_ARCHITECTURE.md](ADMIN_ARCHITECTURE.md) | Admin panel architecture |
| [MERCHANT_ARCHITECTURE.md](MERCHANT_ARCHITECTURE.md) | Merchant panel architecture |
| [frontend/trader/TRADER_ARCHITECTURE.md](frontend/trader/TRADER_ARCHITECTURE.md) | Trader panel: dual-backend design, dead code inventory |
| [frontend/trader/TRADER_UI_INTEGRATION_PLAN.md](frontend/trader/TRADER_UI_INTEGRATION_PLAN.md) | In-flight trader UI work |
| [CURRENT_STATE_AUDIT_admin-merchant-checkout.md](CURRENT_STATE_AUDIT_admin-merchant-checkout.md) | What is real vs mock in three panels |
| [DEVELOPMENT_TODO.md](DEVELOPMENT_TODO.md) | Done / incomplete / risky, with a risk log |
| [PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md) | Dependency versions, TLS, backups, PM2, seed data, `.env` drift |
| [deploy/PRODUCTION_BOOTSTRAP.md](deploy/PRODUCTION_BOOTSTRAP.md) | What bootstrap automates vs. what needs a decision |
| [deploy/PHASE2_RUNBOOK.md](deploy/PHASE2_RUNBOOK.md) | HTTPS/certbot cutover runbook |
| [apk/README.md](apk/README.md) | APK stack, detection engines, file structure |
| [apk/RELIABILITY_AUDIT.md](apk/RELIABILITY_AUDIT.md) | Background-kill, listener lifecycle, offline queue |
| [apk/UI_UX_DESIGN_SPEC.md](apk/UI_UX_DESIGN_SPEC.md) | APK UI design spec |
| [ngo-backend/PARTNER_API_GUIDE.md](ngo-backend/PARTNER_API_GUIDE.md) | Partner-facing API |
| [ngo-backend/TESTING_GUIDE.md](ngo-backend/TESTING_GUIDE.md) | Manual test procedures + demo data |
| [ngo-backend/NOTIFICATIONS_REDESIGN_REPORT.md](ngo-backend/NOTIFICATIONS_REDESIGN_REPORT.md) | Notifications page redesign |
| [ui-ux-audit-report.md](ui-ux-audit-report.md) | Cross-panel UI/UX audit |
