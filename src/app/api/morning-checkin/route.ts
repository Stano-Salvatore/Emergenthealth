import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const today = new Date().toISOString().slice(0, 10)

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

  return NextResponse.json({ checkin: rows[0] ?? null })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { energy, mood, intention, waterGoalMl, date } = await req.json()
  const today = date ?? new Date().toISOString().slice(0, 10)
  const id = `mci_${session.user.id}_${today}`

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

  return NextResponse.json({ ok: true, checkin: rows[0] })
}
