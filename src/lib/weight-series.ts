// The database end of weight: one series from two tables.
//
// Weight arrives two ways — the quick "log weight" box writes healthLog.weight,
// the Body page's measurement form writes BodyMeasurement.weightKg — and for
// a long time each screen read only the one it wrote. The trend and the goal
// read both, with the measurement row winning a day both have, because that
// one was typed with more care.

import { prisma } from "@/lib/prisma"
import { mergeWeightSeries, type WeightPoint } from "@/lib/weight-trend"

export async function loadWeightSeries(userId: string, days = 120): Promise<WeightPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000)
  const [logs, measurements] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since }, weight: { not: null } },
      select: { date: true, weight: true },
    }).catch(() => [] as { date: Date; weight: number | null }[]),
    prisma.bodyMeasurement.findMany({
      where: { userId, date: { gte: since }, weightKg: { not: null } },
      select: { date: true, weightKg: true },
    }).catch(() => [] as { date: Date; weightKg: number | null }[]),
  ])
  return mergeWeightSeries(
    logs.map(l => ({ date: l.date.toISOString().slice(0, 10), kg: l.weight! })),
    measurements.map(m => ({ date: m.date.toISOString().slice(0, 10), kg: m.weightKg! })),
  )
}

/** The most recent reading from either table, or null. */
export async function latestWeightKg(userId: string): Promise<number | null> {
  const series = await loadWeightSeries(userId, 365)
  return series.length ? series[series.length - 1].kg : null
}
