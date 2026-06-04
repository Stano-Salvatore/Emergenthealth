import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

interface ActiveFast {
  startedAt: string
  targetH: number
}

interface FastRecord {
  startedAt: string
  endedAt: string
  targetH: number
  durationH: number
  completed: boolean
}

async function getActiveFast(userId: string): Promise<ActiveFast | null> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" = 'fast:active'
  `
  if (rows.length === 0) return null
  try {
    return JSON.parse(rows[0].value) as ActiveFast
  } catch {
    return null
  }
}

async function getHistory(userId: string): Promise<FastRecord[]> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" = 'fast:history'
  `
  if (rows.length === 0) return []
  try {
    return JSON.parse(rows[0].value) as FastRecord[]
  } catch {
    return []
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const [active, history] = await Promise.all([
    getActiveFast(userId),
    getHistory(userId),
  ])

  return NextResponse.json({ active, history })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json() as { action: string; targetH?: number }

  if (body.action === "start") {
    const targetH = typeof body.targetH === "number" ? body.targetH : 16
    const active: ActiveFast = { startedAt: new Date().toISOString(), targetH }
    const value = JSON.stringify(active)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, 'fast:active', ${value})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
    `
    return NextResponse.json({ ok: true, active })
  }

  if (body.action === "stop") {
    const active = await getActiveFast(userId)
    if (!active) {
      return NextResponse.json({ error: "No active fast" }, { status: 400 })
    }

    const startedAt = new Date(active.startedAt)
    const endedAt = new Date()
    const durationH = Math.round(((endedAt.getTime() - startedAt.getTime()) / 3600000) * 100) / 100
    const completed = durationH >= active.targetH

    const record: FastRecord = {
      startedAt: active.startedAt,
      endedAt: endedAt.toISOString(),
      targetH: active.targetH,
      durationH,
      completed,
    }

    const history = await getHistory(userId)
    const newHistory = [record, ...history].slice(0, 20)
    const historyValue = JSON.stringify(newHistory)

    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, 'fast:history', ${historyValue})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${historyValue}
    `
    await prisma.$executeRaw`
      DELETE FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'fast:active'
    `

    return NextResponse.json({ ok: true, record })
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  await prisma.$executeRaw`
    DELETE FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'fast:active'
  `
  return NextResponse.json({ ok: true })
}
