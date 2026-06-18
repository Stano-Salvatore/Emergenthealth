#!/bin/sh
set -e

echo "→ Running Prisma migrations..."
npx prisma db push --skip-generate 2>/dev/null || \
  npx prisma migrate deploy 2>/dev/null || \
  echo "  (migration skipped — check DATABASE_URL)"

echo "→ Starting Gemmi..."
exec node server.js
