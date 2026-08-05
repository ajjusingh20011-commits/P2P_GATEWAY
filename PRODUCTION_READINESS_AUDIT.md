# Production Readiness Audit — Test VPS vs. Real Production

Report-only. Nothing in this pass was fixed, changed, or deployed. Findings are
split into **confirmed from code/config in this repo** vs. **needs live VPS
confirmation** (I do not have SSH access this session — see the command block
at the bottom to get me that data).

---

## 0. Executive summary

The application layer is in decent shape. The gaps are almost entirely in
**infrastructure that was never made a first-class, repeatable step**: nothing
here has a setup script, a few defaults are demo-grade values that were never
swapped for production ones, and two "mount this middleware" items
(rate-limiting, permissive CORS) were configured but never actually wired in
one backend and hard-coded open in the other. None of this is exotic — it's
the classic gap between "works on the box I happened to set up by hand" and
"survives a fresh server."

---

## 1. System-level — Playwright/Chromium (the one that already bit you)

**Confirmed from code:** `ngo-backend/src/services/webScraper.js` launches
`playwright`'s `chromium.launch()` — this is the live, real payment-detection
path for Web Login accounts (`ngo-backend/package.json` has `playwright: ^1.61.1`).

**Required first-install step for any future server** (do this before first
`npm install` fully succeeds, or right after):
```bash
cd ngo-backend
npx playwright install --with-deps chromium
```
`--with-deps` is what actually installs the missing system packages
(`libnss3`, `libatk-bridge2.0-0`, `libgbm1`, `libasound2`, etc. — the exact
list is Ubuntu/Debian-version-dependent, which is why `--with-deps` should be
used instead of hand-listing packages). Plain `npm install` does **not**
reliably pull the Chromium binary or its system libs — this is exactly the
gap that bit you. Document this as step 1 of the ngo-backend install, not an
afterthought.

**Also flagging:** `ngo-backend/package.json` depends on **both** `playwright`
(`^1.61.1`) and `puppeteer` (`^22.10.0`). Puppeteer is only referenced in
`scraperEngine.js` (already confirmed dead — `scrapePlatform()` returns `[]`)
and `proxyManager.js` (builds Puppeteer-shaped launch args for that dead
path). The live scraping path is 100% Playwright. Puppeteer downloads its own
bundled Chromium on install — meaning a fresh `npm install` on this repo
silently pulls down a **second, unused Chromium binary**. Not urgent, but
worth pruning before the real prod install (saves disk + install time, and
one less thing for `install --with-deps` confusion).

---

## 2. Other missing/native system dependencies

Checked every `package.json` in the stack (`backend`, `ngo-backend`, all 4
frontends, root) for native/build-tool-requiring modules:

| Package | Needs at install time | Status |
|---|---|---|
| `bcryptjs` (backend + ngo-backend) | **Nothing** — pure JS, not the native `bcrypt` package. Good, no `node-gyp`/build-essential needed for this. | ✅ fine |
| `playwright` | Chromium binary + system libs | ⚠️ see §1 |
| `puppeteer` | Its own Chromium binary | ⚠️ unused, see §1 |
| `qrcode` | Pure JS | ✅ fine |
| `sharp` / `canvas` / `jimp` / ffmpeg | grep across all `package.json` files: **not used anywhere in this codebase** | ✅ nothing to install |
| `sqlite3` / other native DB drivers | Not present — `mysql2` (pure JS driver) and `mongoose` (pure JS) only | ✅ fine |

**Node version:** both `backend/package.json` and `ngo-backend/package.json`
declare `"engines": { "node": ">=18.0.0" }`. Need the VPS's actual `node -v`
to confirm it satisfies this (see command block).

**Conclusion:** Playwright/Chromium is the *only* real native-dependency risk
in this stack. Nothing else needs `build-essential`/`node-gyp`/image or video
libs. Good news — §1 was the hard one, not the first of many.

---

## 3. MySQL/MariaDB and MongoDB version match

