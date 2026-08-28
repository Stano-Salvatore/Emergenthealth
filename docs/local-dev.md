# Running Emergenthealth locally

Until recently there was no way to do this. The app connects through
`@prisma/adapter-neon`, which speaks the Postgres wire protocol inside a
WebSocket, so "just point `DATABASE_URL` at localhost" does not work — and the
consequence was that the app had never actually been run outside a deployment.
Two of the bugs fixed on 2026-08-27 were visible on the first screenshot anyone
took of it.

The setup below keeps the app connecting exactly the way it does in production
— same client, same adapter — and puts a small bridge under it instead.

## One-time

```bash
# 1. A local Postgres on 5433 (any Postgres will do; this is the Debian layout)
sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/emergi -U postgres --auth=trust
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/emergi \
  -o '-p 5433 -c listen_addresses=127.0.0.1' -l /var/lib/postgresql/emergi/pg.log start
psql -h 127.0.0.1 -p 5433 -U postgres -c 'create database emergi;'
```

```bash
# 2. .env.local — LOCAL_PG is what routes the driver through the bridge
cat > .env.local <<'ENV'
DATABASE_URL="postgresql://postgres@127.0.0.1:5433/emergi"
DIRECT_URL="postgresql://postgres@127.0.0.1:5433/emergi"
AUTH_SECRET="local-dev-only"
AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
LOCAL_PG="1"
ENV
```

```bash
# 3. Schema
npx prisma db push
```

`.env.local` is gitignored. `LOCAL_PG` exists only there; if it were ever set
in a real environment the driver would try to reach 127.0.0.1 and fail loudly
rather than touching anything.

## Every session

```bash
npm run dev:proxy   # ws -> tcp bridge on 5434, leave running
npm run dev:seed    # a demo account + 30 days of invented data
npm run dev         # http://localhost:3000
```

## Signing in without Google

Auth is Google-only, but sessions are **database** sessions — so a row in
`Session` plus a matching cookie *is* a signed-in browser. `npm run dev:seed`
writes that row and prints the cookie to set:

```
authjs.session-token=demo-session-token-local-only
```

The seeded data is invented and deterministic (a sine wobble rather than
`Math.random`, so two runs are comparable). It includes a deliberate run of
short nights so trends have a shape, saved places with automatic check-ins, and
habits with gaps.

## The smoke test

```bash
npm run smoke                      # against the dev server above
BASE_URL=https://… npm run smoke   # or a deployment
```

It loads every main screen at 390px in a real browser and fails on:

- a screen that does not answer 200, or throws an uncaught error
- **anything painted on top of the fixed bottom nav**
- **a loading skeleton still animating after the page has settled**
- a page that scrolls sideways

Those first two are not arbitrary. On 2026-08-27 the Privacy and Terms links
were printed over the "Habits" and "Settings" labels on every phone-width
dashboard screen, and the weather skeleton could pulse for the rest of the
session if a location prompt went unanswered — while 432 unit tests passed.
Neither is expressible as a unit test. Both were caught by this in under a
minute, and re-checked by reintroducing each bug and watching it fail.

Screenshots land in `.ci/smoke-shots/` (gitignored) whether it passes or not,
which is usually the fastest way to see what it saw.

### What it does not cover

Anything needing a real device: background location through a night, the
foreground-service notification, the chat head. And it does not call Anthropic
— without `ANTHROPIC_API_KEY` the chat screen renders but Emergy cannot answer.
