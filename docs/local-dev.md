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

The alarm is the fixed point and the bedtime follows from it, which is how
short nights actually happen. Seeded the other way round — a constant 23:20
start beside a duration wobbling by an hour and a half — every night began at
the same minute, so the engine's bedtime cut had nothing to split and the sleep
panel's bedtime card could not appear on a demo database at all. `upsert` here
is `update: {}`, so re-running the seed will not correct rows an older version
wrote; drop them first if the dates look wrong.

## The smoke test

```bash
npm run smoke                      # against the dev server above
BASE_URL=https://… npm run smoke   # or a deployment
```

It loads **every dashboard page** (all of them — the list in `.ci/smoke.mjs`
mirrors `find src/app/dashboard -name page.tsx`) at 390px in a real browser
and fails on:

- a screen that does not answer 200, or throws an uncaught error
- **any same-origin `/api/*` response of 500+** while the page loads
- **anything painted on top of the fixed bottom nav**
- **a loading skeleton still animating after the page has settled**
- a page that scrolls sideways

It also reports, as warnings that must never be ignored silently: 4xx API
answers, `console.error` output, and network-level request failures with
their URL and reason. Known-expected states (the briefing without an
`ANTHROPIC_API_KEY`, a source the account hasn't connected) are labelled on
the line, so an unlabelled warning is always new signal. Its first
full-coverage run caught a sync route answering 503 for a not-connected
user and the settings screen painting two sources twice under duplicate
React keys — neither reachable by any unit test.

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

## Rendering at a different hour

Three of the bug shapes this codebase keeps finding only show just after
midnight — a server component deciding "today" in UTC, the Check-in tab
picking its mode from the hour, the Week page drawing its week from Monday —
and no smoke run happens at 00:30. So the clock can be lied to, on both sides:

```bash
FAKE_NOW=2026-09-22T22:30:00Z NODE_OPTIONS=--require=./.ci/fake-clock.cjs npm run dev
FAKE_NOW=2026-09-22T22:30:00Z OUT=.ci/shots-0030 node .ci/render-at.mjs   # 00:30 in Bratislava
FAKE_NOW=2026-09-22T10:00:00Z OUT=.ci/shots-noon node .ci/render-at.mjs   # restart the server likewise
```

`fake-clock.cjs` shifts the server's `Date`; `render-at.mjs` shifts the
browser's and pins its timezone (`TZ_ID`, default Europe/Bratislava), then
writes a screenshot and the page's text per route so the two runs can be
diffed. It judges nothing — that is `smoke.mjs`'s job. The 3.3.6 dashboard
header that read "Tuesday, September 22" at 00:30 on the 23rd is what a
diff of those two text dumps looks like.
