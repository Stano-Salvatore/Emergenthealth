// Is this substance being taken on a schedule, or now and then?
//
// Judging by share-of-days alone said a weekly 20,000 IU vitamin D — perfectly
// regular, obviously relevant — was present on 14% of days and therefore not
// worth mentioning, while a fortnight of ibuprofen for a bad back scored 47%
// and nearly was. The question isn't how many days; it's whether there's a
// pattern and whether it ran the length of the window.

export type Cadence = "daily" | "every other day" | "weekly" | "regular" | "irregular"

export interface DosePattern {
  daysTaken: number
  /** Share of the interval's days with a dose, 0-1. */
  coverage: number
  cadence: Cadence
  /** Typical days between doses. */
  medianGap: number
  /** A recognisable rhythm that ran most of the window. */
  regular: boolean
  /** Regular, or frequent enough that the rhythm doesn't matter. */
  consistent: boolean
}

/** Fewer doses than this and there's no pattern to see. */
const MIN_DOSES = 3
/** First-to-last dose must span this much of the window. */
const MIN_SPAN = 0.6
/** Share of gaps that must sit near the median for it to be a rhythm. */
const RHYTHM_AGREEMENT = 0.7
/** Taken this often, the rhythm stops mattering. */
const FREQUENT = 0.5

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

function dayNumber(day: string): number {
  return Math.round(new Date(day + "T00:00:00Z").getTime() / 86400000)
}

function nameGap(gap: number): Cadence {
  if (gap <= 1.5) return "daily"
  if (gap <= 2.5) return "every other day"
  if (gap >= 6 && gap <= 8) return "weekly"
  return "regular"
}

/**
 * `days` are the distinct dates a dose was logged, inside a window of
 * `windowDays`. Anything outside the window should already be filtered out.
 */
export function describeCadence(days: string[], windowDays: number): DosePattern {
  const span = Math.max(1, windowDays)
  const sorted = [...new Set(days)].sort()
  const coverage = sorted.length / span

  const base: DosePattern = {
    daysTaken: sorted.length,
    coverage: Math.round(coverage * 100) / 100,
    cadence: "irregular",
    medianGap: 0,
    regular: false,
    consistent: coverage >= FREQUENT,
  }
  if (sorted.length < MIN_DOSES) return base

  const nums = sorted.map(dayNumber)
  const gaps: number[] = []
  for (let i = 1; i < nums.length; i++) gaps.push(nums[i] - nums[i - 1])

  const med = median(gaps)
  base.medianGap = med
  if (med <= 0) return base

  // A rhythm is gaps that mostly agree with each other. The tolerance grows
  // with the gap: a day either side of "weekly" is still weekly, whereas the
  // same day either side of "daily" is not daily.
  const tolerance = Math.max(1, med * 0.34)
  const onBeat = gaps.filter(g => Math.abs(g - med) <= tolerance).length
  const rhythmic = onBeat / gaps.length >= RHYTHM_AGREEMENT

  // ...and it has to have run the window, not just a fortnight in the middle.
  const spanCovered = (nums[nums.length - 1] - nums[0]) / span
  const ranThrough = spanCovered >= MIN_SPAN

  base.regular = rhythmic && ranThrough
  base.cadence = base.regular ? nameGap(med) : "irregular"
  base.consistent = base.regular || coverage >= FREQUENT
  return base
}

/** How to say it in a sentence. */
export function cadenceLabel(p: DosePattern): string {
  switch (p.cadence) {
    case "daily": return "daily"
    case "every other day": return "every other day"
    case "weekly": return "weekly"
    case "regular": return `every ~${Math.round(p.medianGap)} days`
    default: return `${Math.round(p.coverage * 100)}% of days`
  }
}