**MySQL/MariaDB — confirmed via migration source, not guesswork.** Two
migrations (`20260722000001-add-active-amount-lock-index.js`, the same-amount
lock, and `20260729000002-add-settled-utr-lock-index.js`, a UTR lock) each add
a `VIRTUAL GENERATED` column with a `UNIQUE` index on it — this is the
DB-level backstop for the routing engine's same-amount/same-UTR locks. The
first migration's own comment states the dev DB it was written and verified
against: **"MariaDB 10.4.32, which supports indexing VIRTUAL generated
columns (InnoDB, since MariaDB 10.2 / MySQL 5.7)."** So the hard floor is
MariaDB ≥10.2 or MySQL ≥5.7 — anything older will fail these two migrations
outright. Need the VPS's actual `mysql --version` / `SELECT VERSION();` to
confirm it's at or above what dev was built against (ideally matching
10.4.x, not just the bare minimum).

**MongoDB — no version-specific features found.** Grepped the whole
`ngo-backend` for Mongo transactions (`startSession`/`withTransaction`) —
none exist; every write is a single-document operation. That means MongoDB
does **not** need to run as a replica set (transactions are the main reason
you'd need one). Any reasonably current MongoDB (4.4+) compatible with
Mongoose 8.4.0 should work. Still get the VPS's live `mongod --version` to be
sure it's not something ancient left over from initial setup.

---

## 4. Redis version — RESOLVED (2026-08-05)

**Update:** Production Redis is now v7.0.15 and the worker process is
running — confirmed via `backend/src/loaders/redis.js`'s own live version
check (`isQueueUsable()`), which self-detects the connected server's
version at runtime rather than hardcoding an assumption, so no code change
was needed once the upgrade landed. Settlement/heartbeat-check jobs should
now be running via BullMQ; worth a one-time confirmation that a settlement
has actually fired on schedule since the upgrade, per step 5 below. The
original finding is kept below for the audit trail.

**Original finding (now stale) — current state was Redis 3.0.504:** `bullmq`
(`^5.7.0` in `backend/package.json`) requires Redis ≥5 — this is a hard
BullMQ requirement, not a soft compatibility note. Effect, per
`DEVELOPMENT_TODO.md`'s own risk log: **heartbeat-check and settlement jobs
do not run at all** on this box (only the in-process order-expiry sweep,
which doesn't need BullMQ, still works). Traders can silently stay marked
online after going offline; daily settlement doesn't auto-run and has to be
triggered manually via `POST /api/admin/settlements/trigger`.

**What upgrading requires:**
1. Confirm the VPS's OS/distro (`cat /etc/os-release`) — Redis 3.0.504 reads
   like a very old distro-repo package, not a manually-installed build.
2. Install Redis ≥5 (ideally 6.x/7.x) from the official Redis APT repo or
   `redis-stack` — the distro's default repo almost certainly still ships
   something ancient given what's currently installed.
3. Stop the old `redis-server`, ensure the new one binds the same
   `REDIS_HOST`/`REDIS_PORT` both `.env` files already expect
   (`127.0.0.1:6379` in both `backend/.env.example` and
   `ngo-backend/.env`/`.env.local`) — no code or `.env` changes needed if the
   port matches.
4. Restart the backend worker process (`npm run worker` / its PM2 process) so
   BullMQ actually picks up the new Redis and the heartbeat-check/settlement
   jobs start running.
5. Verify via `GET /api/health` (already returns `redis: connected/disconnected`)
   and by checking the settlement job actually fires on schedule after the
   swap.

This is a real must-fix, not a nice-to-have — settlement not auto-running is
a business-correctness issue, not just a performance one.

---

## 5. Seed data a fresh deployment needs (nothing here is automatic)

Checked every path that creates baseline records. None of this happens on
its own — a truly fresh DB (MySQL migrated, Mongo empty) boots into an
**unusable** state without manual intervention:

| What | Where it's created | Automatic? |
|---|---|---|
| MySQL admin user | `backend/seeders/seed.js` (`admin@p2p.com`) OR `backend/src/seeders/demo-test-seed.js` (no admin — traders/merchants only) | **No** — must be run manually, and these are two *different, overlapping* seed scripts (see caveat below) |
| MySQL demo traders/merchants | Same two files, different email domains (`@p2p.com` vs `@test.com`) and different UPI IDs | **No** |
| **NGO org + `ngo_staff` account** (`staff@bright.org`/`staff123`, hardcoded in `frontend/trader/src/lib/ngoApi.js`) | **No seeder exists for this at all.** This has to be created by hand directly against `ngo-backend`'s Mongo (`NGO` doc + `User` doc with role `ngo_staff` and that exact email/password) — this is the exact gap you hit already. | **No — and nothing in the repo automates it** |
| MySQL default `settings` rows (exchange rate, fee %, commission defaults — `rateService.js`/`settingsService.js` read these) | Not covered by either seeder above — need to confirm these have defaults baked into the model or genuinely require a manual settings-table insert | **Needs verification** — check `backend/src/models/setting.model.js` defaults live, don't assume |
| Payment-detail ↔ NGO-account mirror sync | `Offers.jsx`'s `syncNgoAccountToPaymentDetail` (client-side, best-effort, silent-`console.error`-on-failure per existing architecture notes) | Only happens if a trader actually opens Offers.jsx and the sync succeeds — **not a deployment-time seed concern, but confirms nothing server-side backfills this** |

**Caveat worth flagging on its own:** `backend/seeders/seed.js` (root-level)
was called "legacy/empty" in `DEVELOPMENT_TODO.md` — that's now **wrong/stale**.
It's real, non-empty, and creates a *different* demo dataset
(`admin@p2p.com`/`trader1@p2p.com`/`trader2@p2p.com`) than
`backend/src/seeders/demo-test-seed.js` (`trader1@test.com`/`trader2@test.com`/
`trader3@test.com`). If both were ever run against the same database at
different points, that's a very plausible source of the "3 duplicate demo UPI
rows" you flagged in §15 below — two independent seed scripts, never
reconciled, each inserting their own UPI rows. Worth a direct
`SELECT upi_id, COUNT(*) FROM payment_details GROUP BY upi_id HAVING COUNT(*)>1;`
on the live DB to confirm and clean up.

## 6. Should this be a real one-time setup script?

**Yes, recommended.** Right now "set up a fresh server" is: run one of two
overlapping SQL seeders by hand, then separately hand-create a Mongo NGO org
+ staff user that has no seeder at all, then (per §5) possibly hand-verify
settings defaults. That's exactly the shape of gap that produces "found it
the hard way" incidents like the Web Login one. A single
`scripts/bootstrap-fresh-server.sh` (or a Node script) that: runs migrations,
runs **one** canonical seeder (retire the other), creates the NGO org +
`ngo_staff` account in Mongo, and verifies/inserts default settings rows —
would turn a multi-step tribal-knowledge process into one command. This
should happen before the real production VPS is stood up, not after.

---

## 7. HTTPS/TLS status

**Confirmed from `deploy/PHASE2_RUNBOOK.md` (already staged in-repo):** DNS
propagation for `adminmaxedge.com` + 6 subdomains is in progress. The runbook
already has the exact remaining steps queued:
1. Verify DNS via `dig`/`nslookup` from an *external* resolver (not from the
   VPS itself — local DNS caching can give a false positive).
2. Stage the HTTP-only nginx config (`deploy/nginx/adminmaxedge.com.conf`) —
   per the runbook this step needs no DNS and can be done right now if not
   already done.
3. Run `certbot --nginx` for all 7 names once DNS confirms.
4. Update `backend/.env` (`FRONTEND_*_URL`, `CORS_ORIGINS`, `WS_CORS_ORIGINS`)
   from the current `http://198.44.140.74:517x` values to the HTTPS domains.
5. Rebuild all 4 frontends with the new API base URLs.
6. Update the APK's `SERVER_BASE_URL` (see §14).

**Current live state (currently `http://198.44.140.74:...` everywhere,
confirmed in `backend/.env` and the APK's `Config.java`) needs the VPS
command block below to confirm exactly where DNS/certbot actually stand
right now** — the runbook describes the plan, not necessarily what's already
been executed.

---

## 8. `/api/internal/*` reachability

**Confirmed from code:** `backend/src/routes/internalRoutes.js` (mounted at
`/api/internal`) and `ngo-backend/src/routes/internal.js` (`GET
/api/internal/upi-check`) are both **explicitly unauthenticated by design** —
the ngo-backend file's own header comment states the trust model outright:
*"Unauthenticated, same trust model as POST /api/checkout/verify: both
services run on a private network in this deployment."* That design is only
as safe as the network actually being private. This is a config-outside-repo
concern — whether these ports/paths are reachable from the public internet
depends entirely on VPS firewall rules and/or nginx routing, neither of
which is in this repo. **Needs live confirmation** — see command block
(checking whether port 4000/3000 are firewalled from outside, and whether
nginx proxies `/api/internal/*` at all from the public-facing vhosts).

---

## 9. UPI uniqueness, rate limiting, CORS

**UPI uniqueness — confirmed real and cross-database.** `ngo-backend`'s
`GET /api/internal/upi-check` (see §8) is called by the MySQL backend before
creating/updating a `payment_details` row specifically to enforce uniqueness
*across both databases* (its own comment explains the `exclude_account_id`
param exists to stop the trader-panel mirror sync from false-positive-
rejecting itself). `ngo.js`'s own `POST /accounts` also calls
`assertUpiAvailable`/`UpiTakenError` before creating a Mongo `Account`. This
looks production-appropriate as designed — no gap found here.

**Rate limiting — confirmed NOT mounted, this is a real current gap, not a
stale doc claim.** `backend/src/config/index.js` defines
`rateLimitWindowMs`/`rateLimitMax` from env, and `express-rate-limit` is a
real dependency in `backend/package.json` — but `backend/src/app.js`
(read in full) never calls `require('express-rate-limit')` or mounts it
anywhere. `DEVELOPMENT_TODO.md` flagged this as a P0 item; it is **still
true today**, not resolved. `ngo-backend/server.js` has no rate limiting at
all, on any route, including the fully-public `/api/checkout/verify` and
`/api/checkout/status/:verifyId` (donor/customer-facing, unauthenticated).

**CORS — split finding, one side is fine, one side is a real problem.**
- `backend/src/app.js`: `cors({ origin: config.corsOrigins, credentials: true })`
  — env-driven, defaults to the known frontend origins, not wildcard. ✅ fine,
  standard practice, just needs the `.env` update in §7 step 4 once HTTPS
  domains are live.
- `ngo-backend/server.js`: **hardcoded to allow every origin unconditionally**
  — `cors({ origin: function(origin, callback) { callback(null, true); }, credentials: true })`.
  The comment literally says `// Allow all origins for now`. This is **not**
  reading `CORS_ORIGINS` from `.env` at all — `ngo-backend/.env` (production)
  doesn't even set that variable, and even the `.env.local` (dev) copy that
  does set it is unused by the actual code. This is a real, current,
  code-level fix needed before production — not a config toggle, the
  `server.js` CORS callback itself needs to change to actually check an
  allow-list.

---

## 10. `.env` audit — dev/demo values still present

**`ngo-backend/.env` (production file):**
- `JWT_SECRET=ngo_jwt_secret_2026_secure` — low-entropy, human-composed,
  literally contains the word "secure" in plaintext. Must be replaced with a
  real random secret before production.
- `ENCRYPTION_KEY=ngo_encrypt_key_32chars_2026!!` — same problem, and this
  one is more serious: it's the key `utils/encryption.js` uses to encrypt
  **stored trader UPI-platform login credentials** (`encryptedLoginEmail`/
  `encryptedLoginPassword`/`encryptedLoginPhone` on Web Login `Account`
  docs). A guessable, checked-into-`.env` key here means every trader's
  Paytm/platform login password is only as protected as this string is
  secret. This needs a real random key before any production trader
  connects a Web Login account for real.
- No `CORS_ORIGINS` set at all (moot per §9 until the code itself is fixed
  to honor it).

**`backend/.env`:** `JWT_SECRET`/`JWT_REFRESH_SECRET` are both set (26 chars,
same value reused for both per an explicit in-file comment explaining that
tradeoff) — reasonable length, but worth regenerating with a real
cryptographically-random value for production rather than trusting whatever
was typed in for the test VPS. `DB_PASSWORD` is empty (root, no password) —
fine for a locked-down single-tenant VPS MySQL bound to localhost, but
confirm that's still true in production (MySQL not listening on a public
interface).

**Demo accounts:** both seeders (§5) create accounts with **known, published
passwords** (`Demo@12345` referenced in `DEVELOPMENT_TODO.md`,
`Test@123456` in `demo-test-seed.js`, `Admin@123456`/`Trader@123456`/
`Merchant@123456` in the legacy `seed.js`). If either seed script has been
run against a database that will become production data (rather than a
throwaway test DB), these accounts need to be deleted or their passwords
rotated before going live — an attacker who's read any of this project's
own documentation now knows every demo credential.

**Needs live confirmation:** whether the VPS's actual `backend/.env` /
`ngo-backend/.env` match what's in this repo, or diverged after manual
on-VPS edits (the PHASE2_RUNBOOK explicitly flags this uncertainty for
`.env` vs `.env.production` too). See command block.

---

## 11. PM2 auto-start on reboot

**No PM2 ecosystem config exists anywhere in this repo** — no
`ecosystem.config.js`, no PM2 references in any script or doc. That means
however PM2 is currently running both backends on the VPS, it was set up
by hand, directly on the box, and isn't version-controlled or reproducible.
Two separate questions need live confirmation:
1. Is PM2 actually managing both `backend` (API + worker) and `ngo-backend`
   right now, or were they started with `npm start`/`nohup` directly?
2. Has `pm2 startup` + `pm2 save` actually been run, so a full server reboot
   brings both back automatically? "Currently running" and "survives a
   reboot" are different guarantees — this is exactly the kind of thing that
   looks fine until the VPS reboots for a kernel update and nothing comes
   back up. See command block.

**Recommendation regardless of current state:** commit an
`ecosystem.config.js` to the repo (covering `backend` API, `backend` worker,
and `ngo-backend`) so "how is this process supposed to run" is documented
and reproducible, not tribal knowledge on one VPS.

---

## 12. Database backup strategy

**Confirmed: no automated backup exists in this repo** — no cron entries,
no backup scripts, nothing referencing `mysqldump`/`mongodump` anywhere in
the codebase. The only backup on record is the one manual dump taken before
running migrations (mentioned in your prompt, not something I can find
independent evidence of in-repo — makes sense, a manual one-off wouldn't be).
This needs to be a real, scheduled, automated job (daily `mysqldump` +
`mongodump`, rotated, ideally shipped off-box — not just sitting on the same
VPS disk that would be lost in the same failure) before real money/users are
on this system. Needs live confirmation there isn't already a cron job doing
this that simply isn't reflected in the repo. See command block.

---

## 13. Error alerting/monitoring

**Confirmed: logging exists, alerting does not.** `backend/src/utils/logger.js`
is Winston with two transports: `Console` and a `File` transport writing to
`logs/app.log`. That's it — no Sentry, Datadog, New Relic, email, or webhook
transport of any kind (grepped both backends for all of these — zero hits).
`telegramService.js` exists and sends real Telegram messages, but it's
wired to specific **order/business events** (per the payment-flow audit),
not to unhandled exceptions or process crashes. Practically: if either
backend process crashes right now, the only trace is a line in a local log
file nobody is tailing — it will be "discovered hours later," exactly as you
suspected. This needs either an actual monitoring service (even a low-cost
one) or, as a minimum stopgap, a PM2-level crash notification (PM2 has a
`pm2-logrotate`/webhook-on-restart pattern, or a simple cron that checks
`pm2 jlist` process status and Telegram-alerts on a crash) before this
becomes something people rely on for real money.

---

## 14. APK — production URL and signing

**Confirmed from code:** `apk/app/src/main/java/com/example/paymentbot/Config.java`
still hardcodes `SERVER_BASE_URL = "http://198.44.140.74:3000"` — plain
HTTP, raw IP, not the eventual `https://ngo-api.adminmaxedge.com`. This is
already correctly sequenced in `deploy/PHASE2_RUNBOOK.md` as step 5, to be
done once DNS/certs are confirmed — not an oversight, just not done yet.

**Signing — confirmed real gap.** `apk/app/build.gradle.kts`'s `release {}`
block has `isMinifyEnabled = false` and proguard file references, but
**no `signingConfig` is declared anywhere in the file** — there's no
keystore, no `signingConfigs {}` block at all. That means there is currently
no way to produce a properly release-signed build from this project as-is;
whatever's being installed on test devices today is debug-signed (Android's
default debug keystore) even if built via `assembleRelease`. Debug-signed is
genuinely fine for continued internal testing. **Before real traders install
this on their own devices, this needs:** a real release keystore generated
and kept secure (not committed to the repo), a `signingConfigs {}` block
referencing it, and the `release` build type wired to use it. Also worth
reconsidering `isMinifyEnabled = false` for production (enabling ProGuard/R8
shrinking+obfuscation) given the earlier APK audit already flagged the
current build as fully unobfuscated.

---

## 15. Known deferred items — carried forward

Cross-checked each against current code where verifiable from this session
(some referenced a prior conversation not captured in this repo's docs or
memory — flagged where I could only carry the item forward, not re-verify it).

| Item | Verified this session? | Current status | Resolve before prod? |
|---|---|---|---|
| **Duplicate socket connection** | ✅ Re-verified, still true | `frontend/trader/src/hooks/useSocket.js` is a plain hook (not a shared context/singleton) — every component calling it opens its **own** `socket.io-client` connection. Confirmed both `TraderLayout.jsx:23` and `Trades.jsx:195` call `useSocket()` independently, meaning **two simultaneous WebSocket connections** to the backend exist for every trader session that has the Trades page open. | **Yes, before prod** — cheap fix (lift the socket into a context/provider), and duplicate connections multiply server-side socket load per trader linearly with pages using the hook. |
| **`smartphone_id` legacy field** | ✅ Re-confirmed via `DATABASE_MAP.md` and prior payment-flow audit | Real, documented legacy FK on both `payment_details` and `transactions` — the model's own code comment calls it dead, the live APK only ever talks to `ngo_device_id`/ngo-backend. | **Safe to defer** — it's inert, not actively wrong; a real cleanup (drop column + migration) is housekeeping, not a correctness risk. Don't let it block prod. |
| **"3 duplicate demo UPI rows"** | ⚠️ Partially — found a *plausible root cause* (§5: two independent, un-reconciled seed scripts), but couldn't confirm the live DB actually has 3 duplicate rows without DB access | Likely explained by `backend/seeders/seed.js` and `backend/src/seeders/demo-test-seed.js` both having been run at different times. | **Resolve before prod** — run the `GROUP BY upi_id HAVING COUNT(*)>1` query (§5), delete duplicates, and retire one of the two seed scripts so this can't recur. |
| **`/toggle` verification loophole** | ⚠️ Could not independently re-derive from this session's reading of `ngo.js`'s toggle handler or `webScraper.js`'s `initiateLogin` — the code appears to correctly gate `status:'live'` behind an actual successful cookie-reconnect or fresh OTP flow, not a blind flag-flip. This may refer to something more specific from the earlier conversation that flagged it (e.g., a race between toggle-on and a concurrent OTP submission, or the MySQL-side manual-confirm endpoint's separately-documented **actual, confirmed** loophole: `paymentController.js`'s manual-confirm handler has **no ownership check** — any trader or admin can confirm any order, not just their own, per the payment-flow audit). | Needs you to clarify which loophole this refers to — I don't want to claim it's resolved without being sure it's the same issue. | **Flag as open either way** — if it's the manual-confirm ownership gap, that's a real, already-documented, unresolved security issue and should be a P0 fix before real money moves through manual confirmation. |
| **Auto-refresh gaps (Trader/Admin/Merchant)** | ⚠️ Partially corroborated | `ADMIN_ARCHITECTURE.md` (from the earlier admin audit) explicitly states: *"Polling: none — the panel relies entirely on user-triggered refetch + the socket-driven order:update bridge... there is no periodic auto-refresh interval anywhere except the (broken) Dashboard live-feed simulator."* Matches the deferred item. Didn't re-audit Merchant/Trader polling behavior in this pass. | **Safe to defer** — this is a UX freshness gap (stale data until a manual refresh or a socket event happens to fire), not a correctness/money-safety issue, *provided* the socket connections themselves are reliable (which ties back to the duplicate-connection item above). |
| **Notification-pattern-per-role audit** | ❌ Not re-run this session | No prior written record found in this repo's docs/memory — likely discussed verbally in an earlier session. | **Safe to defer** — flagging as carried-forward only; needs a dedicated pass (compare toast/notification UX consistency across Admin/Trader/Merchant) whenever there's bandwidth, not a launch blocker on its own. |

---

## Recommended fix order before moving to the real production VPS

**P0 — blocks going live with real money, do these first:**
1. ~~Redis upgrade to ≥5 (§4)~~ — **DONE (2026-08-05)**, production is now
   v7.0.15. Worth a one-time confirmation a settlement has actually fired
   on schedule since the upgrade.
2. Rotate `ngo-backend/.env`'s `JWT_SECRET` and especially `ENCRYPTION_KEY`
   (§10) — the encryption key protects real trader login credentials.
3. Fix `ngo-backend`'s hardcoded-open CORS (§9) — code change, not just config.
4. Mount `express-rate-limit` in `backend/src/app.js`, and add basic rate
   limiting to `ngo-backend`'s public checkout endpoints (§9).
5. Resolve the manual-confirm ownership gap if that's what "`/toggle`
   loophole" refers to (§15) — confirm with whoever flagged it originally.
6. Delete/rotate demo accounts if the seeded database is the one going to
   production (§10).
7. Clean up the duplicate demo UPI rows and retire one of the two seed
   scripts (§5, §15).

**P1 — required before real traders use it day-to-day:**
8. Finish the HTTPS cutover per the already-staged `PHASE2_RUNBOOK.md` (§7),
   then update the APK's `SERVER_BASE_URL` (§14).
9. Confirm/harden `/api/internal/*` network isolation (§8) — needs live
   firewall/nginx check either way, do this alongside the HTTPS work since
   you'll be in the nginx config regardless.
10. Set up real release signing for the APK before distributing it beyond
    test devices (§14).
11. Write and test the actual bootstrap/seed script (§6) — do this *before*
    setting up the real production VPS so that VPS's first setup uses it,
    rather than repeating today's manual process a second time.
12. PM2 `ecosystem.config.js` committed + `pm2 startup`/`pm2 save` confirmed
    on whatever box is production (§11).

**P2 — important, not launch-blocking:**
13. Automated, scheduled, off-box database backups (§12).
14. Real crash/error alerting beyond console+file logs (§13).
15. Fix the duplicate socket connection (§15) — cheap, do it opportunistically.
16. Merchant/Trader auto-refresh gaps, notification-pattern audit (§15) —
    genuinely safe to defer further.

---

## Appendix — commands to run on the VPS and paste back

Everything below is **read-only** — no state changes. Grouped to match the
report sections above.

```bash
# --- §1/§2: versions & Playwright ---
node -v
npm -v
cat /etc/os-release
ls -la /root/.cache/ms-playwright/ 2>/dev/null || echo "no playwright cache found"
dpkg -l | grep -i libnss3   # sanity check one of the playwright system deps

# --- §3: MySQL/MariaDB + MongoDB versions ---
mysql --version
mysql -u root -e "SELECT VERSION();" 2>/dev/null
mongod --version

# --- §4: Redis version ---
redis-server --version
redis-cli INFO server | grep redis_version

# --- §7: HTTPS/DNS/certbot state ---
dig admin.adminmaxedge.com +short
dig api.adminmaxedge.com +short
sudo nginx -T 2>/dev/null | grep -A2 "server_name"
sudo certbot certificates 2>/dev/null
sudo systemctl list-timers | grep certbot

# --- §8: /api/internal exposure ---
sudo ufw status verbose 2>/dev/null || sudo iptables -L -n
curl -s -o /dev/null -w "%{http_code}\n" http://198.44.140.74:4000/api/internal/upi-check?upi_id=test
grep -rn "8084\|internal" /etc/nginx/sites-enabled/ 2>/dev/null

# --- §10: live .env drift check (do NOT paste secret values, just confirm keys/lengths match repo) ---
diff <(grep -o '^[A-Z_]*=' /path/to/live/backend/.env | sort) <(grep -o '^[A-Z_]*=' backend/.env.example | sort)

# --- §11: PM2 status + boot persistence ---
pm2 list
pm2 startup
pm2 save --force 2>&1 | head -5   # (read-only check; if it says "already saved" that's your answer)
systemctl is-enabled pm2-root 2>/dev/null

# --- §12: backup cron check ---
crontab -l
sudo crontab -l
ls -la /var/backups/ 2>/dev/null
grep -rln "mysqldump\|mongodump" /etc/cron.d/ /etc/systemd/system/ 2>/dev/null

# --- §13: monitoring/alerting check ---
pm2 list | grep -i "restart\|errored"
cat backend/logs/app.log 2>/dev/null | tail -50
```
