// The two numbers Oura shows and its API does not: sleep debt, and how regular
// the nights are. Both are computable from the durations and bedtimes already
// stored, which beats copying a figure we could not explain if asked.
//
// Pure — no Prisma, no dates beyond what is handed in — because three screens
// and one scripted chat answer need the same arithmetic, and the last time
// they each did it themselves they stopped agreeing. See sleepDebt below.

import { localDateStr, localTimeStr } from "@/lib/local-date"

// ── Sleep debt ────────────────────────────────────────────────────────────

/**
 * How far short of the nightly goal a stretch of nights came.
 *
 * One definition, because there were three and two of them disagreed. The
 * Health page and the scripted chat answer both compared the goal against
 * what was slept and let a long night pay some of it back; the Week page
 * summed `max(0, goal - night)` per night, which can never show a surplus
 * and never lets a lie-in count for anything. On a week with one twelve-hour
 * Saturday the two screens read "4.2h in debt" and "1.1h ahead" — the same
 * week, the same goal, two answers a phone-width apart.
 *
 * The signed version wins on the merits, not just on the vote. It is the
 * arithmetic the words describe ("you slept X less than you meant to"), it
 * can say you are ahead, and "debt" is a word that implies repayment. The
 * clamped one can only ever count against you: one short Tuesday and it
 * reports a debt for the rest of the week however you sleep.
 *
 * A night with no duration is NOT a zero-hour night — it is a night nobody
 * measured, and counting it as a full night's shortfall would invent eight
 * hours of debt out of a ring left in a drawer. Those nights drop out, and
 * `nights` is returned so the caller can say what the figure is based on.
 */
export interface SleepDebt {
  /** Positive: short of the goal. Negative: ahead of it. */
  shortfallMin: number
  /** Nights with a measured duration — what the figure is actually based on. */
  nights: number
  /** The nightly goal used, in minutes. */
  goalMin: number
}

/** Under this many measured nights the total is more noise than signal. */
export const MIN_DEBT_NIGHTS = 2

export function sleepDebt(durationsMin: (number | null | undefined)[], goalH: number): SleepDebt | null {
  const nights = durationsMin.filter((d): d is number => d != null && d > 0)
  if (nights.length < MIN_DEBT_NIGHTS) return null
  const goalMin = Math.round(goalH * 60)
  const slept = nights.reduce((s, d) => s + d, 0)
  return { shortfallMin: goalMin * nights.length - slept, nights: nights.length, goalMin }
}

// ── Sleep regularity ──────────────────────────────────────────────────────
//
// Not the spread of bedtimes, which is the obvious thing to reach for and
// answers the wrong question: going to bed at the same hour and getting up
// four hours earlier on weekdays is not a regular sleeper. The published
// measure is the Sleep Regularity Index — for every minute of the clock, how
// often you were in the same state (asleep or awake) on two consecutive days.
// 100 means every day is the same day; 0 means knowing today tells you
// nothing about tomorrow.
//
// Two honest limits, both stated on the card rather than buried here:
//
//  - It reads the IN-BED window (Oura's bedtime_start to bedtime_end), not
//    minute-by-minute sleep staging, which the API does not hand back. Waking
//    at 04:00 and lying there until 07:00 counts as asleep. It is the same
//    window every night, so the comparison is fair even where the label is
//    generous.
//
//  - A night nobody recorded is unknown, not awake. This is the same rule the
//    sleep panel applies to a silent diary day, and it matters more here: a
//    missing night would otherwise read as twenty-four hours out of bed, and
//    two of them in a row would read as a person who keeps perfect hours.

export interface RhythmNight {
  /** The date the night is filed under — the morning it ended. */
  date: string
  sleepStart: Date | null | undefined
  sleepEnd: Date | null | undefined
}

export interface SleepRegularity {
  /** -100 to 100. 100 = identical every day. */
  sri: number
  /** Consecutive day-pairs the figure is based on. */
  pairs: number
}

/** Fewer comparable pairs than this and a week has not been seen yet. */
export const MIN_REGULARITY_PAIRS = 7

const DAY_MIN = 24 * 60

/**
 * The local wall-clock minute of an instant, counted from midnight on
 * `anchor` — so 02:30 the day after the anchor is 1590.
 *
 * Wall clock on purpose. Regularity is a question about the hours you keep,
 * and on the night the clocks go back you really were in bed an hour longer
 * by the clock on the wall.
 */
function localMinuteFrom(anchor: string, at: Date, timezone: string): number {
  // Both halves through the shared helpers rather than a second Intl call of
  // its own — `no-utc-day-bucketing` exists precisely to stop a file growing
  // its own clock, and a private fallback to UTC here would put anyone east
  // or west of Greenwich an hour or more out on every night it touched.
  const [h, m] = localTimeStr(timezone, at).split(":").map(Number)
  return daysBetween(anchor, localDateStr(timezone, at)) * DAY_MIN + h * 60 + m
}

function daysBetween(from: string, to: string): number {
  // Date.UTC counts months from zero and the string counts from one. The
  // offset does NOT cancel between the two calls: read as written, 2026-01-01
  // becomes February and 2026-02-01 becomes March, and the gap between them
  // comes back 28 days instead of 31. Every month of a different length is a
  // different wrong answer, which is the sort that survives a spot check.
  const utc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}

export function sleepRegularity(nights: RhythmNight[], timezone: string): SleepRegularity | null {
  const usable = nights
    .filter(n => n.sleepStart != null && n.sleepEnd != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (usable.length < 3) return null

  // Everything is measured in minutes from midnight on the first day the
  // window touches — the evening before the earliest night on record.
  const anchor = usable[0].date
  const spanDays = daysBetween(anchor, usable[usable.length - 1].date) + 1
  // One extra day either side: a night filed under the anchor began the
  // evening before it, so its start is a negative minute without the pad.
  const PAD = 1
  const asleep = new Uint8Array((spanDays + PAD * 2) * DAY_MIN)
  const known = new Uint8Array(spanDays + PAD * 2)
  const shift = PAD * DAY_MIN

  for (const n of usable) {
    const from = localMinuteFrom(anchor, n.sleepStart!, timezone) + shift
    const to = localMinuteFrom(anchor, n.sleepEnd!, timezone) + shift
    if (!(to > from) || to - from > DAY_MIN) continue  // a nonsense window says nothing
    for (let m = Math.max(0, from); m < Math.min(asleep.length, to); m++) asleep[m] = 1
    // The night filed under D covers the tail of D and the evening of D-1, so
    // a local day is fully described only once both of its nights are in.
    const day = daysBetween(anchor, n.date) + PAD
    if (day - 1 >= 0) known[day - 1] |= 1        // this night describes the evening of D-1
    if (day < known.length) known[day] |= 2      // and the morning of D
  }

  let matches = 0
  let total = 0
  for (let d = 0; d + 1 < known.length; d++) {
    // Both days need both halves, or the pair is comparing a record against a
    // gap and calling the silence agreement.
    if (known[d] !== 3 || known[d + 1] !== 3) continue
    const a = d * DAY_MIN
    const b = (d + 1) * DAY_MIN
    for (let m = 0; m < DAY_MIN; m++) if (asleep[a + m] === asleep[b + m]) matches++
    total += DAY_MIN
  }
  const pairs = total / DAY_MIN
  if (pairs < MIN_REGULARITY_PAIRS) return null
  return { sri: Math.round((200 * matches) / total - 100), pairs }
}
