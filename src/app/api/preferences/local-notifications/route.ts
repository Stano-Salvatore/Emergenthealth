import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// The native app reports here after laying down local notifications, so the
// server knows the phone already has the next few days covered and its own
// habit-reminder push can stand down instead of buzzing a second time for the
// same habit.
//
// It's a timestamp rather than a flag on purpose. The local schedule is a
// rolling window refreshed when the app is opened, so it goes stale if the app
// isn't; letting this expire means the server push resumes on its own as the
// backstop, with nothing to switch back on by hand.

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "UserPreference" (
      "userId" TEXT NOT NULL,
      "key"    TEXT NOT NULL,
      "value"  TEXT NOT NULL,
      PRIMARY KEY ("userId", "key"),
      CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
    )
  `
}

const KEY = "local_notifications_synced"

/** Clamped so a bad client can't claim coverage for a year. */
const MIN_WINDOW = 1
const MAX_WINDOW = 14

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await ensureTable()
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference" WHERE "userId" = ${session.user.id} AND "key" = ${KEY} LIMIT 1
  `.catch(() => [] as { value: string }[])
  if (!rows[0]) return NextResponse.json({ syncedAt: null, windowDays: null })
  try {
    return NextResponse.json(JSON.parse(rows[0].value))
  } catch {
    return NextResponse.json({ syncedAt: null, windowDays: null })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const raw = Number(body?.windowDays)
  const windowDays = Number.isFinite(raw)
    ? Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, Math.floor(raw)))
    : 7

  await ensureTable()
  const value = JSON.stringify({ syncedAt: new Date().toISOString(), windowDays })
  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${session.user.id}, ${KEY}, ${value})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
  `.catch(() => {})

  return NextResponse.json({ ok: true, windowDays })
}
