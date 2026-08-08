# Phase 2 runbook — HTTPS cutover for adminmaxedge.com

Run this only after DNS has actually propagated. Check first, don't assume:

```
dig admin.adminmaxedge.com +short
dig app.adminmaxedge.com +short
dig api.adminmaxedge.com +short
```

Each must return `198.44.140.74` from an external resolver (not the VPS
itself — DNS caches locally, so checking from the VPS can give a false
positive). If you don't have `dig` handy, `nslookup admin.adminmaxedge.com`
or https://dnschecker.org works too. All 6 subdomains + apex should resolve
before running certbot, or certbot will simply fail domain validation for
whichever ones don't — safe to retry once they catch up.

## 1. Stage the HTTP-only config (safe to do right now, no DNS needed)

```
sudo cp deploy/nginx/adminmaxedge.com.conf /etc/nginx/sites-available/adminmaxedge.com.conf
sudo ln -s /etc/nginx/sites-available/adminmaxedge.com.conf /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/certbot
sudo nginx -t
sudo systemctl reload nginx
```

At this point all 6 subdomains + apex work over plain HTTP once DNS
resolves — verify with `curl -H "Host: admin.adminmaxedge.com" http://198.44.140.74/`
even before propagation finishes.

## 2. Once DNS is confirmed propagated — issue real certs

```
sudo apt-get install -y certbot python3-certbot-nginx   # if not already installed
sudo certbot --nginx \
  -d adminmaxedge.com \
  -d admin.adminmaxedge.com \
  -d app.adminmaxedge.com \
  -d merchant.adminmaxedge.com \
  -d checkout.adminmaxedge.com \
  -d api.adminmaxedge.com \
  -d ngo-api.adminmaxedge.com
```

The `--nginx` plugin edits each server block in place: adds `listen 443
ssl`, the cert/key paths, and an HTTP->HTTPS redirect on the existing port
80 block. Answer "yes" to the redirect prompt (or pass
`--redirect` non-interactively). Confirm afterward:

```
sudo nginx -t && sudo systemctl reload nginx
curl -I https://api.adminmaxedge.com/api/health
```

Certbot also installs a systemd timer for auto-renewal — verify with
`sudo systemctl list-timers | grep certbot`.

## 3. Update backend .env (CORS/WS origins)

In `backend/.env` (and `.env.production` if that's the one actually loaded
on the VPS — confirm which), replace every `http://198.44.140.74:517x`
entry with the HTTPS domain:

```
FRONTEND_ADMIN_URL=https://admin.adminmaxedge.com
FRONTEND_TRADER_URL=https://app.adminmaxedge.com
FRONTEND_MERCHANT_URL=https://merchant.adminmaxedge.com
FRONTEND_CHECKOUT_URL=https://checkout.adminmaxedge.com
CORS_ORIGINS=https://admin.adminmaxedge.com,https://app.adminmaxedge.com,https://merchant.adminmaxedge.com,https://checkout.adminmaxedge.com
WS_CORS_ORIGINS=https://admin.adminmaxedge.com,https://app.adminmaxedge.com,https://merchant.adminmaxedge.com,https://checkout.adminmaxedge.com
```

Also check the live Nginx/env config on the VPS itself for any leftover
reference to port 8084 (the user flagged this as decommissioned) — nothing
in this repo references that port, so it must be VPS-local config I can't
see without SSH access. Grep for it directly:
`grep -rn 8084 /etc/nginx/ backend/.env* 2>/dev/null` on the VPS.

Restart the backend process after editing (`pm2 restart` / systemd unit /
however it's actually run there).

## 4. Frontend .env + rebuild (done from this repo, then deploy the dist/ output)

Each of the 4 frontend `.env` files needs its IP:port URLs swapped for the
HTTPS domain, then a rebuild. This repo's assistant will do steps 4-7 of
the original Part A directly once step 2 above is confirmed done — no need
to hand-run this part.

## 5. APK

`apk/app/src/main/java/com/example/paymentbot/Config.java`'s
`SERVER_BASE_URL` -> `https://ngo-api.adminmaxedge.com`, and
`network_security_config.xml`'s cleartext exception gets removed (no
longer needed once traffic is real HTTPS). Also assistant-driven once DNS
is confirmed.
