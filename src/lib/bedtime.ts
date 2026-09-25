// Tonight's suggested bedtime, from the user's own better nights.
//
// Samsung ships this as Bedtime Guidance; the data for the same sentence has
// been sitting in this database for months. The rule is strictly personal:
// the target is the median start of the nights that went WELL for this
// person — never a poster's 22:00, and never an average that midnight cuts
// in half (a 23:50 bedtime and a 00:10 bedtime are twenty minutes apart, not
// twenty-three hours).
//
// Ring first: sleepStart with sleepScore picks the better nights. When the
// ring has too few recent nights, the phone-down history stands in — cruder,
// labelled as such by the caller. Too little of either is no answer, not a
// made-up one.

import { prisma } from "@/lib/prisma"
import { localTimeStr } from "@/lib/local-date"
import { sleepDebt, MIN_DEBT_NIGHTS } from "@/lib/sleep-rhythm"
import { getGoals } from "@/lib/goals"
import { phoneDownTimes } from "@/lib/phone-day"

/** Fewer recent nights than this and a "your best nights" claim is noise. */
export const MIN_NIGHTS = 5
const WINDOW_DAYS = 21

export interface BedtimeSuggestion {
  /** "HH:MM" local. */
  target: string
  basis: "ring" | "phone"
  /** Nights the target is drawn from. */
  sample: number
  /** Hours short of the sleep goal over the last week; null when unknown or ahead. */
  debtH: number | null
}

/** Map a local "HH:MM" onto minutes since noon, so a night is one contiguous span. */
export function minutesSinceNoon(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return ((h + 12) % 24) * 60 + m
}

export function formatStart(minSinceNoon: number): string {
  const h = (Math.floor(minSinceNoon / 60) + 12) % 24
  const m = Math.round(minSinceNoon % 60)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export function medianStartMin(mins: number[]): number {
  const s = [...mins].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export interface NightStart {
  startMin: number
  score: number | null
}

/**
 * The median start of the better nights: those at or above the sample's
 * median score. With no scores at all, the median of every start — a real
 * answer from thinner evidence, which the caller words accordingly.
 */
export function suggestFromNights(nights: NightStart[]): { targetMin: number; sample: number } | null {
  if (nights.length < MIN_NIGHTS) return null
  const scored = nights.filter((n): n is NightStart & { score: number } => n.score != null)
  if (scored.length >= MIN_NIGHTS) {
    const scores = scored.map(n => n.score).sort((a, b) => a - b)
    const medScore = scores[Math.floor(scores.length / 2)]
    const best = scored.filter(n => n.score >= medScore)
    return { targetMin: medianStartMin(best.map(n => n.startMin)), sample: best.length }
  }
  return { targetMin: medianStartMin(nights.map(n => n.startMin)), sample: nights.length }
}

export async function suggestBedtime(userId: string, timezone: string): Promise<BedtimeSuggestion | null> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const rows = await prisma.healthLog.findMany({
    where: { userId, date: { gte: since }, sleepStart: { not: null } },
    orderBy: { date: "desc" },
    select: { sleepStart: true, sleepScore: true, sleepDuration: true },
  }).catch(() => [] as { sleepStart: Date | null; sleepScore: number | null; sleepDuration: number | null }[])

  let picked: { targetMin: number; sample: number } | null = null
  let basis: "ring" | "phone" = "ring"

  const ringNights: NightStart[] = rows
    .filter(r => r.sleepStart != null)
    .map(r => ({ startMin: minutesSinceNoon(localTimeStr(timezone, r.sleepStart as Date)), score: r.sleepScore }))
  picked = suggestFromNights(ringNights)

  if (!picked) {
    // The phone going quiet is a bedtime clue, not sleep — but for a target
    // hour it is evidence enough, and the caller labels the source.
    const downs = await phoneDownTimes(userId, 10, timezone).catch(() => [] as string[])
    picked = suggestFromNights(downs.map(t => ({ startMin: minutesSinceNoon(t), score: null })))
    basis = "phone"
  }
  if (!picked) return null

  // A week clearly short of the goal earns one gentle earlier-nudge, capped:
  // guidance, not homework.
  let debtH: number | null = null
  try {
    const goals = await getGoals(userId)
    const debt = sleepDebt(rows.slice(0, 7).map(r => r.sleepDuration), goals.sleepH)
    if (debt && debt.nights >= MIN_DEBT_NIGHTS && debt.shortfallMin > 60) {
      debtH = Math.round((debt.shortfallMin / 60) * 10) / 10
    }
  } catch { /* the target stands without the nudge */ }

  const targetMin = debtH != null ? picked.targetMin - 20 : picked.targetMin
  return { target: formatStart(targetMin), basis, sample: picked.sample, debtH }
}
