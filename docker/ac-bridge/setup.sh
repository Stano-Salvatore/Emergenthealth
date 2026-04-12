#!/bin/bash
# One-shot setup for the AC Bridge + Cloudflare Tunnel
# Run from the docker/ac-bridge directory:
#   bash setup.sh
#
# Prerequisites: Docker Desktop (or Docker Engine) + internet access
# Node.js is NOT needed on the host — cloudflared is fetched via npx

set -e
cd "$(dirname "$0")"

echo ""
echo "=== AC Bridge Setup ==="
echo ""

# ── 1. Build & start the container ───────────────────────────────────────────
echo "[1/3] Building and starting Docker container..."
docker compose up -d --build

# Wait until the HTTP server is up (max 30 s)
echo "      Waiting for bridge to start..."
for i in $(seq 1 15); do
  if curl -sf http://localhost:8088/health > /dev/null 2>&1; then
    echo "      ✓ Bridge is up"
    break
  fi
  sleep 2
done

# ── 2. Quick bind test ────────────────────────────────────────────────────────
echo ""
echo "[2/3] Testing AC connection (bind + status)..."
RESP=$(curl -sf -X POST http://localhost:8088/apiv2/aircon/devstatus \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"local","uid":"local","token":"local"}' 2>&1 || true)
echo "      Response: $RESP"

if echo "$RESP" | grep -q '"status":1'; then
  echo "      ✓ AC responding!"
else
  echo "      ✗ AC not responding yet — check logs with: docker compose logs"
  echo "        (May need AP isolation disabled on router, or AC on same subnet)"
fi

# ── 3. Start Cloudflare tunnel ────────────────────────────────────────────────
echo ""
echo "[3/3] Starting Cloudflare tunnel on port 8088..."
echo "      When the tunnel URL appears, add it to Vercel env vars as:"
echo "        EWPE_API_URL = https://<tunnel-url>/apiv2"
echo "      Then redeploy Vercel."
echo ""
echo "      Press Ctrl+C to stop the tunnel (bridge keeps running in Docker)"
echo ""

npx --yes cloudflared tunnel --url http://localhost:8088
