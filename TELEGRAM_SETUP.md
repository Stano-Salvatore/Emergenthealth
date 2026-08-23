# Emergy on Telegram

Emergy outside the app: message him from the lock screen, and let him reach you
without the app being open.

## Why Telegram and not Messenger

Messenger needs a Facebook Page, Meta app review for `pages_messaging`, and
business verification. WhatsApp needs verification and a dedicated number, and
messages sent outside a 24-hour window must be **pre-approved templates that
cost money per conversation** — unprompted contact being precisely the thing
this was wanted for.

Telegram is a token from BotFather, no review, free, and a bot may message
anyone who has started it, whenever it likes. It is the only one of the three
where "he pops out of the screen" works without a business relationship with
Meta.

## Setup (about five minutes)

1. **Create the bot.** Message [@BotFather](https://t.me/BotFather) on Telegram,
   send `/newbot`, pick a name and a username. It replies with a token.

2. **Set the environment variables** in Vercel:

   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...      # from BotFather
   TELEGRAM_WEBHOOK_SECRET=<any long random string>
   TELEGRAM_BOT_USERNAME=your_bot            # optional, shown in Settings
   ```

   The webhook secret is not optional in spirit: the endpoint is public, and
   without it anyone who guesses the URL can post to it.

3. **Point Telegram at the webhook** — once, from a terminal:

   ```sh
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://emergenthealth.vercel.app/api/telegram/webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```

4. **Link your account.** Settings → *Emergy on Telegram* → **Get a code**, then
   send `/start <code>` to the bot. Codes last 15 minutes and are single use.

## What works

- The same brain and the same tools as the in-app chat, so logging works:
  *"200ml water and half an Atarax"* does there what it does here.
- Its own conversation thread, so follow-ups make sense — *"make that 300"*
  refers to what you just said.
- `/unlink` in the chat, or Disconnect in Settings.

## What is deliberately guarded

- A chat that is not linked gets an invitation to link and **nothing else** —
  never a fact about anyone's health.
- Requests without Telegram's secret header are ignored silently.
- 60 messages per hour per account: these are Opus calls, and a loop should
  stop rather than bill.
- The webhook always returns 200. Telegram retries non-2xx, so an error
  surfaced as a status code becomes the same failing message redelivered
  forever.

## Not built yet

Proactive nudges *to* Telegram. `sendTelegramToUser(userId, text)` exists and
works; no cron calls it yet. Wiring it up means deciding which nudges belong
there rather than in a phone notification — a taste question worth answering
deliberately rather than by default.
