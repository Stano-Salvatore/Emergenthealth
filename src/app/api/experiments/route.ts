import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { analyseExperiment } from "@/lib/experiments-analysis"
import { currentPhase, endDate, outcomeSpec, totalDays, type ExperimentRow } from "@/lib/experiments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_RUNNING = 3 // more than a few at once and adherence collapses

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const rows = await prisma.experiment.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { days: { select: { date: true, adhered: true } } },
  }).catch(() => [])

  const today = localDateStr(await getUserTimezone(userId))

  const experiments = await Promise.all(rows.map(async r => {
    const e: ExperimentRow = r
    const phase = currentPhase(e, today)
    // Analysing every experiment on the list view is affordable — a handful of
    // rows, each a few dozen days.
    const analysis = await analyseExperiment(userId, e, r.days)
    return {
      ...e,
      totalDays: totalDays(e),
      endDate: endDate(e),
      outcomeLabel: outcomeSpec(e.outcome)?.label ?? e.outcome,
      loggedToday: r.days.some(d => d.date === today),
      phase,
      analysis,
    }
  }))

  return NextResponse.json({ experiments, today })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : ""
  const action = typeof body?.action === "string" ? body.action.trim().slice(0, 200) : ""
  const outcome = typeof body?.outcome === "string" ? body.outcome : ""
  if (!name || !action) return NextResponse.json({ error: "Name and what you'll do are both required." }, { status: 400 })
  if (!outcomeSpec(outcome)) return NextResponse.json({ error: "Pick something measurable to watch." }, { status: 400 })

  const running = await prisma.experiment.count({ where: { userId, status: "running" } }).catch(() => 0)
  if (running >= MAX_RUNNING) {
    return NextResponse.json(
      { error: `You already have ${running} experiments running. Finish one first — overlapping changes make each answer harder to trust.` },
      { status: 400 }
    )
  }

  const clamp = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
  }
  const blockDays = clamp(body?.blockDays, 3, 21, 7)
  const blocks = clamp(body?.blocks, 2, 8, 4)
  const washoutDays = clamp(body?.washoutDays, 0, 5, 1)

  const tz = await getUserTimezone(userId)
  const startDate = typeof body?.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate)
    ? body.startDate
    : localDateStr(tz)

  // Randomise which arm goes first. Always starting with the ON block puts the
  // freshest enthusiasm (and any novelty effect) on the same side every time.
  const startsOn = Math.random() < 0.5

  const created = await prisma.experiment.create({
    data: {
      userId, name, action, outcome, blockDays, blocks, washoutDays, startsOn, startDate,
      note: typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null,
    },
  })

  return NextResponse.json({ experiment: created })
}
