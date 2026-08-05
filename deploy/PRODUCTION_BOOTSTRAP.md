# Production bootstrap — what's automated vs. what needs a decision

Two scripts, run in order from the repo root on the VPS:

```bash
bash deploy/bootstrap-production.sh      # env files, secrets, migrations, npm install
# ... restart both pm2 processes ...
bash deploy/verify-deploy.sh             # confirms the NEW code is actually live
```

Both are idempotent — safe to re-run after every future `git pull`.

## What `bootstrap-production.sh` does automatically

- Creates `backend/.env` / `ngo-backend/.env` from the checked-in templates if missing.
- Generates `SERVICE_AUTH_SECRET` if absent from **both** files, and keeps them
  byte-identical (never overwrites an existing value — safe to re-run without
  invalidating live tokens).
- Generates `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (backend) and
  `ENCRYPTION_KEY` / `JWT_SECRET` (ngo-backend) if missing, same never-overwrite rule.
- Verifies the full required-env-var surface (everything the code actually
  reads via `process.env`, audited directly from source — not just the
  ones in `.env.example`, which is missing several: `SERVICE_AUTH_SECRET`,
  `NGO_BACKEND_URL`, `CORS_ORIGINS` are absent from one or both example
  files today). Fails loudly instead of letting the app fall back to an
  insecure default.
- `npm install --production` in both services.
- Runs backend's Sequelize migrations (schema only).

## What it deliberately does NOT do — these are real decisions, not defaults

**1. No demo/seed data.** The only seeder that creates traders/merchants/admin
(`backend/seeders/seed.js` or `npm run seed`) inserts a full fake dataset —
`admin@p2p.com`, `trader1@p2p.com`, `trader2@p2p.com`, `merchant@p2p.com`,
all with hardcoded passwords. If those exact accounts are already your real
production accounts (worth confirming — I don't know if production was
originally bootstrapped from this exact seeder or not), re-running it is a
no-op (it checks for `admin@p2p.com` first and skips). If they're not real
yet and you want them, run it once, then immediately rotate the admin
password — the hardcoded one (`Admin@123456`) is public in git history.

**2. No first-admin account created any other way.** `backend/` has no
`/register` endpoint at all — the seeder above is the only path to a first
admin. If you don't want the demo dataset, tell me and I'll write a
minimal script that creates just one admin user with a generated password.

**3. No NGO org/staff account.** The per-trader isolation redesign removed
the need for a shared NGO org for the trader-facing flow entirely —
`Account`/`Device`/`Transaction` are scoped by `traderId` now, not an NGO
doc. The **only** thing still using the old NGO-org+staff model is the
legacy donation-ledger feature (`GET /ledger`, `GET /stats` in
`ngo-backend/src/routes/ngo.js`), which is confirmed unreachable from the
trader frontend. If you're not using that feature, skip this entirely. If
you are, that's the `ops-admin@adminmaxedge.com` retirement question
that's already open separately — resolve that first rather than seeding a
second one.

## Non-obvious env vars the audit surfaced (easy to forget on a fresh box)

- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` (backend) — admin
  notifications integration.
- `PROXY_USERNAME` / `PROXY_PASSWORD` / `PROXY_POOL` (ngo-backend) —
  outbound proxy credentials for the web scraper.
- `SCRAPER_HEADLESS` (ngo-backend) — implies Chromium/Playwright must be
  installed on the box for the scraper to run at all; confirm it's
  present if the scraper is used in production.
- `CHECKOUT_BASE_URL` (ngo-backend) — used somewhere in the donation
  checkout flow; not in `.env.example`.

## Still open from before, unrelated to this bootstrap

- JWT_SECRET/ENCRYPTION_KEY rotation for the *existing* live values (item 2
  of the original 3-item readiness audit) — this script only fills in
  values that are **missing**, it never rotates a value that's already set,
  since that would invalidate every live session/encrypted record. That's
  still a separate, deliberate action to schedule.
- `ops-admin@adminmaxedge.com` retirement — waiting on your check of
  whether those 3 commands were ever actually run.
