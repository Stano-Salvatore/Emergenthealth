# Emergenthealth Dashboard

Personal live dashboard with Health, Finances, Google Calendar, Habits, Reminders, and Claude AI chat.

## Stack

- **Next.js 16** (App Router) + TypeScript
- **Tailwind CSS** + custom shadcn/ui components (dark theme)
- **Prisma 7** + Neon PostgreSQL
- **Auth.js v5** with Google OAuth (Calendar access)
- **Anthropic claude-opus-4-6** for AI chat with full data context
- **@actual-app/api** for Actual Budget sync
- **googleapis** for Google Calendar

## Setup

### 1. Clone and install

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

Required:
- `DATABASE_URL` + `DIRECT_URL` — Neon PostgreSQL connection strings
- `AUTH_SECRET` — run `openssl rand -base64 32`
- `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` — Google OAuth app (enable Calendar API)
- `ANTHROPIC_API_KEY` — from console.anthropic.com

Optional (Actual Budget sync):
- `ACTUAL_SERVER_URL` — must be publicly accessible from Vercel
- `ACTUAL_SERVER_PASSWORD`
- `ACTUAL_BUDGET_SYNC_ID` — from Actual → Settings → Sync

### 3. Google OAuth setup

In Google Cloud Console:
1. Create OAuth 2.0 credentials
2. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
3. Enable **Google Calendar API**

### 4. Database setup

```bash
npx prisma migrate dev --name init
```

### 5. Run locally

```bash
npm run dev
```

Open http://localhost:3000 — sign in with Google.

## Deploy to Vercel

1. Push to GitHub
2. Import in Vercel
3. Add all environment variables from `.env.example`
4. For `AUTH_URL`: set to your production URL (e.g., `https://yourdomain.vercel.app`)
5. For `AUTH_GOOGLE_ID` redirect: add `https://yourdomain.vercel.app/api/auth/callback/google`
6. Connect Neon DB via Vercel integration or paste connection strings manually

## Features

| Section | Description |
|---------|-------------|
| **Overview** | Summary cards for all sections |
| **Health** | Manual daily entry: sleep, steps, deep/REM sleep, HR |
| **Finances** | Actual Budget sync — spending by category, transaction list |
| **Calendar** | Google Calendar — upcoming 14 days |
| **Habits** | Create habits, track streaks, mark complete daily |
| **Reminders** | Create reminders with due dates and priority |
| **Claude AI** | Chat with Claude — has context of all your live data |

> **Note:** Google Fit REST API was shut down June 2025. Health data is entered manually. Health Connect (Android) XML exports can be imported in a future update.
