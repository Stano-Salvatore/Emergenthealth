import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { subDays } from "date-fns"

export const runtime = "nodejs"

type MetricSnapshot = {
  label: string
  key: string
  today: number | null
  baseline: number | null
  unit: string
  higherIsBetter: boolean
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const since30 = subDays(now, 30)

  const [todayLog, baselineLogs, todayMood, baselineMoods] = await Promise.all([
    prisma.healthLog.findFirst({
      where: { userId, date: new Date(todayStr + "T00:00:00.000Z") },
      select: { sleepDuration: true, hrv: true, readinessScore: true, steps: true, restingHR: true, sleepEfficiency: true },
    }).catch(() => null),

    prisma.healthLog.findMany({
      where: { userId, date: { gte: since30 } },
      select: { sleepDuration: true, hrv: true, readinessScore: true, steps: true, restingHR: true, sleepEfficiency: true },
    }).catch(() => []),

    prisma.moodLog.findFirst({
      where: { userId, date: new Date(todayStr + "T00:00:00.000Z") },
      select: { mood: true },
    }).catch(() => null),

    prisma.moodLog.findMany({
      where: { userId, date: { gte: since30 } },
      select: { mood: true },
    }).catch(() => []),
  ])

  function avg(vals: (number | null)[]): number | null {
    const clean = vals.filter((v): v is number => v != null)
    return clean.length ? Math.round((clean.reduce((a, b) => a + b, 0) / clean.length) * 10) / 10 : null
  }

  const snapshots: MetricSnapshot[] = [
    {
      label: "Sleep",
      key: "sleep",
      today: todayLog?.sleepDuration != null ? Math.round(todayLog.sleepDuration / 6) / 10 : null,
      baseline: avg(baselineLogs.map(l => l.sleepDuration != null ? l.sleepDuration / 60 : null)),
      unit: "h",
      higherIsBetter: true,
    },
    {
      label: "HRV",
      key: "hrv",
      today: todayLog?.hrv ?? null,
      baseline: avg(baselineLogs.map(l => l.hrv)),
      unit: "ms",
      higherIsBetter: true,
    },
    {
      label: "Readiness",
      key: "readiness",
      today: todayLog?.readinessScore ?? null,
      baseline: avg(baselineLogs.map(l => l.readinessScore)),
      unit: "",
      higherIsBetter: true,
    },
    {
      label: "Steps",
      key: "steps",
      today: todayLog?.steps ?? null,
      baseline: avg(baselineLogs.map(l => l.steps)),
      unit: "",
      higherIsBetter: true,
    },
    {
      label: "Resting HR",
      key: "rhr",
      today: todayLog?.restingHR ?? null,
      baseline: avg(baselineLogs.map(l => l.restingHR)),
      unit: "bpm",
      higherIsBetter: false,
    },
    {
      label: "Sleep Eff",
      key: "sleepEff",
      today: todayLog?.sleepEfficiency ?? null,
      baseline: avg(baselineLogs.map(l => l.sleepEfficiency)),
      unit: "%",
      higherIsBetter: true,
    },
    {
      label: "Mood",
      key: "mood",
      today: todayMood?.mood ?? null,
      baseline: avg(baselineMoods.map(l => l.mood)),
      unit: "/5",
      higherIsBetter: true,
    },
  ]

  return NextResponse.json({
    date: todayStr,
    baselineDays: 30,
    snapshots,
  })
}
