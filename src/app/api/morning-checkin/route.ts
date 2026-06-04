import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "MorningCheckIn" (
      "id"          TEXT PRIMARY KEY,
      "userId"      TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "date"        TEXT NOT NULL,
      "energy"      INTEGER NOT NULL,
      "mood"        INTEGER NOT NULL,
      "intention"   TEXT,
      "waterGoalMl" INTEGER NOT NULL DEFAULT 2000,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE("userId", "date")
    )
  `
}

async function getStreak(userId: string, todayStr: string): Promise<number> {
  // Fetch last 60 dates with check-ins, walk backwards from today
  const rows = await prisma.$queryRaw<{ date: string }[]>`
    SELECT "date" FROM "MorningCheckIn"
    WHERE "userId" = ${userId} AND "date" <= ${todayStr}
    ORDER BY "date" DESC
    LIMIT 60
  `
  const dates = new Set(rows.map(r => r.date))
  let streak = 0
  const cursor = new Date(todayStr)
  while (true) {
    const d = cursor.toISOString().slice(0, 10)
    if (!dates.has(d)) break
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const clientDate = new URL(req.url).searchParams.get("date")
  const today = clientDate && /^\d{4}-\d{2}-\d{2}$/.test(clientDate)
    ? clientDate
    : new Date().toISOString().slice(0, 10)

  await ensureTable()

  const rows = await prisma.$queryRaw<{
    id: string
    userId: string
    date: string
    energy: number
    mood: number
    intention: string | null
    waterGoalMl: number
    createdAt: Date
  }[]>`
    SELECT * FROM "MorningCheckIn"
    WHERE "userId" = ${session.user.id} AND "date" = ${today}
    LIMIT 1
  `

  const streak = await getStreak(session.user.id, today)

  return NextResponse.json({ checkin: rows[0] ?? null, streak })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { energy, mood, intention, waterGoalMl, date } = await req.json()
  const today = date ?? new Date().toISOString().slice(0, 10)
  const id = `mci_${session.user.id}_${today}`

  await ensureTable()

  await prisma.$executeRaw`
    INSERT INTO "MorningCheckIn" ("id", "userId", "date", "energy", "mood", "intention", "waterGoalMl")
    VALUES (${id}, ${session.user.id}, ${today}, ${energy}, ${mood}, ${intention ?? null}, ${waterGoalMl ?? 2000})
    ON CONFLICT ("userId", "date") DO UPDATE SET
      "energy"      = EXCLUDED."energy",
      "mood"        = EXCLUDED."mood",
      "intention"   = EXCLUDED."intention",
      "waterGoalMl" = EXCLUDED."waterGoalMl"
  `

  const rows = await prisma.$queryRaw<{
    id: string
    userId: string
    date: string
    energy: number
    mood: number
    intention: string | null
    waterGoalMl: number
    createdAt: Date
  }[]>`
    SELECT * FROM "MorningCheckIn" WHERE "id" = ${id}
  `

  const streak = await getStreak(session.user.id, today)

  return NextResponse.json({ ok: true, checkin: rows[0], streak })
}
