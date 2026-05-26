import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "WeatherLog" (
      "id"          TEXT PRIMARY KEY,
      "userId"      TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "date"        TEXT NOT NULL,
      "tempMaxC"    DOUBLE PRECISION,
      "tempMinC"    DOUBLE PRECISION,
      "precipMm"    DOUBLE PRECISION,
      "uvIndex"     DOUBLE PRECISION,
      "weatherCode" INTEGER,
      "lat"         DOUBLE PRECISION,
      "lon"         DOUBLE PRECISION,
      UNIQUE("userId", "date")
    )
  `
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { date, tempMaxC, tempMinC, precipMm, uvIndex, weatherCode, lat, lon } = await req.json()
  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 })

  await ensureTable()

  const id = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO "WeatherLog"("id","userId","date","tempMaxC","tempMinC","precipMm","uvIndex","weatherCode","lat","lon")
    VALUES (${id}, ${userId}, ${date}, ${tempMaxC ?? null}, ${tempMinC ?? null}, ${precipMm ?? null}, ${uvIndex ?? null}, ${weatherCode ?? null}, ${lat ?? null}, ${lon ?? null})
    ON CONFLICT ("userId","date") DO UPDATE SET
      "tempMaxC" = EXCLUDED."tempMaxC",
      "tempMinC" = EXCLUDED."tempMinC",
      "precipMm" = EXCLUDED."precipMm",
      "uvIndex" = EXCLUDED."uvIndex",
      "weatherCode" = EXCLUDED."weatherCode",
      "lat" = EXCLUDED."lat",
      "lon" = EXCLUDED."lon"
  `

  return NextResponse.json({ ok: true })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  await ensureTable()

  const rows = await prisma.$queryRaw<{
    id: string
    date: string
    tempMaxC: number | null
    tempMinC: number | null
    precipMm: number | null
    uvIndex: number | null
    weatherCode: number | null
    lat: number | null
    lon: number | null
  }[]>`
    SELECT "id","date","tempMaxC","tempMinC","precipMm","uvIndex","weatherCode","lat","lon"
    FROM "WeatherLog"
    WHERE "userId" = ${userId}
      AND "date" >= (CURRENT_DATE - INTERVAL '30 days')::text
    ORDER BY "date" DESC
  `

  return NextResponse.json(rows)
}
