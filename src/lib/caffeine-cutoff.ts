// "Last coffee by 14:10."
//
// The pieces existed for months — a fitted personal half-life, the hours a
// dose needs to fall under a sleep-irrelevant 30 mg, fourteen nights of
// bedtimes from the ring — and nothing joined them into the one time of day
// a person can actually act on. Pure, so the API, the Caffeine page and
// Emergy's prompt all say the same time.

import { cutoffHoursBeforeBed } from "@/lib/caffeine-personal"

/** One ordinary coffee. The cutoff is quoted for this, not for today's total. */
export const STANDARD_COFFEE_MG = 100
/** Fewer nights than this and a median bedtime is a guess. */
export const MIN_BEDTIME_NIGHTS = 5

/**
 * Median bedtime as minutes after local midnight, or null with too few nights.
 * A bedtime after midnight counts as late (25:30), not early (01:30), so the
 * median of {23:00, 23:30, 00:30} is 23:30 rather than something absurd.
 */
export function medianBedtimeMin(sleepStarts: Date[], timezone: string): number | null {
  if (sleepStarts.length < MIN_BEDTIME_NIGHTS) return null
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
  } catch {
    fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false })
  }
  const mins = sleepStarts.map(d => {
    const [h, m] = fmt.format(d).split(":").map(Number)
    let v = (h % 24) * 60 + m
    if (v < 12 * 60) v += 24 * 60
    return v
  }).sort((a, b) => a - b)
  const mid = Math.floor(mins.length / 2)
  const med = mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2
  return Math.round(med) % (24 * 60)
}

/** When the last ordinary coffee should be, to be under 30 mg at bedtime. */
export function lastCoffeeBy(bedtimeMin: number, halfLifeH: number, doseMg = STANDARD_COFFEE_MG): { cutoffMin: number; hoursBefore: number } {
  const hoursBefore = cutoffHoursBeforeBed(doseMg, halfLifeH)
  const cutoffMin = (((bedtimeMin - Math.round(hoursBefore * 60)) % 1440) + 1440) % 1440
  return { cutoffMin, hoursBefore: Math.round(hoursBefore * 10) / 10 }
}

export function hhmm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}
