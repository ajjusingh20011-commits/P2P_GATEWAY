# Partner API Integration Guide

Complete frontend integration reference for the **NGO Donation Gateway** backend.
Everything here matches the real backend code — routes, request bodies, and response
JSON are copied from the actual implementation, not placeholders.

---

## Table of Contents

1. [Setup](#section-1--setup)
2. [Authentication APIs](#section-2--authentication-apis)
3. [Account Management APIs](#section-3--account-management-apis)
4. [Stats API](#section-4--stats-api)
5. [Transactions API](#section-5--transactions-api)
6. [Ledger API](#section-6--ledger-api)
7. [Admin APIs](#section-7--admin-apis)
8. [APK Integration](#section-8--apk-integration)
9. [Webhook (Donor Checkout)](#section-9--webhook-donor-checkout)
10. [Error Codes](#section-10--error-codes)
11. [Real Code Examples](#section-11--real-code-examples)
12. [Socket.io Live Updates](#section-12--socketio-live-updates)

---

## Conventions used everywhere

Every JSON response follows one of two shapes.

**Success envelope** (most endpoints):

```json
{ "success": true, "data": { } }
```

**Error envelope** (any failure, any status code):

```json
{ "success": false, "message": "human readable reason" }
```

A few list endpoints (`transactions`, `ledger`) return their array at the **top
level** alongside pagination fields instead of nesting under `data`. Those are
called out explicitly in their sections — do not assume everything is under `data`.

---

# SECTION 1 — Setup

## Base URL configuration

The backend listens on `PORT` (default **3000**). All REST routes are mounted
under `/api`.

| Environment | Base URL |
|-------------|----------|
| Local dev   | `http://localhost:3000` |
| API root    | `http://localhost:3000/api` |

Keep it in one config file so you can swap environments in a single place:

```js
// src/config.js
export const API_BASE = "http://localhost:3000/api";
export const SOCKET_URL = "http://localhost:3000"; // Socket.io uses the root, NOT /api
```

## How to store and send the JWT token

The backend is **stateless** — it does not use cookies or sessions. Every
protected request must carry the JWT in the `Authorization` header using the
**Bearer** scheme:

```
Authorization: Bearer <your-token-here>
```

The middleware splits the header on a single space and requires exactly
`Bearer <token>`. Anything else returns `401`.

A small helper keeps every request consistent:

```js
// src/api/authHeaders.js
export function authHeaders() {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
```

Which endpoints need the token:

| Area | Auth required |
|------|---------------|
| `/api/auth/login`, `/api/auth/register` | No |
| `/api/ngo/*` | Yes — role `ngo_staff` or `admin` |
| `/api/admin/*` | Yes — role `admin` only |
| `/api/apk/*` | No JWT — uses a `deviceToken` header instead |
| `/api/webhook/donate` | No JWT — uses the NGO's `secret` in the body |

---

# SECTION 2 — Authentication APIs

## POST /api/auth/login

Authenticates a user and returns a signed JWT valid for **7 days**.

**Request body:**

```json
{
  "email": "staff@brightfuture.org",
  "password": "password123"
}
```

**Success response — `200 OK`:**

```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "68a1f2c3d4e5f6a7b8c9d0e1",
      "name": "Priya Sharma",
      "email": "staff@brightfuture.org",
      "role": "ngo_staff",
      "ngoId": "68a0aabbccddeeff00112233",
      "isActive": true,
      "createdAt": "2026-06-01T09:12:00.000Z",
      "updatedAt": "2026-06-01T09:12:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4YTFmMmMzZDRlNWY2YTdiOGM5ZDBlMSIsInJvbGUiOiJuZ29fc3RhZmYiLCJuZ29JZCI6IjY4YTBhYWJiY2NkZGVlZmYwMDExMjIzMyIsImVtYWlsIjoic3RhZmZAYnJpZ2h0ZnV0dXJlLm9yZyIsImlhdCI6MTc1MTc5MDMyMCwiZXhwIjoxNzUyMzk1MTIwfQ.q3Zx1r8k2mVn5pS7wT9uYhC0dExampleSignature"
    }
  }
}
```

> The `password` field is **never** included in the `user` object — the User
> model strips it from all JSON output.

### What the token contains

The `token` string is a standard JWT (`header.payload.signature`). If you
base64-decode the middle payload segment you get:

```json
{
  "id": "68a1f2c3d4e5f6a7b8c9d0e1",
  "role": "ngo_staff",
  "ngoId": "68a0aabbccddeeff00112233",
  "email": "staff@brightfuture.org",
  "iat": 1751790320,
  "exp": 1752395120
}
```

Use `role` to decide which parts of the dashboard to show, and `ngoId` to know
which NGO the logged-in user belongs to. You do **not** need to send `ngoId`
yourself on NGO routes — the backend reads it from the token.

### How to save the token to localStorage

```js
async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();

  if (!json.success) throw new Error(json.message);

  // Persist token + user for later requests and UI.
  localStorage.setItem("token", json.data.token);
  localStorage.setItem("user", JSON.stringify(json.data.user));

  return json.data.user;
}
```

Read it back anywhere:

```js
const token = localStorage.getItem("token");
const user = JSON.parse(localStorage.getItem("user") || "null");
```

On logout, clear both:

```js
function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}
```

## POST /api/auth/register

Creates a new user and returns a token immediately (same shape as login).
`name`, `email`, and `password` are **required**. `role` defaults to
`ngo_staff` if omitted.

Valid roles: `admin`, `ngo_staff`, `merchant`.

### Register an `ngo_staff` user

`ngo_staff` users belong to an NGO, so include the `ngoId` they are attached to.

```json
{
  "name": "Priya Sharma",
  "email": "staff@brightfuture.org",
  "password": "password123",
  "role": "ngo_staff",
  "ngoId": "68a0aabbccddeeff00112233"
}
```

### Register an `admin` user

Admins are platform-wide and are **not** tied to an NGO — omit `ngoId`.

```json
{
  "name": "Ravi Admin",
  "email": "admin@gateway.com",
  "password": "adminpass123",
  "role": "admin"
}
```

### Register a `merchant` user

```json
{
  "name": "Meera Merchant",
  "email": "merchant@shop.com",
  "password": "merchantpass123",
  "role": "merchant"
}
```

**Success response — `201 Created`** (identical shape for all three roles):

```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "68a1f2c3d4e5f6a7b8c9d0e1",
      "name": "Priya Sharma",
      "email": "staff@brightfuture.org",
      "role": "ngo_staff",
      "ngoId": "68a0aabbccddeeff00112233",
      "isActive": true,
      "createdAt": "2026-07-06T10:00:00.000Z",
      "updatedAt": "2026-07-06T10:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6Ii4uLiJ9.exampleSignature"
  }
}
```

**Duplicate email — `409 Conflict`:**

```json
{ "success": false, "message": "Email already registered" }
```

## GET /api/auth/me

Returns the profile of the currently authenticated user. Requires the
`Authorization` header.

**Success response — `200 OK`:**

```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "68a1f2c3d4e5f6a7b8c9d0e1",
      "name": "Priya Sharma",
      "email": "staff@brightfuture.org",
      "role": "ngo_staff",
      "ngoId": "68a0aabbccddeeff00112233",
      "isActive": true
    }
  }
}
```

---

# SECTION 3 — Account Management APIs

These power the **"+ Add Payment Detail"** button and the account list on the
Offers & Details screen. All routes require a token with role `ngo_staff` or
`admin`.

The NGO is taken from the token's `ngoId`. (Admins may optionally target a
specific NGO by adding `?ngoId=<id>` to the query string.)

## POST /api/ngo/accounts

Adds a payment account. There are two connection types — send the matching body.

### Format A — APK connection

The NGO's phone runs the companion APK, which relays payment notifications.
**No login credentials are stored** for this type.

**Request body:**

```json
{
  "type": "apk",
  "platform": "phonepe",
  "upiId": "bright@ybl",
  "displayName": "Bright Future PhonePe"
}
```

**Success response — `201 Created`:**

```json
{
  "success": true,
  "data": {
    "_id": "68b3c1d2e3f4a5b6c7d8e9f0",
    "ngoId": "68a0aabbccddeeff00112233",
    "platform": "phonepe",
    "upiId": "bright@ybl",
    "accountNumber": "",
    "displayName": "Bright Future PhonePe",
    "status": "live",
    "connectionType": "apk",
    "lastSyncTime": null,
    "totalReceived": 0,
    "createdAt": "2026-07-06T10:15:00.000Z",
    "updatedAt": "2026-07-06T10:15:00.000Z"
  }
}
```

### Format B — Web login connection

The backend logs into the payment platform on the NGO's behalf. The three
`login*` fields are **encrypted at rest** and are **never returned** by any
endpoint.

**Request body:**

```json
{
  "type": "web",
  "platform": "paytm",
  "upiId": "9988776655@paytm",
  "displayName": "Bright Future Paytm",
  "loginEmail": "ngo@paytm.com",
  "loginPassword": "password123",
  "loginPhone": "9988776655"
}
```

**Success response — `201 Created`:**

```json
{
  "success": true,
  "data": {
    "_id": "68b3c1d2e3f4a5b6c7d8e9f1",
    "ngoId": "68a0aabbccddeeff00112233",
    "platform": "paytm",
    "upiId": "9988776655@paytm",
    "accountNumber": "",
    "displayName": "Bright Future Paytm",
    "status": "live",
    "connectionType": "web",
    "lastSyncTime": null,
    "totalReceived": 0,
    "createdAt": "2026-07-06T10:16:00.000Z",
    "updatedAt": "2026-07-06T10:16:00.000Z"
  }
}
```

> **Password never returns.** Notice the response for Format B contains **no**
> `loginEmail`, `loginPassword`, `loginPhone`, or any `encrypted*` field. They
> are stored encrypted and used only internally by the scraper. Your UI should
> collect them in the "Add" form and then forget them — there is no way to read
> them back.

**Validation error — `400 Bad Request`** (missing or wrong `type`):

```json
{ "success": false, "message": "type must be \"apk\" or \"web\"" }
```

Valid `platform` values: `paytm`, `phonepe`, `bharatpe`, `gpay`, `amazonpay`, `other`.

## GET /api/ngo/accounts

Returns all accounts for the logged-in NGO, newest first. Credential fields are
always stripped.

**Success response — `200 OK`:**

```json
{
  "success": true,
  "data": [
    {
      "_id": "68b3c1d2e3f4a5b6c7d8e9f1",
      "ngoId": "68a0aabbccddeeff00112233",
      "platform": "paytm",
      "upiId": "9988776655@paytm",
      "accountNumber": "",
      "displayName": "Bright Future Paytm",
      "status": "live",
      "connectionType": "web",
      "lastSyncTime": "2026-07-06T10:30:00.000Z",
      "totalReceived": 15400,
      "createdAt": "2026-07-06T10:16:00.000Z",
      "updatedAt": "2026-07-06T10:30:00.000Z"
    },
    {
      "_id": "68b3c1d2e3f4a5b6c7d8e9f0",
      "ngoId": "68a0aabbccddeeff00112233",
      "platform": "phonepe",
      "upiId": "bright@ybl",
      "accountNumber": "",
      "displayName": "Bright Future PhonePe",
      "status": "paused",
      "connectionType": "apk",
      "lastSyncTime": null,
      "totalReceived": 0,
      "createdAt": "2026-07-06T10:15:00.000Z",
      "updatedAt": "2026-07-06T10:20:00.000Z"
    }
  ]
}
```

### The `connectionType` field — `apk` vs `web`

| Value | Meaning | UI hint |
|-------|---------|---------|
| `"apk"` | Notifications relayed by the on-device Android APK. No stored credentials. | Show an "APK / device" badge. |
| `"web"` | Backend logs into the platform website with stored, encrypted credentials. | Show a "Web login" badge. |

### The `status` field — `live` vs `paused`

| Value | Meaning | UI hint |
|-------|---------|---------|
| `"live"` | Account is active; the scraper session is running. | Green toggle / dot (like the mockup). |
| `"paused"` | Account is stopped; no scraping. | Grey / off toggle. |
| `"disconnected"` | Set by the backend when a scrape fails (e.g. bad credentials). | Red / warning state. |

New accounts are created with `status: "live"`.

## PATCH /api/ngo/accounts/:accountId/toggle

Switches an account between `live` and `paused`. This is what the toggle switch
on each account row calls. It starts the scraper session when set to `live` and
stops it when set to `paused`.

`:accountId` is the account's `_id`.

**Request body:**

```json
{ "status": "paused" }
```

**Success response — `200 OK`:**

```json
{
  "success": true,
  "data": {
    "_id": "68b3c1d2e3f4a5b6c7d8e9f0",
    "ngoId": "68a0aabbccddeeff00112233",
    "platform": "phonepe",
    "upiId": "bright@ybl",
    "accountNumber": "",
    "displayName": "Bright Future PhonePe",
    "status": "paused",
    "connectionType": "apk",
    "lastSyncTime": null,
    "totalReceived": 0,
    "createdAt": "2026-07-06T10:15:00.000Z",
    "updatedAt": "2026-07-06T10:20:00.000Z"
  }
}
```

**Invalid status — `400 Bad Request`:**

```json
{ "success": false, "message": "status must be \"live\" or \"paused\"" }
```

**Account not found / not yours — `404 Not Found`:**

```json
{ "success": false, "message": "Account not found" }
```

---

# SECTION 4 — Stats API

## GET /api/ngo/stats

Dashboard summary numbers for the logged-in NGO. Requires `ngo_staff` or
`admin`.

**Success response — `200 OK`:**

```json
{
  "success": true,
  "data": {
    "totalDonations": 128500,
    "todayDonations": 4200,
    "totalCount": 37,
    "activeAccounts": 2
  }
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `totalDonations` | number | Sum of all verified donation **amounts** ever (in rupees). |
| `todayDonations` | number | Sum of verified donation amounts since midnight today. |
| `totalCount` | number | Count of verified donation ledger entries. |
| `activeAccounts` | number | Number of accounts with `status: "live"`. |

---

# SECTION 5 — Transactions API

## GET /api/ngo/transactions

Paginated list of scraped transactions for the NGO, newest first.

> **Note the response shape:** `transactions`, `total`, and `pages` are at the
> **top level** — they are **not** wrapped in `data`.

**Query parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `page` | number | `1` | 1-based page index. |
| `limit` | number | `20` | Clamped between 1 and 100. |
| `status` | string | — | Optional filter: `SUCCESS`, `FAILED`, or `PENDING`. |

Example request:

```
GET /api/ngo/transactions?page=1&limit=20&status=SUCCESS
```

**Success response — `200 OK`:**

```json
{
  "success": true,
  "transactions": [
    {
      "_id": "68c4d1e2f3a4b5c6d7e8f900",
      "ngoId": "68a0aabbccddeeff00112233",
      "accountId": "68b3c1d2e3f4a5b6c7d8e9f1",
      "platform": "paytm",
      "amount": "500",
      "payerName": "Amit Kumar",
      "payerUpiId": "amit@okhdfcbank",
      "utr": "451234567890",
      "txnId": "T2607061012345",
      "bankName": "HDFC Bank",
      "paymentMode": "UPI",
      "status": "SUCCESS",
      "scrapedAt": "2026-07-06T10:12:30.000Z",
      "rawEventId": null,
      "createdAt": "2026-07-06T10:12:31.000Z",
      "updatedAt": "2026-07-06T10:12:31.000Z"
    }
  ],
  "total": 37,
  "pages": 2
}
```

| Field | Meaning |
|-------|---------|
| `total` | Total matching transactions across all pages. |
| `pages` | Total number of pages = `ceil(total / limit)`. |
| `amount` | Stored as a **string** (e.g. `"500"`). Parse before doing math. |

---

# SECTION 6 — Ledger API

## GET /api/ngo/ledger

Paginated list of **verified** donations for the NGO — the append-only,
hash-chained public ledger. Newest first.

> **Response shape:** like transactions, `ledger`, `total`, and `pages` are at
> the **top level**, not under `data`.

**Query parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `page` | number | `1` | 1-based page index. |
| `limit` | number | `20` | Clamped between 1 and 100. |

Example request:

```
GET /api/ngo/ledger?page=1&limit=20
```

**Success response — `200 OK`:**

```json
{
  "success": true,
  "ledger": [
    {
      "_id": "68d5e1f2a3b4c5d6e7f8a901",
      "ngoId": "68a0aabbccddeeff00112233",
      "ngoName": "Bright Future Foundation",
      "donorName": "Amit Kumar",
      "donorEmail": "amit@example.com",
      "amount": "500",
      "purpose": "School meals",
      "utr": "451234567890",
      "upiId": "amit@okhdfcbank",
      "txnId": "T2607061012345",
      "platform": "paytm",
      "verifiedAt": "2026-07-06T10:12:35.000Z",
      "prevHash": "0000000000",
      "hash": "9f2c8b7a6d5e4f3c2b1a0987654321fedcba9876543210abcdef1234567890ab",
      "isPublic": true,
      "webhookId": "68d5e1f2a3b4c5d6e7f8a900",
      "transactionId": "68c4d1e2f3a4b5c6d7e8f900",
      "createdAt": "2026-07-06T10:12:35.000Z",
      "updatedAt": "2026-07-06T10:12:35.000Z"
    }
  ],
  "total": 37,
  "pages": 2
}
```

### The `hash` field — tamper-evident chain

The ledger is a **blockchain-style hash chain**. Every entry stores:

- `prevHash` — the `hash` of the previous ledger entry.
- `hash` — a SHA-256 digest computed over this entry's stable fields
  (`ngoId`, `donorName`, `amount`, `utr`, `txnId`, `upiId`, `platform`,
  `purpose`, `verifiedAt`) **plus** the `prevHash`.

Because each hash folds in the previous one, editing any past entry would change
its hash and break every link after it — that is what makes the ledger
tamper-evident. The very first entry's `prevHash` is the genesis value
`"0000000000"`.

**For the UI:** you don't recompute hashes on the frontend. Just display them
as proof-of-integrity — e.g. show a shortened `hash` (`9f2c8b7a…`) with a
"verified" badge, and optionally let users copy the full value. Entries chain in
`createdAt` order.

---

# SECTION 7 — Admin APIs

All admin routes require a token whose `role` is `admin`. A non-admin token gets
`403`.

## GET /api/admin/ngos

Lists every NGO with a donation rollup.

**Success response — `200 OK`:**

```json
{
  "success": true,
  "data": [
    {
      "_id": "68a0aabbccddeeff00112233",
      "name": "Bright Future Foundation",
      "email": "contact@brightfuture.org",
      "phone": "9876543210",
      "description": "Education for underprivileged children",
      "status": "active",
      "proxyIp": "10.20.30.40",
      "webhookSecret": "3f9a2b7c1d8e4f60a5b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9",
      "totalDonations": 128500,
      "createdAt": "2026-06-01T08:00:00.000Z",
      "updatedAt": "2026-07-06T10:12:35.000Z",
      "stats": {
        "donationCount": 37,
        "donationAmount": 128500
      }
    }
  ]
}
```

> `webhookSecret` is the shared secret a donor checkout page must send to
> `/api/webhook/donate` (see Section 9). Treat it as sensitive.

## GET /api/admin/stats

Platform-wide totals across all NGOs.

**Success response — `200 OK`:**

```json
{
  "success": true,
  "data": {
    "totalNGOs": 12,
    "totalDonations": 540,
    "totalAmount": 1875000,
    "todayAmount": 23400,
    "activeDevices": 9
  }
}
```

| Field | Meaning |
|-------|---------|
| `totalNGOs` | Count of NGOs. |
| `totalDonations` | Count of verified ledger entries platform-wide. |
| `totalAmount` | Sum of all verified donation amounts. |
| `todayAmount` | Sum of verified donation amounts since midnight. |
| `activeDevices` | Count of APK devices currently `active`. |

## PATCH /api/admin/ngos/:ngoId/status

Sets an NGO's status. `:ngoId` is the NGO's `_id`.

**Request body** (`status` must be one of `active`, `inactive`, `pending`):

```json
{ "status": "active" }
```

**Success response — `200 OK`:**

```json
{
  "success": true,
  "data": {
    "_id": "68a0aabbccddeeff00112233",
    "name": "Bright Future Foundation",
    "email": "contact@brightfuture.org",
    "phone": "9876543210",
    "description": "Education for underprivileged children",
    "status": "active",
    "proxyIp": "10.20.30.40",
    "webhookSecret": "3f9a2b7c1d8e4f60a5b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9",
    "totalDonations": 128500,
    "createdAt": "2026-06-01T08:00:00.000Z",
    "updatedAt": "2026-07-06T11:00:00.000Z"
  }
}
```

**Invalid status — `400 Bad Request`:**

```json
{ "success": false, "message": "status must be one of: active, inactive, pending" }
```

---

# SECTION 8 — APK Integration

These endpoints are consumed by the **Android APK**, not the dashboard. They are
documented here so the frontend team understands the full data flow. APK
requests do **not** use a JWT — the device authenticates with a `deviceToken`.

## POST /api/apk/register-device

Registers (or re-registers) a device and returns its `deviceToken`. Only
`deviceId` is required.

**Request body the APK sends:**

```json
{
  "deviceId": "a1b2c3d4e5f60789",
  "ngoId": "68a0aabbccddeeff00112233",
  "deviceModel": "Redmi Note 12",
  "androidVersion": "13",
  "appVersion": "1.4.0"
}
```

**Success response — `201 Created`:**

```json
{
  "success": true,
  "deviceToken": "7c9f2a1b3d5e8f0a2c4b6d8e0f1a3c5b7d9e1f2a4c6b8d0e"
}
```

The APK stores this `deviceToken` and sends it back on every event.

## POST /api/apk/event

Reports one captured event (SMS / notification / screen read). The device
authenticates with the token in a **header**, not the body.

**Header:** `deviceToken: <token>` (the header `x-device-token` is also accepted).

**Request body the APK sends:**

```json
{
  "type": "NOTIFICATION",
  "sender": "PhonePe",
  "body": "You received Rs.500 from Amit Kumar. UTR 451234567890.",
  "category": "PAYMENT",
  "amount": "500",
  "utcTimestamp": "2026-07-06T10:12:30.000Z"
}
```

| Field | Values / notes |
|-------|----------------|
| `type` | `SMS`, `NOTIFICATION`, or `SCREEN`. Unknown values fall back to `NOTIFICATION`. |
| `category` | `PAYMENT`, `OTP`, `BANK`, `ALERT`, `OTHER`. Unknown falls back to `OTHER`. |
| `amount` | String amount (e.g. `"500"`). |
| `utcTimestamp` | ISO 8601. Defaults to server time if omitted. |

**Success response — `200 OK`:**

```json
{ "success": true }
```

When a `PAYMENT` event arrives, the backend runs the matching engine and, on a
successful match, emits a `newDonation` socket event to the NGO's room (see
Section 12).

**Missing / invalid token — `401 Unauthorized`:**

```json
{ "success": false, "message": "deviceToken header is required" }
```

```json
{ "success": false, "message": "Invalid deviceToken" }
```

---

# SECTION 9 — Webhook (Donor Checkout)

## POST /api/webhook/donate

Called by an NGO's **donation/checkout website** when a donor initiates a
payment. It records a pending donor "intent" that the backend later reconciles
against the real money movement captured from the payment account. This endpoint
does **not** use a JWT — it authenticates with the NGO's `secret`
(the `webhookSecret` from the NGO record).

`ngoId`, `amount`, and `secret` are **required**.

**Request body the NGO website sends:**

```json
{
  "ngoId": "68a0aabbccddeeff00112233",
  "donorName": "Amit Kumar",
  "donorEmail": "amit@example.com",
  "donorPhone": "9876500011",
  "amount": "500",
  "purpose": "School meals",
  "campaignId": "68e0f1a2b3c4d5e6f7a8b9c0",
  "secret": "3f9a2b7c1d8e4f60a5b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9"
}
```

**Success response — `201 Created`:**

```json
{
  "success": true,
  "webhookId": "68d5e1f2a3b4c5d6e7f8a900",
  "matched": false
}
```

| Field | Meaning |
|-------|---------|
| `webhookId` | Id of the recorded intent — use it to poll status. |
| `matched` | `true` if a matching transaction already existed and the donation was verified immediately; otherwise `false` (it will match later when the payment lands). |

**Bad secret — `401 Unauthorized`:**

```json
{ "success": false, "message": "Invalid webhook secret" }
```

**Missing fields — `400 Bad Request`:**

```json
{ "success": false, "message": "ngoId, amount and secret are required" }
```

**NGO not found — `404 Not Found`:**

```json
{ "success": false, "message": "NGO not found" }
```

### GET /api/webhook/:id

Poll the status of a donation intent (e.g. from a "thank you" page).

```json
{
  "success": true,
  "data": {
    "_id": "68d5e1f2a3b4c5d6e7f8a900",
    "ngoId": "68a0aabbccddeeff00112233",
    "donorName": "Amit Kumar",
    "donorEmail": "amit@example.com",
    "donorPhone": "9876500011",
    "amount": "500",
    "purpose": "School meals",
    "status": "matched",
    "expiresAt": "2026-07-06T12:12:30.000Z",
    "createdAt": "2026-07-06T10:12:30.000Z"
  }
}
```

`status` is `pending`, `matched`, or `expired` (intents expire after 2 hours).

---

# SECTION 10 — Error Codes

Every error returns the same envelope:

```json
{ "success": false, "message": "reason" }
```

| Status | When it happens | Typical `message` | Frontend handling |
|--------|-----------------|-------------------|-------------------|
| **400** | Validation error — missing/invalid body fields. | `"type must be \"apk\" or \"web\""` | Show the message inline on the form field. Do not log the user out. |
| **401** | Token missing, malformed, or expired. | `"Invalid or expired token"` / `"Missing or malformed Authorization header"` | Clear stored token, redirect to login. |
| **403** | Authenticated but wrong role (e.g. `ngo_staff` hitting an admin route). | `"Forbidden: insufficient role"` | Show "You don't have access to this." Do **not** log out — the token is still valid. |
| **404** | Resource not found or not owned by this user/NGO. | `"Account not found"` | Show "Not found" state; refresh the list. |
| **409** | Conflict (e.g. registering an email that already exists). | `"Email already registered"` | Show the message on the relevant field. |
| **500** | Unexpected server error. | `"Internal Server Error"` | Show a generic "Something went wrong, try again" toast. |

A single reusable handler keeps this consistent:

```js
// src/api/handleResponse.js
export async function handleResponse(res) {
  let json;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, "Unexpected server response");
  }

  if (res.ok && json.success) return json;

  // 401 -> session is dead, force re-login.
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    if (location.pathname !== "/login") location.href = "/login";
  }

  throw new ApiError(res.status, json.message || "Request failed");
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
```

---

# SECTION 11 — Real Code Examples

Complete, copy-pasteable `fetch` examples with headers, error handling, and
loading state. They assume the `API_BASE`, `authHeaders`, and `handleResponse`
helpers from the earlier sections.

### 11.1 Login (no token yet)

```js
async function loginUser(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await handleResponse(res);

  localStorage.setItem("token", json.data.token);
  localStorage.setItem("user", JSON.stringify(json.data.user));
  return json.data.user;
}
```

### 11.2 Load accounts (with loading + error state)

Framework-agnostic pattern you can adapt to React/Vue/Svelte state:

```js
async function loadAccounts({ onLoading, onData, onError }) {
  onLoading(true);
  try {
    const res = await fetch(`${API_BASE}/ngo/accounts`, {
      method: "GET",
      headers: authHeaders(),
    });
    const json = await handleResponse(res);
    onData(json.data); // array of accounts
  } catch (err) {
    onError(err.message);
  } finally {
    onLoading(false);
  }
}
```

React hook version:

```jsx
import { useEffect, useState } from "react";

function useAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/ngo/accounts`, { headers: authHeaders() });
      const json = await handleResponse(res);
      setAccounts(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);
  return { accounts, loading, error, refresh };
}
```

### 11.3 Add a payment account — the "+ Add Payment Detail" button

```js
// APK connection
async function addApkAccount({ platform, upiId, displayName }) {
  const res = await fetch(`${API_BASE}/ngo/accounts`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ type: "apk", platform, upiId, displayName }),
  });
  const json = await handleResponse(res);
  return json.data; // saved account (no credentials)
}

// Web-login connection
async function addWebAccount({
  platform, upiId, displayName, loginEmail, loginPassword, loginPhone,
}) {
  const res = await fetch(`${API_BASE}/ngo/accounts`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      type: "web",
      platform, upiId, displayName,
      loginEmail, loginPassword, loginPhone,
    }),
  });
  const json = await handleResponse(res);
  return json.data; // saved account — never contains the login fields
}
```

Submit handler with loading + error state:

```jsx
async function onSubmit(form, { setSaving, setError, onSuccess }) {
  setSaving(true);
  setError(null);
  try {
    const account =
      form.type === "web"
        ? await addWebAccount(form)
        : await addApkAccount(form);
    onSuccess(account);
  } catch (err) {
    setError(err.message); // e.g. shows the 400 validation message
  } finally {
    setSaving(false);
  }
}
```

### 11.4 Toggle an account live/paused

```js
async function toggleAccount(accountId, nextStatus /* "live" | "paused" */) {
  const res = await fetch(`${API_BASE}/ngo/accounts/${accountId}/toggle`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ status: nextStatus }),
  });
  const json = await handleResponse(res);
  return json.data; // updated account
}
```

Optimistic UI update for the toggle switch:

```jsx
async function onToggle(account, setAccounts) {
  const next = account.status === "live" ? "paused" : "live";

  // Flip immediately for a snappy UI.
  setAccounts((list) =>
    list.map((a) => (a._id === account._id ? { ...a, status: next } : a))
  );

  try {
    const updated = await toggleAccount(account._id, next);
    setAccounts((list) => list.map((a) => (a._id === updated._id ? updated : a)));
  } catch (err) {
    // Roll back on failure.
    setAccounts((list) =>
      list.map((a) => (a._id === account._id ? account : a))
    );
    alert(err.message);
  }
}
```

### 11.5 Load stats

```js
async function loadStats() {
  const res = await fetch(`${API_BASE}/ngo/stats`, { headers: authHeaders() });
  const json = await handleResponse(res);
  return json.data; // { totalDonations, todayDonations, totalCount, activeAccounts }
}
```

### 11.6 Load transactions (paginated, note top-level shape)

```js
async function loadTransactions({ page = 1, limit = 20, status } = {}) {
  const params = new URLSearchParams({ page, limit });
  if (status) params.set("status", status);

  const res = await fetch(`${API_BASE}/ngo/transactions?${params}`, {
    headers: authHeaders(),
  });
  const json = await handleResponse(res);

  // transactions / total / pages are top-level, NOT under json.data
  return { rows: json.transactions, total: json.total, pages: json.pages };
}
```

### 11.7 Load ledger (paginated)

```js
async function loadLedger({ page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams({ page, limit });
  const res = await fetch(`${API_BASE}/ngo/ledger?${params}`, {
    headers: authHeaders(),
  });
  const json = await handleResponse(res);
  return { entries: json.ledger, total: json.total, pages: json.pages };
}
```

### 11.8 Admin — update NGO status

```js
async function setNgoStatus(ngoId, status /* "active" | "inactive" | "pending" */) {
  const res = await fetch(`${API_BASE}/admin/ngos/${ngoId}/status`, {
    method: "PATCH",
    headers: authHeaders(), // must be an admin token
    body: JSON.stringify({ status }),
  });
  const json = await handleResponse(res);
  return json.data; // updated NGO
}
```

---

# SECTION 12 — Socket.io Live Updates

The backend runs a Socket.io server on the **root URL** (`http://localhost:3000`),
**not** under `/api`. Events are scoped to a **room named after the `ngoId`**, so
after connecting you must join your NGO's room to receive its events.

## Install the client

```
npm install socket.io-client
```

## Connect and join your NGO room

```js
import { io } from "socket.io-client";
import { SOCKET_URL } from "./config";

const user = JSON.parse(localStorage.getItem("user") || "null");

const socket = io(SOCKET_URL, {
  transports: ["websocket"],
});

socket.on("connect", () => {
  console.log("Realtime connected:", socket.id);
  // Join the room for this NGO so we receive its events.
  if (user?.ngoId) socket.emit("join", user.ngoId);
});

socket.on("disconnect", () => {
  console.log("Realtime disconnected");
});
```

> The `join` step is required. The server emits every event with
> `io.to(ngoId).emit(...)`, so a socket that hasn't joined the `ngoId` room
> receives nothing.

## Events the backend actually emits

| Event | Payload | Fires when |
|-------|---------|-----------|
| `newDonation` | A **Ledger** entry (same shape as Section 6). | A donor intent is matched to a real transaction and committed to the ledger. |
| `donation_intent` | A **Webhook** intent (donorName, amount, status: `pending`, …). | A donor checkout posts to `/api/webhook/donate`. |
| `raw_event` | A **RawEvent** (type, sender, body, category, amount, …). | The APK reports any event via `/api/apk/event`. |

### Listening for a new verified donation

```js
socket.on("newDonation", (entry) => {
  console.log("New donation:", entry.donorName, entry.amount);
  // e.g. prepend to the ledger list and bump the stats counters.
  prependToLedger(entry);
  bumpTotals(entry.amount);
});
```

### Listening for a pending donor intent

```js
socket.on("donation_intent", (intent) => {
  // Show a "pending donation" row until it becomes a newDonation.
  showPendingIntent(intent);
});
```

### Listening for raw device events (live activity feed)

```js
socket.on("raw_event", (event) => {
  if (event.category === "PAYMENT") {
    showActivity(`Payment notification: ${event.amount}`);
  }
});
```

## Complete Socket.io client module

```js
// src/realtime.js
import { io } from "socket.io-client";
import { SOCKET_URL } from "./config";

let socket;

export function connectRealtime({ onDonation, onIntent, onRawEvent, onStatus } = {}) {
  const user = JSON.parse(localStorage.getItem("user") || "null");

  socket = io(SOCKET_URL, { transports: ["websocket"] });

  socket.on("connect", () => {
    onStatus?.("connected");
    if (user?.ngoId) socket.emit("join", user.ngoId);
  });

  socket.on("disconnect", () => onStatus?.("disconnected"));

  if (onDonation) socket.on("newDonation", onDonation);
  if (onIntent) socket.on("donation_intent", onIntent);
  if (onRawEvent) socket.on("raw_event", onRawEvent);

  return socket;
}

export function disconnectRealtime() {
  if (socket) {
    socket.disconnect();
    socket = undefined;
  }
}
```

Usage in a React component:

```jsx
import { useEffect } from "react";
import { connectRealtime, disconnectRealtime } from "./realtime";

function Dashboard() {
  useEffect(() => {
    connectRealtime({
      onStatus: (s) => console.log("Realtime:", s),
      onDonation: (entry) => addDonationToUI(entry),
      onIntent: (intent) => addPendingIntentToUI(intent),
      onRawEvent: (event) => addActivityToUI(event),
    });
    return () => disconnectRealtime();
  }, []);

  return <div>{/* ... */}</div>;
}
```

## ⚠️ Note on `accountStatusChanged` and `syncUpdate`

The current backend does **not** emit `accountStatusChanged` or `syncUpdate`
events. Only `newDonation`, `donation_intent`, and `raw_event` are emitted today.

You can safely register listeners for the two extra event names now — they
simply won't fire until the backend is updated to emit them:

```js
// These will not fire until backend support is added.
socket.on("accountStatusChanged", (account) => updateAccountRow(account));
socket.on("syncUpdate", (info) => updateSyncIndicator(info));
```

Until then, keep account status and last-sync time fresh by re-fetching
`GET /api/ngo/accounts` — for example after toggling an account, or on a light
polling interval. If you want these two events wired up on the backend, ask the
backend team to emit them (a) from the account toggle handler and (b) at the end
of each scraper sync, and this section can be updated to document their payloads.

---

*Generated from the live backend source. If a response ever differs from what's
documented here, the code in `ngo-backend/src/routes/` is the source of truth.*
