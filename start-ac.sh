#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Emergenthealth — Local AC Bridge starter
# Talks to AC via UDP (no Gree cloud needed), exposes via tunnel,
# auto-updates Vercel env var so URL changes are invisible.
#
# ONE-TIME SETUP:
#   1. Get a Vercel token: https://vercel.com/account/tokens
#   2. echo 'export VERCEL_TOKEN=xxxx' >> ~/.bashrc && source ~/.bashrc
#
# Then just run:  bash ~/start-ac.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO="${HOME}/emergenthealth"
BRIDGE="${REPO}/docker/ac-bridge/bridge.mjs"
AC_MAC="${GREE_MAC:-9424b8badd3b}"
AC_IP="${GREE_IP:-192.168.100.49}"
PORT="${PORT:-3001}"
VERCEL_TOKEN="${VERCEL_TOKEN:-}"

# ── 1. Kill stale processes ────────────────────────────────────
echo "→ Clearing old processes…"
pkill -f "node.*bridge" 2>/dev/null || true
pkill -f "cloudflared"  2>/dev/null || true
sleep 1

# ── 2. Pull latest bridge code ────────────────────────────────
if [ -d "$REPO/.git" ]; then
  echo "→ Pulling latest code…"
  git -C "$REPO" pull --quiet origin main 2>/dev/null || true
fi

# ── 3. Start local UDP bridge ─────────────────────────────────
echo "→ Starting local AC bridge (UDP → HTTP)…"
GREE_MAC="$AC_MAC" GREE_IP="$AC_IP" PORT="$PORT" node "$BRIDGE" &
BRIDGE_PID=$!
sleep 2

if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
  echo "✗ Bridge failed to start"
  exit 1
fi
echo "  ✓ Bridge PID $BRIDGE_PID on port $PORT"

# ── 4. Health check ───────────────────────────────────────────
for i in 1 2 3; do
  STATUS=$(curl -sf "http://127.0.0.1:${PORT}/health" 2>/dev/null || echo "")
  if echo "$STATUS" | grep -q "ok"; then
    echo "  ✓ Bridge healthy — $(echo "$STATUS" | grep -o '"devKey":"[^"]*"')"
    break
  fi
  sleep 1
done

# ── 5. Start cloudflared, capture URL, update Vercel ─────────
echo "→ Starting Cloudflare tunnel…"
echo ""

update_vercel() {
  local url="$1"
  local ewpe_url="${url}/apiv2"

  echo "  TUNNEL URL: ${ewpe_url}"

  if [ -z "$VERCEL_TOKEN" ]; then
    echo ""
    echo "  ┌──────────────────────────────────────────────────────────┐"
    echo "  │  Set manually in Vercel env vars:                        │"
    echo "  │  EWPE_API_URL = ${ewpe_url}"
    echo "  │                                                           │"
    echo "  │  For auto-update next time:                              │"
    echo "  │  Get token: https://vercel.com/account/tokens            │"
    echo "  │  echo 'export VERCEL_TOKEN=xxx' >> ~/.bashrc             │"
    echo "  └──────────────────────────────────────────────────────────┘"
    return
  fi

  echo "  → Auto-updating Vercel…"

  # Find the env var ID
  local project="emergenthealth"
  local team_slug="stano-salvatore"

  # List env vars, find EWPE_API_URL id
  local env_id
  env_id=$(curl -sf \
    "https://api.vercel.com/v9/projects/${project}/env?teamId=${team_slug}" \
    -H "Authorization: Bearer ${VERCEL_TOKEN}" \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
for e in d.get('envs',[]):
  if e.get('key')=='EWPE_API_URL':
    print(e['id'])
    break
" 2>/dev/null || echo "")

  if [ -z "$env_id" ]; then
    # Create new
    curl -sf -X POST \
      "https://api.vercel.com/v10/projects/${project}/env?teamId=${team_slug}" \
      -H "Authorization: Bearer ${VERCEL_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"EWPE_API_URL\",\"value\":\"${ewpe_url}\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\",\"development\"]}" \
      > /dev/null && echo "  ✓ Created EWPE_API_URL in Vercel"
  else
    # Update existing
    curl -sf -X PATCH \
      "https://api.vercel.com/v9/projects/${project}/env/${env_id}?teamId=${team_slug}" \
      -H "Authorization: Bearer ${VERCEL_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"value\":\"${ewpe_url}\"}" \
      > /dev/null && echo "  ✓ Updated EWPE_API_URL in Vercel"
  fi

  # Redeploy latest
  local deploy_id
  deploy_id=$(curl -sf \
    "https://api.vercel.com/v6/deployments?projectId=${project}&teamId=${team_slug}&limit=1" \
    -H "Authorization: Bearer ${VERCEL_TOKEN}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['deployments'][0]['uid'])" 2>/dev/null || echo "")

  if [ -n "$deploy_id" ]; then
    curl -sf -X POST "https://api.vercel.com/v13/deployments" \
      -H "Authorization: Bearer ${VERCEL_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"deploymentId\":\"${deploy_id}\",\"name\":\"emergenthealth\",\"target\":\"production\"}" \
      > /dev/null && echo "  ✓ Redeploy triggered"
  fi
}

trap "echo ''; echo 'Stopping bridge (PID $BRIDGE_PID)…'; kill $BRIDGE_PID 2>/dev/null; exit 0" INT TERM

npx cloudflared tunnel --url "http://127.0.0.1:${PORT}" 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
    update_vercel "${BASH_REMATCH[1]}"
  fi
done
