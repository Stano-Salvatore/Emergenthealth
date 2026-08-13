// Loads the data the personal half-life estimator needs and caches the verdict.
// The estimate only moves as new nights accumulate, so a daily refresh is
// plenty — and it keeps the caffeine endpoint fast.

import { prisma } from "@/lib/prisma"
import { estimatePersonalHalfLife, type CaffeineNight, type HalfLifeEstimate } from "@/lib/caffeine-personal"

const CACHE_KEY = "caffeine:halflife"
const TTL_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 120

export async function getPersonalCaffeineProfile(userId: string, force = false): Promise<HalfLifeEstimate> {
  if (!force) {
    const cached = await prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: CACHE_KEY } },
    }).catch(() => null)
    if (cached) {
      try {
        const parsed = JSON.parse(cached.value) as HalfLifeEstimate & { at: number }
        if (Date.now() - (parsed.at ?? 0) < TTL_MS) return parsed
      } catch { /* recompute */ }
    }
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const [doses, sleeps] = await Promise.all([
    prisma.caffeineLog.findMany({
      where: { userId, loggedAt: { gte: since } },
      select: { caffeineMg: true, loggedAt: true },
      orderBy: { loggedAt: "asc" },
    }).catch(() => [] as { caffeineMg: number; loggedAt: Date }[]),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since }, sleepScore: { not: null }, sleepStart: { not: null } },
      select: { sleepScore: true, sleepStart: true },
      orderBy: { date: "asc" },
    }).catch(() => [] as { sleepScore: number | null; sleepStart: Date | null }[]),
  ])

  // Each night pairs its real bedtime (Oura's sleep start) with the doses from
  // the preceding 24 h — the window that can still be circulating.
  const nights: CaffeineNight[] = sleeps
    .filter(s => s.sleepStart != null && s.sleepScore != null)
    .map(s => {
      const bedtime = s.sleepStart!
      const from = bedtime.getTime() - 24 * 3_600_000
      return {
        bedtime,
        sleepScore: s.sleepScore!,
        doses: doses.filter(d => d.loggedAt.getTime() >= from && d.loggedAt.getTime() <= bedtime.getTime()),
      }
    })

  const estimate = estimatePersonalHalfLife(nights)

  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: CACHE_KEY } },
    create: { userId, key: CACHE_KEY, value: JSON.stringify({ ...estimate, at: Date.now() }) },
    update: { value: JSON.stringify({ ...estimate, at: Date.now() }) },
  }).catch(() => null)

  return estimate
}
