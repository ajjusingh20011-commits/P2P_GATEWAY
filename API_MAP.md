# API Map — P2P UPI Gateway Backend

Base URL: `http://localhost:4000/api` (prefix `/api`). Every response is the
envelope `{ success, data }` (or `{ success:false, message }` on error).

**Auth legend**
- **Public** — no auth.
- **JWT** — `Authorization: Bearer <accessToken>` (from login).
- **JWT+role** — JWT and the user must have the given role.
- **API key** — `X-API-Key` + `X-API-Secret` headers (merchant server-to-server).
- **Device** — `X-Device-Token` header (the trader's Android APK).

Mounting happens in `backend/src/app.js`; handlers live in `backend/src/controllers`.

---

## Auth — `/api/auth` (`authRoutes.js` → `authController`)

| Method & Path | Auth | Purpose |
|---|---|---|
| POST `/api/auth/login` | Public | Email+password → tokens (or `requires_2fa` temp token). Body also takes `role`. |
| POST `/api/auth/refresh` | Public | Rotate refresh token → new access+refresh pair. |
| POST `/api/auth/logout` | JWT | Blacklist access token + revoke refresh. |
| GET `/api/auth/me` | JWT | Current user + role profile (balance/commission). |
| POST `/api/auth/2fa/validate` | Public | Login step 2: TOTP or backup code → tokens. |
| GET `/api/auth/2fa/setup` | JWT | Generate TOTP secret + QR. |
| POST `/api/auth/2fa/verify-setup` | JWT | Confirm TOTP, enable 2FA, return backup codes. |
| POST `/api/auth/2fa/disable` | JWT | Disable 2FA (password + TOTP). |
| GET `/api/auth/2fa/status` | JWT | Whether 2FA is enabled. |

---

## Orders / Checkout — `/api/orders` (`orderRoutes.js` → `orderController`)

| Method & Path | Auth | Purpose |
|---|---|---|
| POST `/api/orders/create` | API key | Create + route an order to a trader; returns checkout URL + UPI. |
| GET `/api/orders` | JWT | Order list, scoped by role (admin=all, merchant=own, trader=assigned). |
| GET `/api/orders/:id` | Public | Order details (+ UPI payload). |
| GET `/api/orders/:id/checkout` | Public | Flat checkout payload (UPI id, QR, rates, expiry, `trader_online`). |
| POST `/api/orders/:id/new-upi` | Public | Reassign to a different trader ("Get new UPI"). |
| POST `/api/orders/:id/paid` | Public | Customer marks paid (+ UTR) → status `paid`. |
| POST `/api/orders/:id/confirm` | Public | Alias of `/paid`. |
| POST `/api/orders/:id/customer-confirm` | Public | Alias of `/paid`. |
| POST `/api/orders/:id/cancel` | JWT+role(trader,admin) | Cancel + release trader. |
| POST `/api/orders/:id/expire` | JWT+role(trader,admin) | Expire + release trader. |
| POST `/api/orders/:id/dispute` | JWT | Raise a dispute → status `disputed`. |

---

## Payment detection — `/api/payment` (`paymentRoutes.js` → `paymentController`)

These ingest the four "detection engines" that confirm a customer actually paid.

| Method & Path | Auth | Purpose |
|---|---|---|
| POST `/api/payment/sms` | Device | Engine 1: SMS text ingest. |
| POST `/api/payment/notification` | Device | Engine 2: push-notification ingest. |
| POST `/api/payment/screen` | Device | Engine 3: screen-scraper ingest. |
| POST `/api/payment/manual` | JWT+role(trader,admin) | Engine 4: trader manually confirms. |

---

## Device / APK — `/api/device` (`deviceRoutes.js` → `deviceController` + shared)

| Method & Path | Auth | Purpose |
|---|---|---|
| POST `/api/device/register` | JWT+role(trader,admin) | Register a phone → device token (rotates on re-register). |
| POST `/api/device/heartbeat` | Device | 30s ping → mark device + trader online. |
| POST `/api/device/sms` | Device | Engine 1 (same handler as `/payment/sms`). |
| POST `/api/device/notification` | Device | Engine 2. |
| POST `/api/device/screen` | Device | Engine 3. |

---

## Trader — `/api/trader` (`traderRoutes.js` → `traderController`)
Router-level guard: **JWT + role `trader`** on every endpoint.

| Method & Path | Purpose |
|---|---|
| GET `/api/trader/dashboard` | Today's stats, balance, rate-margin ("My Rate"). |
| GET `/api/trader/commission` | Rate-spread earnings by `period` (today/week/month) + delta%. |
| GET `/api/trader/balance-logs` | Paginated balance ledger + summary. |
| GET `/api/trader/orders` | Trader's orders (active by default; `?status=`). |
| PUT `/api/trader/heartbeat` | Mark online + refresh heartbeat. |
| PUT `/api/trader/online-status` | Manual online/offline toggle. |
| GET `/api/trader/payment-details` | UPI details + live usage + bank grouping. |
| POST `/api/trader/payment-details` | Add a UPI detail. |
| PUT `/api/trader/payment-details/:id` | Update/toggle a UPI detail. |
| DELETE `/api/trader/payment-details/:id` | Delete a UPI detail. |
| GET `/api/trader/notifications` | Notification logs (paginated). |
| GET `/api/trader/payouts` | List payout requests. |
| POST `/api/trader/payouts` | Request a USDT payout. |

---

## Merchant — `/api/merchant` (`merchantRoutes.js` → `merchantController`)
Router-level guard: **JWT + role `merchant`** on every endpoint.

| Method & Path | Purpose |
|---|---|
| GET `/api/merchant/dashboard` | Today's collections / orders / success rate. |
| GET `/api/merchant/orders` | Merchant's orders (paginated; `?status=`). |
| POST `/api/merchant/orders` | Create an order from the dashboard (JWT convenience path). |
| GET `/api/merchant/transactions` | Merged transactions for the merchant's orders. |
| GET `/api/merchant/balance` | Balance + pending INR + pay-in fee. |
| POST `/api/merchant/webhook` | Set the webhook URL. |
| GET `/api/merchant/api-credentials` | Masked API key. |
| POST `/api/merchant/api-credentials/regenerate` | Rotate key/secret (secret shown once). |

---

## Admin — `/api/admin` (`adminRoutes.js` → `adminController`)
Router-level guard: **JWT + role `admin`** on every endpoint.

| Method & Path | Purpose |
|---|---|
| GET `/api/admin/dashboard` | Platform-wide stats + revenue. |
| GET `/api/admin/traders` | List traders. |
| POST `/api/admin/traders` | Create trader (minimal). |
| POST `/api/admin/traders/create` | Create trader (full form + opening deposit). |
| PUT `/api/admin/traders/:id` | Patch trader fields/status. |
| PUT `/api/admin/traders/:id/balance` | Add/deduct USDT (logged). |
| PUT `/api/admin/traders/:id/commission` | Set trader/admin margins (enforces trader < admin). |
| PUT `/api/admin/traders/:id/online-status` | Force online/offline (demo). |
| PUT `/api/admin/traders/:id/suspend` | Suspend/reactivate (also forces offline). |
| DELETE `/api/admin/traders/:id` | Soft-disable (user → inactive). |
| GET `/api/admin/merchants` | List merchants. |
| POST `/api/admin/merchants` | Create merchant (secret once). |
| POST `/api/admin/merchants/create` | Create merchant (full form). |
| PUT `/api/admin/merchants/:id` | Patch merchant fields/status. |
| PUT `/api/admin/merchants/:id/fees` | Set pay-in/pay-out fee %. |
| GET `/api/admin/orders` | List all orders. |
| PUT `/api/admin/orders/:id` | Approve (`confirmed` → settle) / reject / override status. |
| GET `/api/admin/settings` | Read all settings. |
| PUT `/api/admin/settings` | Update whitelisted settings. |
| GET `/api/admin/disputes` | List disputes. |
| PUT `/api/admin/disputes/:id/resolve` | Resolve a dispute. |
| GET `/api/admin/settlements` | List settlements. |
| POST `/api/admin/settlements/trigger` | Run settlement on demand (works without Redis). |
| GET `/api/admin/smartphones` | List registered devices. |
| PUT `/api/admin/smartphones/:id/disconnect` | Force a device offline. |

---

## Health

| Method & Path | Auth | Purpose |
|---|---|---|
| GET `/health` | Public | Simple liveness. |
| GET `/api/health` | Public | Reports MySQL + Redis status. |
| GET `/api` | Public | Name banner. |

---

## Which panel calls which API (quick reference)

- **Admin panel** → `adminApi.*` (`/admin/*`) + `orderApi.*` (`/orders/:id/*`).
  Note: admin's `api.js` **pre-unwraps** `res.data.data`.
- **Trader panel** → `traderApi.*` (`/trader/*`) + `/orders`. Reads `res.data.data`.
  Has transparent token refresh on `TOKEN_EXPIRED`.
- **Merchant panel** → `merchantApi.*` (`/merchant/*`). Reads `res.data.data`.
  Has token refresh.
- **Checkout** → plain `fetch` to public `/orders/:id/checkout`, `/orders/:id/new-upi`,
  `/orders/:id/confirm`. No auth.

**Real-time (Socket.IO, `/socket.io`):** rooms `trader:{id}`, `merchant:{id}`,
`admin`, `order:{uuid}`. Events include `order:assigned`, `order:paid`,
`order:confirmed`, `order:expired`, `order:cancelled`, `order:disputed`,
`trader:online/offline`. Checkout subscribes anonymously via `subscribe:order`.

---

## Notes / gotchas
- **No rate limiting is actually mounted** (the dependency + config exist, but no
  limiter middleware is applied) — add before production.
- Several `/orders/:id/*` customer endpoints are **Public** by design (the customer
  has no login) — they're guarded only by the unguessable order `uuid`.
- There is **no inbound webhook endpoint**; webhooks are **outbound only**
  (platform → merchant).
- Debug `console.log`s remain in `orderController.checkout`,
  `merchantController.createOrder`, and `balanceService.settleOrder`.
