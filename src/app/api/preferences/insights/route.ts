import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Per-user insights settings:
//  - insights_counts: how many correlation rows to show per period ({week,month,overall})
//  - insights_pinned: correlation ids the user "watches" (pin & watch alerts)
// (insights_watch_state is written by the correlation-watch cron, not here.)
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

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ counts: {}, pinned: [] }, { status: 401 })
  const userId = session.user.id
  await ensureTable()
  const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
    SELECT "key", "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" IN ('insights_counts', 'insights_pinned')
  `
  const get = (k: string) => rows.find(r => r.key === k)?.value
  const parse = <T,>(v: string | undefined, fallback: T): T => {
    if (!v) return fallback
    try { return JSON.parse(v) as T } catch { return fallback }
  }
  return NextResponse.json({
    counts: parse<Record<string, number>>(get("insights_counts"), {}),
    pinned: parse<string[]>(get("insights_pinned"), []),
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const body = await req.json().catch(() => ({}))
  await ensureTable()

  if (body.counts && typeof body.counts === "object") {
    const v = JSON.stringify(body.counts)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId},'insights_counts',${v})
      ON CONFLICT ("userId","key") DO UPDATE SET "value"=${v}
    `
  }
  if (Array.isArray(body.pinned)) {
    const v = JSON.stringify(body.pinned)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId},'insights_pinned',${v})
      ON CONFLICT ("userId","key") DO UPDATE SET "value"=${v}
    `
  }
  return NextResponse.json({ ok: true })
}
