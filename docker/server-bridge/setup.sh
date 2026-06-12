#!/usr/bin/env bash
# Gemmi Server Bridge — quick-start
# Builds and starts the bridge, then opens a Cloudflare tunnel.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-7070}"
TOKEN="${BRIDGE_TOKEN:-}"

echo ""
echo "  ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗"
echo "  ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗"
echo "  ███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝"
echo "  ╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗"
echo "  ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║"
echo "  ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝"
echo "  Gemmi Server Bridge"
echo ""

cd "$SCRIPT_DIR"

if [[ -z "$TOKEN" ]]; then
  TOKEN="$(openssl rand -hex 20)"
  echo "  → Generated BRIDGE_TOKEN: $TOKEN"
  echo "  (Set this in docker-compose.yml and in Vercel as SERVER_BRIDGE_TOKEN)"
  echo ""
fi

# Start bridge
BRIDGE_TOKEN="$TOKEN" docker compose up -d --build
echo "  ✓ Bridge started on port $PORT"

# Health check
echo "  → Checking bridge health..."
for i in 1 2 3 4 5; do
  if curl -sf -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/health" > /dev/null; then
    echo "  ✓ Bridge is healthy"
    break
  fi
  sleep 2
done

# Cloudflare tunnel
echo ""
echo "  → Starting Cloudflare tunnel..."
echo ""
echo "  ┌──────────────────────────────────────────────────────────┐"
echo "  │  Copy the trycloudflare.com URL and set in Vercel:       │"
echo "  │  SERVER_BRIDGE_URL = https://<url>                       │"
echo "  │  SERVER_BRIDGE_TOKEN = $TOKEN   │"
echo "  │  Then redeploy the Vercel app.                           │"
echo "  └──────────────────────────────────────────────────────────┘"
echo ""

trap "echo 'Stopping tunnel...'; exit 0" INT TERM
npx cloudflared tunnel --url "http://127.0.0.1:$PORT"
