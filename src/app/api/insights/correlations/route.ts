import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { computeCorrelations, ENGINE_VERSION, PERIOD_DAYS } from "@/lib/correlations"

export const maxDuration = 60 // a year-window run is ~100 families × 1000 permutations

// A full correlation run is now genuinely expensive: ~15 queries, then the
// whole insight battery twice (once over all days, once weekdays-only for the
// weekend guard), with a 1000-shuffle permutation test behind every single
// comparison. That's the price of insights that can tell signal from luck —
// but it was being paid on every page load, for numbers that move once a day
// at most. Cached per user and period; ?refresh=1 forces a recompute, which is
// what the button on the page does.

const TTL_MS = 6 * 60 * 60 * 1000
const cacheKey = (period: string) => `insights_cache:${period}`

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const url = new URL(req.url)
  const period = url.searchParams.get("period") ?? "overall"
  const windowDays = PERIOD_DAYS[period] ?? 90
  const refresh = url.searchParams.get("refresh") === "1"

  if (!refresh) {
    const cached = await prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: cacheKey(period) } },
    }).catch(() => null)
    if (cached) {
      try {
        const parsed = JSON.parse(cached.value)
        // A cache entry from an older engine is stale regardless of age —
        // serving it would hide whole insight families that were just added.
        if (parsed.v === ENGINE_VERSION && Date.now() - (parsed.at ?? 0) < TTL_MS) {
          return NextResponse.json({ ...parsed.payload, computedAt: new Date(parsed.at).toISOString(), cached: true })
        }
      } catch { /* recompute */ }
    }
  }

  const { insights, totalDays } = await computeCorrelations(userId, windowDays)
  const payload = { insights, dataRange: { days: totalDays } }
  const at = Date.now()

  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: cacheKey(period) } },
    create: { userId, key: cacheKey(period), value: JSON.stringify({ at, v: ENGINE_VERSION, payload }) },
    update: { value: JSON.stringify({ at, v: ENGINE_VERSION, payload }) },
  }).catch(() => null)

  return NextResponse.json({ ...payload, computedAt: new Date(at).toISOString(), cached: false })
}
