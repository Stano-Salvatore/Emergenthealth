import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"

async function ensureTables() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "CustomMetric" (
      "id"        TEXT PRIMARY KEY,
      "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "name"      TEXT NOT NULL,
      "unit"      TEXT,
      "type"      TEXT NOT NULL DEFAULT 'number',
      "color"     TEXT NOT NULL DEFAULT '#6366f1',
      "emoji"     TEXT NOT NULL DEFAULT '📊',
      "minVal"    REAL,
      "maxVal"    REAL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "CustomMetric_userId_idx" ON "CustomMetric"("userId")`
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "CustomMetricLog" (
      "id"        TEXT PRIMARY KEY,
      "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "metricId"  TEXT NOT NULL REFERENCES "CustomMetric"("id") ON DELETE CASCADE,
      "date"      DATE NOT NULL,
      "value"     REAL NOT NULL,
      "note"      TEXT,
      "loggedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE("metricId","date")
    )
  `
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "CustomMetricLog_userId_date_idx" ON "CustomMetricLog"("userId","date")`
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  try {
    await ensureTables()

    const [metrics, logs] = await Promise.all([
      prisma.$queryRaw<{
        id: string; name: string; unit: string | null; type: string
        color: string; emoji: string; minVal: number | null; maxVal: number | null
        createdAt: Date
      }[]>`
        SELECT "id","name","unit","type","color","emoji","minVal","maxVal","createdAt"
        FROM "CustomMetric" WHERE "userId" = ${userId} ORDER BY "createdAt" ASC
      `,
      prisma.$queryRaw<{ metricId: string; date: string; value: number; note: string | null }[]>`
        SELECT "metricId", "date"::text, "value", "note"
        FROM "CustomMetricLog"
        WHERE "userId" = ${userId}
          AND "date" >= CURRENT_DATE - INTERVAL '90 days'
        ORDER BY "date" ASC
      `,
    ])

    const logsByMetric: Record<string, { date: string; value: number; note: string | null }[]> = {}
    for (const l of logs) {
      if (!logsByMetric[l.metricId]) logsByMetric[l.metricId] = []
      logsByMetric[l.metricId].push({ date: l.date.slice(0, 10), value: l.value, note: l.note })
    }

    return NextResponse.json({ metrics, logsByMetric })
  } catch (e) {
    console.error("[custom-metrics] GET:", e)
    return NextResponse.json({ error: "Failed to load" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { name, unit, type, color, emoji, minVal, maxVal } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 })

  await ensureTables()
  const id = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO "CustomMetric"("id","userId","name","unit","type","color","emoji","minVal","maxVal")
    VALUES (${id}, ${userId}, ${name.trim()}, ${unit ?? null}, ${type ?? "number"},
            ${color ?? "#6366f1"}, ${emoji ?? "📊"}, ${minVal ?? null}, ${maxVal ?? null})
  `
  return NextResponse.json({ id })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  await prisma.$executeRaw`DELETE FROM "CustomMetric" WHERE "id" = ${id} AND "userId" = ${userId}`
  return NextResponse.json({ ok: true })
}
