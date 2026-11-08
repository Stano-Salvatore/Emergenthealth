# Running Emergenthealth on your own server

The web app on a machine of your own instead of Vercel. The database stays on
Neon; only the web server moves. Written after Vercel paused the Hobby team on
5 November 2026 for Fluid Active CPU, with the pause running to 5 December.

What runs where once this is done:

| Piece | Where |
|---|---|
| Web app and API (`app` container) | your server, `127.0.0.1:3000` |
| The nine daily jobs from `vercel.json` (`cron` container) | your server |
| Reminder and data-sync runs | GitHub Actions, as before, pointed at your server |
| Database | Neon, as before |
| Public HTTPS address | a tunnel: Tailscale Funnel or Cloudflare Tunnel |

You need Docker with the compose plugin, and git. A Raspberry Pi 4 or 5 with
4 GB is enough; the build itself wants about 3 GB of memory.

## 1. A public HTTPS address

The phone, Google sign-in, Oura and Strava all have to reach the server, so it
needs an HTTPS address on the internet. Neither option below opens a port on
your router.

**Tailscale Funnel (free, no domain needed).**

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale funnel --bg 3000
```

The first `funnel` run prints a link to turn on HTTPS and Funnel for your
tailnet; open it, allow both, and run the command again. It then prints the
address, `https://<machine>.<tailnet>.ts.net`. That is your server's address
from here on. It survives reboots.

**Cloudflare Tunnel (needs a domain on Cloudflare).** In the Cloudflare
dashboard: Zero Trust → Networks → Tunnels → Create a tunnel, choose
Cloudflared, and copy the token. Add a public hostname such as
`health.example.com` pointing to the service `http://app:3000`. Put the token in
`.env` as `CLOUDFLARE_TUNNEL_TOKEN`, and start compose with
`--profile cloudflare` in step 3.

## 2. Configuration

```sh
git clone https://github.com/Stano-Salvatore/Emergenthealth.git
cd Emergenthealth/docker/selfhost
cp .env.example .env
```

Fill in `.env`:

- `NEXT_PUBLIC_APP_URL`: the address from step 1, no trailing slash.
- Everything else: the values from Vercel → emergenthealth → Settings →
  Environment Variables, copied across unchanged. `DATABASE_URL`, `AUTH_SECRET`
  and `CRON_SECRET` above all: a new `AUTH_SECRET` signs everyone out, and a
  different `CRON_SECRET` makes GitHub's runs fail.

`.env` is gitignored. Keep it that way: it holds every key the app has.

## 3. Start it

```sh
docker compose up -d --build
docker compose logs -f app
```

The first build takes several minutes. On start the app runs
`prisma db push` (what Vercel's build did) and then serves on port 3000. Open
the address from step 1 in a browser: the sign-in page should appear.

`docker compose logs cron` shows the job schedule, and one line per job each
time one runs.

## 4. Tell the outside world the new address

Each of these keeps a list of addresses it will send people back to after
sign-in, and refuses any other. Add the new one next to the Vercel one.

- **Google** (sign-in): console.cloud.google.com → APIs & Services →
  Credentials → the OAuth client → Authorized redirect URIs:
  `<address>/api/auth/callback/google`. Add `<address>` to Authorized
  JavaScript origins too.
- **Oura**: cloud.ouraring.com → My Applications → Redirect URIs:
  `<address>/api/oura/callback`.
- **Strava**: strava.com/settings/api → Authorization Callback Domain: the
  host alone, e.g. `homeserver.your-tailnet.ts.net`. Strava takes one domain,
  so this replaces `emergenthealth.vercel.app`.
- **Telegram** (if used): run the `setWebhook` command from
  `TELEGRAM_SETUP.md` with `<address>/api/telegram/webhook`.
- **Stripe** (if used): Developers → Webhooks → the endpoint → change its URL
  to `<address>/api/stripe/webhook`.
- **The Claude connector**: in Claude's connector settings, change its URL to
  `<address>/api/mcp`.

## 5. GitHub: point the jobs and the APK at the server

In the repository: Settings → Secrets and variables → Actions → Variables →
New repository variable: `APP_URL` = the address from step 1.

That one variable moves three things:

- the reminder runs (`reminders-cron.yml`) and data syncs (`sync-cron.yml`) to
  your server;
- the Android build to open your server instead of Vercel, sign-in hand-off
  included.

Then build a new APK: Actions → Build Android APK (signed) → Run workflow.
Install it from the `latest-android` release over the current app. Open the
app once: that also points the widgets and the background location service at
the new address.

Deleting the variable moves all three back to Vercel.

## Updating

```sh
cd Emergenthealth && git pull
cd docker/selfhost && docker compose up -d --build
```

Web changes still need no new APK. They now need this, where Vercel used to
deploy on every merge.

## If something is wrong

- **Sign-in loops back to the sign-in page.** `NEXT_PUBLIC_APP_URL` does not
  match the address in the browser, or Google's redirect URI was not added.
- **Every cron line in `docker compose logs cron` says 401.** `CRON_SECRET` in
  `.env` differs from the one the routes expect. It must be the same value as
  the `CRON_SECRET` repository secret on GitHub.
- **The app container keeps restarting.** `docker compose logs app`: a
  `prisma db push` that refuses a data-losing change stops it on purpose.
- **Neon's usage climbs.** The jobs run here exactly as often as they did on
  Vercel, so it should not. `database-sleeps.test.ts` explains why anything new
  on a short timer costs database time.
