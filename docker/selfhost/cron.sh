#!/bin/sh
# Runs the jobs in ./crontab against the app container, the way Vercel's cron
# called them: a GET with the shared CRON_SECRET as a bearer token.
set -eu

if [ "${1:-}" = "call" ]; then
  path="$2"
  code=$(curl -sS --max-time 300 -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $(cat /run/cron-secret)" \
    "${APP_INTERNAL_URL:-http://app:3000}${path}") || code="no answer"
  echo "$(date -u +%FT%TZ) ${path} -> ${code}" > /proc/1/fd/1
  exit 0
fi

: "${CRON_SECRET:?CRON_SECRET is not set — every job would be refused}"
# busybox crond hands jobs no environment, so the secret goes in a file only
# root can read.
umask 077
printf '%s' "$CRON_SECRET" > /run/cron-secret
grep -vE '^[[:space:]]*(#|$)' /crontab \
  | awk '{ print $1, $2, $3, $4, $5, "/cron.sh call", $6 }' > /etc/crontabs/root
echo "scheduled:"; cat /etc/crontabs/root
exec crond -f -l 8
