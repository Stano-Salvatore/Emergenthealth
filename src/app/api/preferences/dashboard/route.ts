import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Server-side persistence for the dashboard grid layout + hidden widgets, so a
// user's arrangement syncs across devices (web, phone, APK). Mirrors the
// sidebar preferences route.

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
  if (!session?.user?.id) return NextResponse.json({ layout: null, hidden: null }, { status: 401 })
  const userId = session.user.id
  await ensureTable()
  const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
    SELECT "key", "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" IN ('dashboard_layout', 'dashboard_hidden')
  `
  const get = (k: string) => rows.find(r => r.key === k)?.value
  const parse = (v: string | undefined) => {
    if (!v) return null
    try { return JSON.parse(v) } catch { return null }
  }
  return NextResponse.json({
    layout: parse(get("dashboard_layout")),
    hidden: parse(get("dashboard_hidden")),
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const body = await req.json().catch(() => ({}))
  await ensureTable()

  if (Array.isArray(body.layout)) {
    const v = JSON.stringify(body.layout)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId},'dashboard_layout',${v})
      ON CONFLICT ("userId","key") DO UPDATE SET "value"=${v}
    `
  }
  if (Array.isArray(body.hidden)) {
    const v = JSON.stringify(body.hidden)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId},'dashboard_hidden',${v})
      ON CONFLICT ("userId","key") DO UPDATE SET "value"=${v}
    `
  }
  return NextResponse.json({ ok: true })
}
