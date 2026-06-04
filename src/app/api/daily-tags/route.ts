import { NextRequest, NextResponse } from "next/server"
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

function todayStr(): string {
  return new Date().toISOString().split("T")[0]
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const date = searchParams.get("date") ?? todayStr()

  await ensureTable()

  const key = `daily_tags:${date}`
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" = ${key}
    LIMIT 1
  `

  const tags: string[] = rows.length > 0 ? (JSON.parse(rows[0].value) as string[]) : []
  return NextResponse.json({ date, tags })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json() as { date?: unknown; tags?: unknown }
  const date = typeof body.date === "string" ? body.date : todayStr()
  if (!Array.isArray(body.tags)) {
    return NextResponse.json({ error: "tags must be an array" }, { status: 400 })
  }
  const tags = (body.tags as unknown[])
    .filter((t): t is string => typeof t === "string")
    .map(t => t.trim().toLowerCase().slice(0, 30))
    .filter(t => t.length > 0)
    .slice(0, 10)

  await ensureTable()

  const key = `daily_tags:${date}`
  const value = JSON.stringify(tags)

  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, ${key}, ${value})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
  `

  return NextResponse.json({ ok: true })
}
