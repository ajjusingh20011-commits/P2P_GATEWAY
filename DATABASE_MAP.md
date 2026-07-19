# Database Map — P2P UPI Gateway

## 1. Engine & connection

- **Database:** MySQL, accessed through the **Sequelize** ORM.
- **Runtime connection:** `backend/src/loaders/database.js` builds one shared
  Sequelize instance from `config.db` and calls `authenticate()`. `/api/health`
  reports whether it's connected.
- **App config:** `backend/src/config/index.js` reads the `DB_*` env vars.
- **CLI config (migrations/seeders):** `backend/src/config/database.js`, pointed to
  by `backend/.sequelizerc` (which also maps `src/models`, `src/migrations`,
  `src/seeders`).
- **Model loading:** `backend/src/models/index.js` registers all model factories,
  then calls each model's `associate(db)` to wire relationships.

**Connection env vars** (from `.env`; defaults in parentheses):

| Setting | Env var | Default | Your `.env` |
|---|---|---|---|
| host | `DB_HOST` | `127.0.0.1` | set |
| port | `DB_PORT` | `3306` | 3306 |
| name | `DB_NAME` | `p2p_upi_gateway` (config) / `p2p_gateway` (CLI) | **`p2p_gateway`** |
| user | `DB_USER` | `root` | root |
| password | `DB_PASSWORD` | `''` | empty (local XAMPP) |
| dialect | `DB_DIALECT` | `mysql` | mysql |
| pool max/min | `DB_POOL_MAX`/`MIN` | 10 / 0 | default |

> ⚠️ The config default name (`p2p_upi_gateway`) differs from the CLI default
> (`p2p_gateway`). Because your `.env` sets `DB_NAME=p2p_gateway`, both use the same
> DB. If `.env` were missing, app and CLI would target **different** databases.

**Conventions on every table:** `underscored: true`, unsigned auto-increment
integer PKs, `created_at` timestamps (only `users`, `orders`, `settings` also keep
`updated_at`).

---

## 2. Tables / models (15 total)

Files in `backend/src/models/`. Key columns highlighted.

### `users` — accounts & auth
`id`, `uuid` (unique), `email` (unique), `password_hash`, `role`
ENUM(admin/trader/merchant), `status` ENUM(active/inactive/suspended/pending),
`totp_secret`, `two_fa_enabled`, `backup_codes`.
→ `password_hash`/`totp_secret`/`backup_codes` are hidden by a default scope.

### `traders` — trader profile (1:1 with a user)
`user_id` (FK, unique), **`balance_usdt`**, `daily_limit`, `current_daily_used`,
`is_online`, `last_heartbeat`, `commission_rate` ("My Rate" %), `payout_commission`,
`rate_label`, **`trader_margin`** (rate over base), **`admin_margin`** (platform
margin), `telegram_chat_id`.

### `merchants` — merchant profile (1:1 with a user)
`user_id` (FK, unique), `business_name`, `webhook_url`, **`api_key`** (unique),
`api_secret` (hidden), `balance`, `balance_usdt`, `payin_fee_percent`,
`payout_fee_percent`, `daily_limit_inr`, `is_active`.

### `payment_details` — a trader's UPI accounts (the "providers")
`trader_id` (FK), `smartphone_id` (FK, nullable), `account_name`, `upi_id`,
`bank_name`, `organization_name`, `account_type`
ENUM(gpay/phonepe/paytm/bharat_pe/airtel), `is_active` (admin flag),
`is_active_detail` (trader toggle), per-txn `min_amount`/`max_amount`, count caps
`max_per_hour/day/week/month`, amount caps
`hourly_limit_amount/daily_limit_amount/weekly_limit/monthly_limit`, `today_used`.

### `smartphones` — trader devices running the APK
`trader_id` (FK), `device_id` (unique), `device_name`, `connection_type`
ENUM(sms/notification/screen_scraper/manual/hybrid), `auth_token` (hidden),
`is_online`, `last_ping`.

