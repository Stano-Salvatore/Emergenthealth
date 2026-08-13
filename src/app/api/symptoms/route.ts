import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone, localDateStr } from "@/lib/local-date"

// Symptom logging: how the user feels, which nothing in this app recorded
// before. Deliberately low-friction — a name and a 1-5 severity is enough,
// because a symptom tracker that takes a minute to fill in gets used for a
// week and then abandoned, and the correlation engine needs months.

const MAX_MINUTES_AGO = 48 * 60

/** Title-case a free-text label so "head ache" and "Head Ache" group as one. */
function tidyName(raw: string): string {
  const clean = raw.trim().replace(/\s+/g, " ").slice(0, 40)
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase()
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const days = Math.min(365, Math.max(1, parseInt(searchParams.get("days") ?? "30")))
  const since = new Date(Date.now() - days * 86_400_000)

  const logs = await prisma.symptomLog.findMany({
    where: { userId, loggedAt: { gte: since } },
    orderBy: { loggedAt: "desc" },
    take: 500,
  })

  // Everything the user has ever logged, most-used first — these become the
  // one-tap chips, so the list is the app learning their vocabulary.
  const known = await prisma.symptomLog.groupBy({
    by: ["name"],
    where: { userId },
    _count: { name: true },
    orderBy: { _count: { name: "desc" } },
    take: 12,
  }).catch(() => [] as { name: string; _count: { name: number } }[])

  return NextResponse.json({
    logs: logs.map(l => ({
      id: l.id,
      name: l.name,
      severity: l.severity,
      bodyPart: l.bodyPart,
      note: l.note,
      loggedAt: l.loggedAt.toISOString(),
      day: l.day,
    })),
    known: known.map(k => ({ name: k.name, count: k._count.name })),
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as {
    name?: unknown; severity?: unknown; bodyPart?: unknown; note?: unknown; minutesAgo?: unknown
  } | null

  const name = typeof body?.name === "string" ? tidyName(body.name) : ""
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 })

  const severityRaw = Number(body?.severity)
  const severity = Number.isFinite(severityRaw) ? Math.min(5, Math.max(1, Math.round(severityRaw))) : 3

  const minsRaw = Number(body?.minutesAgo ?? 0)
  const minutesAgo = Number.isFinite(minsRaw) ? Math.min(MAX_MINUTES_AGO, Math.max(0, Math.round(minsRaw))) : 0
  const loggedAt = new Date(Date.now() - minutesAgo * 60_000)

  const timezone = await getUserTimezone(userId)
  const log = await prisma.symptomLog.create({
    data: {
      userId,
      name,
      severity,
      bodyPart: typeof body?.bodyPart === "string" && body.bodyPart.trim() ? body.bodyPart.trim().slice(0, 40) : null,
      note: typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : null,
      loggedAt,
      day: localDateStr(timezone, loggedAt),
    },
  })

  return NextResponse.json({ ok: true, id: log.id, name, severity, day: log.day })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const id = new URL(req.url).searchParams.get("id") ?? ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  await prisma.symptomLog.deleteMany({ where: { id, userId: session.user.id } })
  return NextResponse.json({ ok: true })
}
