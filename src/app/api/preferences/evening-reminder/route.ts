import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

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
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  await ensureTable()
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'evening_reminder_enabled' LIMIT 1
  `.catch(() => [] as { value: string }[])
  const enabled = rows[0] ? rows[0].value !== "false" : true
  return NextResponse.json({ enabled })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const { enabled } = await req.json().catch(() => ({ enabled: true }))
  await ensureTable()
  const value = String(!!enabled)
  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, 'evening_reminder_enabled', ${value})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
  `
  return NextResponse.json({ ok: true, enabled: !!enabled })
}
