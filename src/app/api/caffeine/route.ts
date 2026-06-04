import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const LIMIT_MG = 400

export const COMPOUNDS: Record<string, { label: string; mg: number; emoji: string }> = {
  espresso:      { label: "Espresso",      mg: 63,  emoji: "☕" },
  filter_coffee: { label: "Filter coffee", mg: 140, emoji: "☕" },
  green_tea:     { label: "Green tea",     mg: 30,  emoji: "🍵" },
  black_tea:     { label: "Black tea",     mg: 50,  emoji: "🍵" },
  matcha:        { label: "Matcha",        mg: 70,  emoji: "🍵" },
  energy_drink:  { label: "Energy drink",  mg: 80,  emoji: "⚡" },
  pre_workout:   { label: "Pre-workout",   mg: 200, emoji: "💪" },
  cola:          { label: "Cola (330ml)",  mg: 35,  emoji: "🥤" },
}

interface CaffeineRow {
  id: string
  userId: string
  compound: string
  caffeineMg: number
  servings: number
  loggedAt: Date
}

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "CaffeineLog" (
      "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "userId"     TEXT NOT NULL,
      "compound"   TEXT NOT NULL,
      "caffeineMg" INTEGER NOT NULL,
      "servings"   REAL NOT NULL DEFAULT 1,
      "loggedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "CaffeineLog_userId_loggedAt_idx"
    ON "CaffeineLog" ("userId", "loggedAt" DESC)
  `
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  await ensureTable()

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const logs = await prisma.$queryRaw<CaffeineRow[]>`
    SELECT "id", "userId", "compound", "caffeineMg", "servings", "loggedAt"
    FROM "CaffeineLog"
    WHERE "userId" = ${userId}
      AND "loggedAt" >= ${startOfDay}
    ORDER BY "loggedAt" DESC
  `

  const totalMg = logs.reduce((sum, r) => sum + r.caffeineMg, 0)
  return NextResponse.json({ logs, totalMg, limitMg: LIMIT_MG })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json() as { compound?: unknown; servings?: unknown }
  const compound = typeof body.compound === "string" ? body.compound : null
  if (!compound || !(compound in COMPOUNDS)) {
    return NextResponse.json({ error: "Invalid compound" }, { status: 400 })
  }
  const servings = typeof body.servings === "number" && body.servings > 0 ? body.servings : 1
  const caffeineMg = Math.round(COMPOUNDS[compound].mg * servings)

  await ensureTable()

  const id = `caf_${userId}_${Date.now()}`

  await prisma.$executeRaw`
    INSERT INTO "CaffeineLog" ("id", "userId", "compound", "caffeineMg", "servings")
    VALUES (${id}, ${userId}, ${compound}, ${caffeineMg}, ${servings})
  `

  // Return updated total
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const logs = await prisma.$queryRaw<CaffeineRow[]>`
    SELECT "id", "userId", "compound", "caffeineMg", "servings", "loggedAt"
    FROM "CaffeineLog"
    WHERE "userId" = ${userId}
      AND "loggedAt" >= ${startOfDay}
    ORDER BY "loggedAt" DESC
  `

  const totalMg = logs.reduce((sum, r) => sum + r.caffeineMg, 0)
  return NextResponse.json({ ok: true, logs, totalMg, limitMg: LIMIT_MG })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  await ensureTable()

  await prisma.$executeRaw`
    DELETE FROM "CaffeineLog"
    WHERE "id" = ${id} AND "userId" = ${userId}
  `

  return NextResponse.json({ ok: true })
}
