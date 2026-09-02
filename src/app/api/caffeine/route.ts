import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { COMPOUNDS, activeFromDoses } from "@/lib/caffeine"
import { getGoals } from "@/lib/goals"
import { getPersonalCaffeineProfile } from "@/lib/caffeine-profile"
import { userDay } from "@/lib/user-timezone"
import { hhmm, lastCoffeeBy, medianBedtimeMin } from "@/lib/caffeine-cutoff"

// Today's log list + total, plus the caffeine still active right now. Active
// looks back 24h (not just midnight) so a late espresso still counts at 7am,
// and decays at the user's own estimated half-life when their data supports
// one (cached daily) rather than the textbook 5 h for everybody.
async function caffeineState(userId: string) {
  const now = Date.now()
  const [logs24, personal, goals, bedNights, day] = await Promise.all([
    prisma.caffeineLog.findMany({
      where: { userId, loggedAt: { gte: new Date(now - 24 * 3600_000) } },
      orderBy: { loggedAt: "desc" },
    }),
    getPersonalCaffeineProfile(userId),
    // The Settings "Caffeine max" goal — the limit here used to be the
    // hardcoded 400 regardless of what the user set.
    getGoals(userId),
    // The last fortnight of bedtimes from the ring, for "last coffee by".
    prisma.healthLog.findMany({
      where: { userId, sleepStart: { not: null } },
      orderBy: { date: "desc" }, take: 14,
      select: { sleepStart: true },
    }).catch(() => [] as { sleepStart: Date | null }[]),
    userDay(userId),
  ])

  const limitMg = goals.coffeeMax

  const startOfDay = day.start
  // "Last coffee by 14:10": their median bedtime minus the hours an ordinary
  // coffee needs to fall under 30 mg at their own half-life.
  const bedtimeMin = medianBedtimeMin(bedNights.map(n => n.sleepStart).filter((d): d is Date => d != null), day.timezone)
  const cutoff = bedtimeMin != null ? lastCoffeeBy(bedtimeMin, personal.halfLifeH) : null
  const logs = logs24.filter(l => l.loggedAt >= startOfDay)
  const totalMg = logs.reduce((sum, r) => sum + r.caffeineMg, 0)
  const activeMg = activeFromDoses(logs24, now, personal.halfLifeH)
  return {
    logs, totalMg, activeMg, halfLifeH: personal.halfLifeH, limitMg, personal,
    bedtime: bedtimeMin != null ? hhmm(bedtimeMin) : null,
    bedtimeMin,
    lastCoffeeBy: cutoff ? hhmm(cutoff.cutoffMin) : null,
  }
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
