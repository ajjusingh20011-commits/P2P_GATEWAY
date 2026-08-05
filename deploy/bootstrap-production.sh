#!/usr/bin/env bash
# deploy/bootstrap-production.sh
#
# One-time (but safe-to-re-run) setup for backend/ + ngo-backend/ on a
# production box. Run from the repo root, after `git pull origin main`:
#
#   bash deploy/bootstrap-production.sh
#
# What it does:
#   1. Creates backend/.env and ngo-backend/.env if missing (from templates).
#   2. Generates SERVICE_AUTH_SECRET if absent from BOTH files, and keeps
#      them identical — never overwrites a value that's already there.
#   3. Generates JWT_SECRET / JWT_REFRESH_SECRET (backend) and ENCRYPTION_KEY
#      (ngo-backend) if missing — same never-overwrite rule.
#   4. Checks every env var the code actually reads via process.env against
#      what's in each .env file and fails loudly (exit 1) if anything
#      required is missing, instead of letting the app fall back to an
#      insecure default or silently misbehave.
#   5. npm install (production) in both services.
#   6. Runs backend/'s Sequelize migrations (schema only — no data).
#   7. Does NOT run any seeder and does NOT create an NGO org — see
#      deploy/PRODUCTION_BOOTSTRAP.md for why those are separate,
#      confirm-first decisions, not something this script should guess at.
#
# Idempotent: re-running after values already exist changes nothing and
# exits 0. Safe to run again after every future `git pull`.

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
fail=0

gen_secret() { openssl rand -hex 32; }

# ---------------------------------------------------------------------------
# Step 1: ensure both .env files exist
# ---------------------------------------------------------------------------
if [ ! -f backend/.env ]; then
  if [ -f backend/.env.production ]; then
    cp backend/.env.production backend/.env
    echo -e "${YELLOW}Created backend/.env from .env.production template.${NC}"
  else
    cp backend/.env.example backend/.env
    echo -e "${YELLOW}Created backend/.env from .env.example template (no .env.production found).${NC}"
  fi
fi

if [ ! -f ngo-backend/.env ]; then
  cp ngo-backend/.env.example ngo-backend/.env
  echo -e "${YELLOW}Created ngo-backend/.env from .env.example template.${NC}"
fi

# ---------------------------------------------------------------------------
# helper: get/set a KEY=value line in a file, never clobbering an existing
# non-empty value.
# ---------------------------------------------------------------------------
get_val() { grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

set_if_missing() {
  local file="$1" key="$2" value="$3"
  local current; current=$(get_val "$file" "$key")
  if [ -z "$current" ]; then
    if grep -qE "^$key=" "$file" 2>/dev/null; then
      # key exists but empty -> replace the line
      sed -i "s|^$key=.*|$key=$value|" "$file"
    else
      echo "$key=$value" >> "$file"
    fi
    echo -e "  ${GREEN}+${NC} generated $key in $file"
  fi
}

# ---------------------------------------------------------------------------
# Step 2: SERVICE_AUTH_SECRET — must be byte-identical in both files.
# ---------------------------------------------------------------------------
echo "Checking SERVICE_AUTH_SECRET..."
be_secret=$(get_val backend/.env SERVICE_AUTH_SECRET)
ngo_secret=$(get_val ngo-backend/.env SERVICE_AUTH_SECRET)

if [ -n "$be_secret" ] && [ -n "$ngo_secret" ] && [ "$be_secret" != "$ngo_secret" ]; then
  echo -e "${RED}FATAL: SERVICE_AUTH_SECRET differs between backend/.env and ngo-backend/.env.${NC}"
  echo "This breaks every trader<->NGO request. Fix manually — refusing to guess which is right."
  exit 1
elif [ -n "$be_secret" ] && [ -z "$ngo_secret" ]; then
  set_if_missing ngo-backend/.env SERVICE_AUTH_SECRET "$be_secret"
elif [ -z "$be_secret" ] && [ -n "$ngo_secret" ]; then
  set_if_missing backend/.env SERVICE_AUTH_SECRET "$ngo_secret"
elif [ -z "$be_secret" ] && [ -z "$ngo_secret" ]; then
  new_secret=$(gen_secret)
  set_if_missing backend/.env SERVICE_AUTH_SECRET "$new_secret"
  set_if_missing ngo-backend/.env SERVICE_AUTH_SECRET "$new_secret"
else
  echo "  already set and matching in both files."
fi

# ---------------------------------------------------------------------------
# Step 3: other secrets that must exist but must never be silently rotated
# once real data depends on them (real prod: only fills if truly empty).
# ---------------------------------------------------------------------------
echo "Checking JWT/encryption secrets..."
set_if_missing backend/.env JWT_ACCESS_SECRET "$(gen_secret)"
set_if_missing backend/.env JWT_REFRESH_SECRET "$(gen_secret)"
set_if_missing ngo-backend/.env ENCRYPTION_KEY "$(gen_secret)"
set_if_missing ngo-backend/.env JWT_SECRET "$(gen_secret)"

for f in backend/.env ngo-backend/.env; do
  if grep -qE "your_secret_here|your_key_here|dev_access_secret|dev_refresh_secret" "$f"; then
    echo -e "${RED}WARNING: $f still has a placeholder/default secret value. Replace it before going live.${NC}"
  fi
done

# ---------------------------------------------------------------------------
# Step 4: required-env-var check (fails loud rather than falling back)
# ---------------------------------------------------------------------------
echo "Verifying required env vars..."
require() {
  local file="$1" key="$2"
  if [ -z "$(get_val "$file" "$key")" ]; then
    echo -e "  ${RED}MISSING${NC} $key in $file"
    fail=1
  fi
}

# backend — required for the app to boot and behave correctly in prod
for key in NODE_ENV PORT DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD \
           REDIS_HOST REDIS_PORT SERVICE_AUTH_SECRET NGO_BACKEND_URL \
           CORS_ORIGINS WS_CORS_ORIGINS; do
  require backend/.env "$key"
done

# ngo-backend — required
for key in NODE_ENV PORT MONGODB_URL SERVICE_AUTH_SECRET JWT_SECRET \
           ENCRYPTION_KEY P2P_BACKEND_URL CORS_ORIGINS; do
  require ngo-backend/.env "$key"
done

if [ "$fail" -eq 1 ]; then
  echo -e "${RED}Fix the missing values above, then re-run this script.${NC}"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 5: install deps
# ---------------------------------------------------------------------------
echo "Installing backend/ dependencies..."
(cd backend && npm install --production)
echo "Installing ngo-backend/ dependencies..."
(cd ngo-backend && npm install --production)

# ---------------------------------------------------------------------------
# Step 6: schema migrations (backend only — ngo-backend/Mongoose builds
# indexes automatically on connect, nothing to run).
# ---------------------------------------------------------------------------
echo "Running backend/ DB migrations..."
(cd backend && npm run migrate)

echo -e "${GREEN}Bootstrap complete.${NC}"
echo
echo "NOT done automatically (see deploy/PRODUCTION_BOOTSTRAP.md):"
echo "  - No demo/seed data was inserted."
echo "  - No first-admin account was created."
echo "  - No NGO org/staff account was created."
echo "Restart both processes, then run deploy/verify-deploy.sh to confirm"
echo "the NEW auth code is actually the one serving traffic."
