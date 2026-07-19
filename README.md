# P2P UPI Payment Gateway

A peer-to-peer UPI payment gateway platform (inspired by the P2P Expert model), consisting
of a backend API, four web panels, and a native Android client.

> ⚠️ **Status:** Project scaffold only. Folder structure, configs, and boilerplate are in
> place — **business logic is not implemented yet.**

## Monorepo layout

```
p2p-upi-gateway/
├── backend/              # Node.js + Express REST API + WebSocket (MySQL, Redis, BullMQ, JWT)
├── frontend/
│   ├── admin/            # Admin Panel        (React + Tailwind, :5173)
│   ├── trader/           # Trader Panel       (React + Tailwind, :5174)
│   ├── merchant/         # Merchant Panel     (React + Tailwind, :5175)
│   └── checkout/         # Customer Checkout  (React + Tailwind, :5176)
├── apk/                  # Android client (Kotlin, Gradle)
└── docs/                 # Architecture & API docs
```

## Components

| Component    | Stack                                             | Purpose                                    |
| ------------ | ------------------------------------------------- | ------------------------------------------ |
| **backend**  | Node 18, Express, Sequelize/MySQL, Redis, BullMQ  | REST + WebSocket API, queues, auth         |
| **admin**    | React 18, Vite, Tailwind                          | Platform administration & monitoring       |
| **trader**   | React 18, Vite, Tailwind                          | Trader dashboard (accept/confirm payments) |
| **merchant** | React 18, Vite, Tailwind                          | Merchant integration & settlements         |
| **checkout** | React 18, Vite, Tailwind                          | Customer-facing payment page               |
| **apk**      | Kotlin, Gradle, Retrofit                          | Trader mobile app                          |

## Getting started

Each component is self-contained with its own README, `package.json`/Gradle, and
`.env.example`. Start with the backend:

```bash
# 1. Backend
cd backend && cp .env.example .env && npm install && npm run dev

# 2. A frontend panel (repeat per panel)
cd frontend/admin && cp .env.example .env && npm install && npm run dev

# 3. Android — open the apk/ folder in Android Studio
```

### Prerequisites
- Node.js 18+
- MySQL 8+
- Redis 6+
- Android Studio (for the APK)

## Ports

| Service        | Port |
| -------------- | ---- |
| Backend API/WS | 4000 |
| Admin panel    | 5173 |
| Trader panel   | 5174 |
| Merchant panel | 5175 |
| Checkout page  | 5176 |

## Next steps (not yet implemented)
- Data models & migrations (users, traders, merchants, orders, transactions)
- Authentication & role-based authorization
- Order lifecycle + UPI payment matching
- WebSocket real-time events
- BullMQ job processors (payments, payouts, notifications)
- Panel UIs and API integration
