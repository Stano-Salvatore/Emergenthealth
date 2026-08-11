import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { COMPOUNDS, LIMIT_MG, HALF_LIFE_H, activeFromDoses } from "@/lib/caffeine"

// Today's log list + total, plus the caffeine still active right now. Active
// looks back 24h (not just midnight) so a late espresso still counts at 7am.
async function caffeineState(userId: string) {
  const now = Date.now()
  const logs24 = await prisma.caffeineLog.findMany({
    where: { userId, loggedAt: { gte: new Date(now - 24 * 3600_000) } },
    orderBy: { loggedAt: "desc" },
  })
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const logs = logs24.filter(l => l.loggedAt >= startOfDay)
  const totalMg = logs.reduce((sum, r) => sum + r.caffeineMg, 0)
  const activeMg = activeFromDoses(logs24, now)
  return { logs, totalMg, activeMg, halfLifeH: HALF_LIFE_H, limitMg: LIMIT_MG }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await caffeineState(session.user.id))
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

  await prisma.caffeineLog.create({
    data: { userId, compound, caffeineMg, servings },
  })

  return NextResponse.json({ ok: true, ...(await caffeineState(userId)) })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  await prisma.caffeineLog.deleteMany({ where: { id, userId } })
  return NextResponse.json({ ok: true })
}
