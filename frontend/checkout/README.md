# Customer Checkout — P2P UPI Payment Gateway

React + Vite + Tailwind CSS frontend for the **Customer Checkout**.

## Stack
- React 18 + Vite
- Tailwind CSS
- React Router
- Zustand (state)
- Axios + socket.io-client (API/realtime)

## Getting started
```bash
cp .env.example .env
npm install
npm run dev      # http://localhost:5176
```

## Structure
```
src/
├── components/   # reusable UI
├── pages/        # route views
├── layouts/      # shells (sidebar/header)
├── routes/       # router config
├── services/     # API + socket clients
├── hooks/        # custom hooks
├── store/        # zustand stores
├── context/      # React contexts
├── utils/        # helpers
└── assets/       # static assets
```

> ⚠️ Business logic is not implemented yet — scaffold only.
