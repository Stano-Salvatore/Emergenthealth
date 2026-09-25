// The long view's data: this quarter judged against the last through the
// drift engine (so every shift shown survived the permutation test), twelve
// months of plain averages, and the notable lab trends. One payload for one
// section — the stats page's "long view".

import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr } from "@/lib/local-date"
import { loadDriftReport, seasonWindows } from "@/lib/drift-load"
import { loadLabTrends } from "@/lib/lab-trends-load"
import { monthlyAverages } from "@/lib/long-view"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const tz = await getUserTimezone(userId)
  const today = localDateStr(tz)
  const yearAgo = new Date(Date.now() - 365 * 86_400_000)

  const [report, yearRows, labs] = await Promise.all([
    loadDriftReport(userId, tz, seasonWindows(today)).catch(() => null),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: yearAgo } },
      orderBy: { date: "asc" },
      select: { date: true, sleepDuration: true, steps: true },
    }).catch(() => [] as { date: Date; sleepDuration: number | null; steps: number | null }[]),
    loadLabTrends(userId).catch(() => ({ trends: [], notable: [], markerCount: 0 })),
  ])

  const months = monthlyAverages(
    yearRows.map(r => ({ date: r.date.toISOString().slice(0, 10), sleepDuration: r.sleepDuration, steps: r.steps })),
  ).slice(-12)

  return NextResponse.json({
    quarter: report ? {
      judged: report.judged,
      shifts: report.shifts,
      factors: report.factors,
      recent: report.recent,
      prior: report.prior,
    } : null,
    months,
    labs: labs.notable.slice(0, 6),
    markerCount: labs.markerCount,
  })
}
