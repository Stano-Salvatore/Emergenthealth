import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone, localDateStr } from "@/lib/local-date"
import { analyseExperiment, buildSchedule, currentPhase, endDate, outcomeSpec, totalDays, type ExperimentRow } from "@/lib/experiments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function load(userId: string, id: string) {
  return prisma.experiment.findFirst({
    where: { id, userId },
    include: { days: { select: { date: true, adhered: true, note: true } } },
  }).catch(() => null)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const { id } = await params

  const row = await load(userId, id)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const e: ExperimentRow = row
  const today = localDateStr(await getUserTimezone(userId))

  return NextResponse.json({
    experiment: {
      ...e,
      totalDays: totalDays(e),
      endDate: endDate(e),
      outcomeLabel: outcomeSpec(e.outcome)?.label ?? e.outcome,
      phase: currentPhase(e, today),
      schedule: buildSchedule(e),
      days: row.days,
      analysis: await analyseExperiment(userId, e, row.days),
    },
    today,
  })
}

/** Log a day's adherence, or change the experiment's status. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const { id } = await params

  const row = await prisma.experiment.findFirst({ where: { id, userId } }).catch(() => null)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null

  if (typeof body?.status === "string") {
    if (!["running", "completed", "abandoned"].includes(body.status)) {
      return NextResponse.json({ error: "bad status" }, { status: 400 })
    }
    const updated = await prisma.experiment.update({ where: { id }, data: { status: body.status } })
    return NextResponse.json({ experiment: updated })
  }

  if (typeof body?.adhered === "boolean") {
    const tz = await getUserTimezone(userId)
    const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : localDateStr(tz)

    // Only days that belong to the plan can be logged — a stray date would be
    // silently ignored by the analysis anyway, so reject it here where the
    // user can see why.
    const inPlan = buildSchedule(row as ExperimentRow).some(d => d.date === date)
    if (!inPlan) return NextResponse.json({ error: "That day isn't part of this experiment." }, { status: 400 })

    const saved = await prisma.experimentDay.upsert({
      where: { experimentId_date: { experimentId: id, date } },
      create: {
        experimentId: id, userId, date, adhered: body.adhered,
        note: typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null,
      },
      update: {
        adhered: body.adhered,
        note: typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : undefined,
      },
    }).catch(() => null)
    if (!saved) return NextResponse.json({ error: "Couldn't save that — try again." }, { status: 500 })
    return NextResponse.json({ day: saved })
  }

  return NextResponse.json({ error: "Nothing to update." }, { status: 400 })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const deleted = await prisma.experiment.deleteMany({ where: { id, userId: session.user.id } })
  if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
