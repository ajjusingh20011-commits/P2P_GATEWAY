# Backend — P2P UPI Payment Gateway

REST API + WebSocket server for the P2P UPI Payment Gateway.

## Stack

- **Runtime:** Node.js 18+ / Express
- **Database:** MySQL (via Sequelize)
- **Cache & Queues:** Redis + BullMQ
- **Realtime:** Socket.IO
- **Auth:** JWT (access + refresh tokens)
- **Logging:** Winston

## Project structure

```
backend/
├── src/
│   ├── config/         # env-driven config + Sequelize CLI config
│   ├── controllers/    # request handlers (thin)
│   ├── routes/         # express routers, mounted in routes/index.js
│   ├── middleware/     # auth, rate-limit, error handling
│   ├── models/         # Sequelize models + associations
│   ├── services/       # business logic (not implemented yet)
│   ├── validators/     # Joi request schemas
│   ├── jobs/           # BullMQ queues + workers
│   ├── websocket/      # Socket.IO server + handlers
│   ├── loaders/        # DB + Redis bootstrap
│   ├── utils/          # logger, helpers
│   ├── app.js          # express app factory
│   └── server.js       # HTTP + WS entrypoint
├── migrations/         # Sequelize migrations
├── seeders/            # Sequelize seeders
└── tests/
```

## Getting started

```bash
cp .env.example .env       # then fill in values
npm install
npm run dev                # API + WebSocket (nodemon)
npm run worker             # BullMQ workers (separate process)
```

## Scripts

| Script            | Description                          |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start API + WebSocket with nodemon   |
| `npm start`       | Start API in production mode         |
| `npm run worker`  | Start BullMQ workers                 |
| `npm run migrate` | Run database migrations              |
| `npm run seed`    | Run database seeders                 |
| `npm test`        | Run test suite                       |

> ⚠️ Business logic is not implemented yet — this is the project scaffold only.
