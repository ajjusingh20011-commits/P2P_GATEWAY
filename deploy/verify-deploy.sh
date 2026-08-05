#!/usr/bin/env bash
# deploy/verify-deploy.sh
#
# Confirms the running processes are actually serving the NEW code, not a
# stale pre-restart process still resident in PM2. This is the check that
# would have caught tonight's "generate-license still uses the old
# requireRole check" report immediately — that wasn't a code bug, it was
# an un-restarted process. Read-only: makes unauthenticated GET/POST
# requests and inspects error message TEXT (which differs between old and
# new middleware), never creates or touches real data.
#
# Usage: bash deploy/verify-deploy.sh [backend-base-url] [ngo-backend-base-url]
# Defaults to the values wired into the trader frontend's prod .env.

set -uo pipefail
BACKEND_URL="${1:-http://198.44.140.74:4000/api}"
NGO_URL="${2:-http://198.44.140.74:3000/api}"
RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
fail=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}OK${NC}  $desc"
  else
    echo -e "  ${RED}FAIL${NC} $desc"
    echo "        expected: $expected"
    echo "        got:      $actual"
    fail=1
  fi
}

echo "== backend/ proxy route exists and requires a real trader token =="
resp=$(curl -s "$BACKEND_URL/trader/ngo-proxy/ngo/accounts")
check "GET ngo-proxy/ngo/accounts, no token" \
  '{"success":false,"message":"Missing access token"}' "$resp"

echo
echo "== ngo-backend generate-license: NEW middleware, not the old requireRole check =="
resp=$(curl -s -X POST "$NGO_URL/apk/generate-license")
check "POST apk/generate-license, no auth" \
  '{"success":false,"message":"Missing service token or Authorization header"}' "$resp"
# The OLD (pre-deploy) code returns:
#   {"success":false,"message":"Missing or malformed Authorization header"}
# If you see that instead, the ngo-backend process was never restarted
# after the git pull — this script existing to catch exactly that.

echo
echo "== ngo-backend rejects a garbage service token rather than accepting it =="
resp=$(curl -s "$NGO_URL/ngo/accounts" -H 'X-Service-Token: garbage.not.a.token')
check "GET ngo/accounts, garbage X-Service-Token" \
  '{"success":false,"message":"Invalid or expired service token"}' "$resp"

echo
echo "== unrelated route still 404s normally (sanity check the server itself is up) =="
code=$(curl -s -o /dev/null -w '%{http_code}' "$NGO_URL/this-route-does-not-exist")
check "GET nonexistent route -> 404" "404" "$code"

echo
if [ "$fail" -eq 1 ]; then
  echo -e "${RED}One or more checks FAILED — the deploy is not fully live. See above.${NC}"
  echo "Most likely cause: git pull happened but pm2 restart did not (or restarted"
  echo "the wrong process name). Run: pm2 restart <backend> <ngo-backend>, then re-run this script."
  exit 1
else
  echo -e "${GREEN}All checks passed — new auth code is confirmed live on both services.${NC}"
  echo "Safe to proceed with the real two-trader isolation test."
fi
