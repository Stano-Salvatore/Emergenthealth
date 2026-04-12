#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Emergenthealth AC Bridge — Crostini / Linux quick-start
# Run this script whenever you want AC control to work.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE="$SCRIPT_DIR/scripts/ewpe-bridge.mjs"
PORT="${PORT:-3001}"

echo ""
echo "  ██████╗ ██████╗ ██╗██████╗  ██████╗ ███████╗"
echo "  ██╔══██╗██╔══██╗██║██╔══██╗██╔════╝ ██╔════╝"
echo "  ██████╔╝██████╔╝██║██║  ██║██║  ███╗█████╗  "
echo "  ██╔══██╗██╔══██╗██║██║  ██║██║   ██║██╔══╝  "
echo "  ██████╔╝██║  ██║██║██████╔╝╚██████╔╝███████╗"
echo "  ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝  ╚═════╝ ╚══════╝"
echo "  Emergenthealth AC Bridge"
echo ""

# ── 1. Kill any stuck node processes on bridge port ───────────
echo "→ Clearing port $PORT..."
if lsof -ti ":$PORT" &>/dev/null; then
  lsof -ti ":$PORT" | xargs kill -9 2>/dev/null || true
  sleep 1
  echo "  Cleared."
else
  echo "  Port $PORT is free."
fi

# Also kill any lingering cloudflared processes
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 0.5

# ── 2. Start the bridge ────────────────────────────────────────
echo ""
echo "→ Starting bridge on port $PORT..."
PORT="$PORT" node "$BRIDGE" &
BRIDGE_PID=$!
sleep 2

if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
  echo "  ✗ Bridge failed to start. Check the output above."
  exit 1
fi
echo "  ✓ Bridge running (PID $BRIDGE_PID)"

# ── 3. Health-check the bridge ────────────────────────────────
echo ""
echo "→ Health-checking bridge..."
for i in 1 2 3; do
  if curl -sf "http://127.0.0.1:$PORT/health" &>/dev/null; then
    echo "  ✓ Bridge is healthy"
    break
  fi
  sleep 1
done

# ── 4. Start Cloudflare tunnel ────────────────────────────────
echo ""
echo "→ Starting Cloudflare tunnel..."
echo "  (This will print a trycloudflare.com URL — copy it!)"
echo ""
echo "  ┌─────────────────────────────────────────────────────┐"
echo "  │  Once you have the URL, set in Vercel env vars:     │"
echo "  │  EWPE_API_URL = https://<url>/apiv2                 │"
echo "  │  EWPE_EMAIL   = your Gree/EWPE Smart account email  │"
echo "  │  EWPE_PASSWORD = your Gree/EWPE Smart password      │"
echo "  │  Then: vercel --prod (or trigger redeploy in UI)    │"
echo "  └─────────────────────────────────────────────────────┘"
echo ""

# Trap Ctrl+C to clean up bridge process
trap "echo ''; echo 'Stopping bridge (PID $BRIDGE_PID)...'; kill $BRIDGE_PID 2>/dev/null; exit 0" INT TERM

npx cloudflared tunnel --url "http://127.0.0.1:$PORT"