### `orders` — the core object
`uuid` (unique), `merchant_id` (FK), `trader_id` (FK, nullable),
`payment_detail_id` (FK, nullable), `amount_inr`, `amount_usdt`, `exchange_rate`,
**`status`** ENUM(new/assigned/paid/confirmed/expired/disputed/cancelled),
`customer_ref`, `upi_ref_id`, `utr_number`, `expires_at`, `customer_confirmed_at`,
`confirmed_at`, and the **settlement breakdown**: `trader_rate`, `admin_rate`,
`trader_deduction_usdt`, `admin_receives_usdt`, `merchant_fee_usdt`,
`merchant_receives_usdt`, `trader_commission_usdt`, `platform_profit_usdt`.

### `transactions` — raw detected payment signals
`order_id` (FK), `smartphone_id` (FK), `engine_used`
ENUM(sms/notification/screen_scraper/manual), `raw_data`, `amount_detected`,
`utr_number`, `sender_name`, `sender_upi`, `confidence_score`, `is_merged`.

### `notification_logs` — engine-2 push notifications
`trader_id` (FK), `payment_detail_id` (FK), `amount`, `currency`, `transaction_id`,
`description`, `payment_method`, `received_at`.

### `payouts` — trader USDT withdrawal requests
`trader_id` (FK), `amount_inr`, `amount_usdt`, `status`
ENUM(awaiting/processing/settlement/completed/cancelled/dispute), `priority`,
`accepted_at`, `completed_at`.

### `offers` — trader rate offers
`trader_id` (FK), `currency_pair`, `exchange_rate`, `rate_offset_percent`,
`is_active`.

### `settlements` — end-of-day trader↔merchant settlement rows
`trader_id` (FK), `merchant_id` (FK), `total_amount`, `platform_fee`,
`trader_commission`, `net_amount`, `status`
ENUM(pending/processing/completed/failed), `settled_at`.

### `disputes` — order disputes
`order_id` (FK), `raised_by` (FK → users), `reason`, `evidence_url`, `status`
ENUM(open/reviewing/resolved), `resolution`.

### `balance_logs` — append-only USDT ledger for traders
`trader_id` (FK), `type` ENUM(deposit/deduction/commission), `amount_usdt`,
`balance_after`, `order_id` (FK), `note`.

### `settings` — key/value platform settings
`key` (unique), `value`. Holds `base_exchange_rate`, margins, `platform_revenue_usdt`,
order expiry, min/max amounts, etc. Cached 60s in Redis when available.

---

## 3. Relationship map

```
User (1:1) Trader              User (1:1) Merchant
User (1:M) Dispute (raised_by)

Trader (1:M) → PaymentDetail, Smartphone, Order, Payout, Offer,
               Settlement, NotificationLog, BalanceLog
Merchant (1:M) → Order, Settlement

Smartphone (1:M) → PaymentDetail, Transaction
PaymentDetail (1:M) → Order, NotificationLog

Order  belongsTo Merchant, Trader, PaymentDetail
Order  (1:M) → Transaction, Dispute

Transaction    belongsTo Order, Smartphone
BalanceLog     belongsTo Trader, Order
Settlement     belongsTo Trader, Merchant
Dispute        belongsTo Order, User(raised_by)
Setting        — standalone
```

---

## 4. How data flows API → database

Example: **confirming a paid order.**
```
paymentController.ingest  (stores a Transaction row + NotificationLog)
   → smartMerge.mergePaymentData   (scores confidence across Transactions)
   → smartMerge.confirmOrder        (idempotent)
       → balanceService.settleOrder  (inside a DB transaction):
           • BalanceLog: 'deduction' from trader.balance_usdt
           • merchant.balance_usdt += settlement
           • settings.platform_revenue_usdt += profit
           • orders row: status='confirmed' + all *_usdt/*_rate columns filled
```
Reads follow the reverse path: controller → Sequelize model query → `{success,data}`.

---

## 5. Migrations & seeders

