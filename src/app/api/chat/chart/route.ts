import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr, addDaysISO } from "@/lib/local-date"
import { getGoals } from "@/lib/goals"

// The numbers behind a chart in a chat reply.
//
// A reply never carries data points. It carries a tag — `[chart:sleep-week]` —
// and the chart asks here for the series. Three reasons, in order of weight:
//
//   1. Whoever wrote the reply cannot get a bar wrong, because they never
//      typed one. This is the same rule as the source chips: a claim the app
//      cannot back is dropped rather than rendered. A spec that is not on the
//      list below 404s and the chart renders nothing.
//   2. A stored reply re-read next month draws itself from the data as it is
//      now, rather than freezing a week that has since been corrected.
//   3. A month of nights as SVG in the reply text would cost thousands of
//      tokens to write and would sit in the transcript forever. The tag costs
//      about ten.

export const dynamic = "force-dynamic"

/** Every chart a reply is allowed to ask for. Nothing else resolves. */
const SPECS = ["sleep-week"] as const
type Spec = (typeof SPECS)[number]

function isSpec(v: string): v is Spec {
  return (SPECS as readonly string[]).includes(v)
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const spec = req.nextUrl.searchParams.get("spec") ?? ""
  if (!isSpec(spec)) return NextResponse.json({ error: "Unknown chart" }, { status: 404 })

  const tz = await getUserTimezone(userId)
  const today = localDateStr(tz)
  const from = addDaysISO(today, -6)

  const [rows, goals] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: new Date(from + "T00:00:00Z"), lte: new Date(today + "T00:00:00Z") } },
      orderBy: { date: "asc" },
      select: { date: true, sleepDuration: true, sleepScore: true },
    }).catch(() => []),
    getGoals(userId),
  ])

  // Every night in the window, including the ones with no data: a gap is part
  // of the week and a chart that silently drops it shows a denser week than
  // the user had.
  const byDay = new Map(rows.map(r => [r.date.toISOString().slice(0, 10), r]))
  const points = Array.from({ length: 7 }, (_, i) => {
    const day = addDaysISO(from, i)
    const row = byDay.get(day)
    const minutes = row?.sleepDuration ?? null
    return {
      day,
      hours: minutes != null && minutes > 0 ? Math.round((minutes / 60) * 100) / 100 : null,
      score: row?.sleepScore ?? null,
    }
  })

  return NextResponse.json(
    { spec, goalH: goals.sleepH, points },
    { headers: { "Cache-Control": "no-store" } },
  )
}