**Migrations** live in `backend/src/migrations/` (run with `npm run migrate` from
inside `backend/`). Order matters; all alter-migrations are idempotent
(add-column-if-missing).

Initial schema (2026-07-01): `create-users`, `-traders`, `-merchants`,
`-smartphones`, `-payment-details`, `-orders`, `-transactions`,
`-notification-logs`, `-payouts`, `-offers`, `-settlements`, `-disputes`.

Feature / rate migrations (later): add per-detail limits; add commission fields to
traders; add fee fields to merchants; add 2FA to users; create `balance_logs`;
create `settings` (+ defaults); update fee defaults; add fee breakdown to orders;
add `utr_number` to orders; **add rate system** (`trader_margin`/`admin_margin` on
traders, `trader_rate`/`admin_rate`/`trader_deduction_usdt`/`admin_receives_usdt`
on orders; seeds base rate 100, admin margin 5, trader margin 4).

**Effective default economics:** merchant pay-in 5% / pay-out 2%; trader commission
4% / pay-out 2%; trader_margin 4% / admin_margin 5%; base rate 100.

**Seeders** (`backend/src/seeders/`):
- `20260701000001-demo-users.js` — run by `npm run seed`. Creates `admin@p2p.com`,
  `trader1@p2p.com`, `trader2@p2p.com`, `merchant@p2p.com` with profiles + UPIs.
- `demo-test-seed.js` — standalone (`node src/seeders/demo-test-seed.js`). Creates
  `trader1..3@test.com` + `merchant1..3@test.com` with balances & UPIs.
- `reset-demo.js` — wipes and reseeds a single `trader@demo.com` + `merchant@demo.com`.
- **All demo accounts currently share password `Demo@12345`** (set manually).

> Note: there's also a legacy `backend/seeders/seed.js` that builds the schema via
> `sequelize.sync()` instead of migrations — prefer the migration path above.

---

## 6. Environment variables (masked catalog)

Secrets are never shown — only whether they're set.

| Variable | Category | Required | State |
|---|---|---|---|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` | database | yes | set |
| `DB_PASSWORD` | database | yes | empty (local root) |
| `DB_DIALECT` `DB_LOGGING` | database | no | set |
| `JWT_SECRET` (→ access) | auth | yes | set `<redacted>` |
| `JWT_REFRESH_SECRET` | auth | yes | set `<redacted>` |
| `JWT_ACCESS_EXPIRES_IN` `JWT_REFRESH_EXPIRES_IN` | auth | no | set |
| `BCRYPT_SALT_ROUNDS` | auth | no (12) | set |
| `REDIS_HOST` `REDIS_PORT` | redis | no | set |
| `REDIS_PASSWORD` `REDIS_DB` | redis | no | empty |
| `PORT` `NODE_ENV` `APP_NAME` `API_PREFIX` | platform | no | set |
| `ORDER_EXPIRY_MINUTES` | platform | no (10) | set |
| `PLATFORM_FEE_PERCENT` `DEFAULT_TRADER_COMMISSION_PERCENT` `DEFAULT_EXCHANGE_RATE` | platform | no | set |
| `HEARTBEAT_TIMEOUT_MS` | platform | no (120000) | **not in .env → default** |
| `FRONTEND_*_URL` / `CORS_ORIGINS` | CORS | no | set/defaults |
| `TELEGRAM_BOT_TOKEN` `TELEGRAM_ADMIN_CHAT_ID` | notify | no | empty |
| `UPI_PROVIDER_BASE_URL` `UPI_PROVIDER_API_KEY` `UPI_PROVIDER_WEBHOOK_SECRET` | payment | no | **empty placeholders** |
| `RATE_LIMIT_WINDOW_MS` `RATE_LIMIT_MAX` | security | no | example-only (not enforced) |
| `VITE_API_BASE_URL` `VITE_WS_URL` `VITE_APP_NAME` (per frontend) | API-URL | no | defaults |

> `ngo-backend` has its own `.env` (MongoDB + JWT + encryption key + proxy). It is a
> separate service and not part of this gateway.
