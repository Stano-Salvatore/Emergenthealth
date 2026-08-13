// What moved between two blood draws, and what you were doing in between.
//
// Lab results are sparse and slow, so they don't go through the day-level
// correlation engine: that machinery rests on a permutation test over dozens
// of days, and a marker with three readings a year would get a p-value
// computed from three points — a number that looks like evidence and isn't.
//
// Everything here is DESCRIPTIVE. "Your vitamin D went from 42 to 68, and you
// logged D3 weekly through the window in between" is a true statement about
// two facts sitting next to each other. "D3 raised your vitamin D" is a causal
// claim this data cannot support — one person, no control, no randomisation —
// and nothing in this file makes it.

import { normalizeSupplement, cleanLabel } from "@/lib/supplement-normalize"
import { convertLabValue, normalizeUnit } from "@/lib/lab-units"
import { referenceChangeValue } from "@/lib/lab-variation"
import { cadenceLabel, describeCadence, type Cadence } from "@/lib/dose-cadence"

export interface LabReading {
  marker: string
  value: number
  unit: string
  /** YYYY-MM-DD. */
  date: string
  referenceMin: number | null
  referenceMax: number | null
}

export interface DayTags {
  /** YYYY-MM-DD. */
  day: string
  /** Whatever the dose was logged as. */
  name: string
}

export type RangeStatus = "in-range" | "below" | "above" | "unknown"

export interface IntervalHabit {
  name: string
  daysTaken: number
  coverage: number
  cadence: Cadence
  /** Human-readable rhythm: "daily", "weekly", "every ~4 days"… */
  cadenceLabel: string
  /** True when it was barely present in the run-up to the previous draw. */
  newSince: boolean
}

export interface MarkerTrend {
  marker: string
  unit: string
  latest: LabReading
  previous: LabReading | null
  status: RangeStatus
  previousStatus: RangeStatus
  /** Signed percentage change, or null when it can't honestly be computed. */
  changePct: number | null
  direction: "up" | "down" | "flat" | null
  /**
   * Bigger than this marker's own natural variation between draws?
   * Null when the marker's variability isn't known — an honest "can't say",
   * not a guess in either direction.
   */
  significant: boolean | null
  /** The change this marker has to beat to count, in %. Null if unknown. */
  rcvPct: number | null
  crossed: "into range" | "out of range" | null
  intervalDays: number | null
  /** What was taken through the interval. Context, not cause. */
  taken: IntervalHabit[]
  summary: string
  /**
   * The previous reading was printed in a different unit and was converted to
   * this one for the comparison. The stored result is untouched.
   */
  converted: { from: string; to: string; previousAs: number } | null
  /** Units genuinely can't be reconciled, so no change was computed. */
  unitMismatch: boolean
}

/** Share of the prior window below which a substance counts as newly started. */
const WAS_ABSENT = 0.2
const MAX_HABITS = 4

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000,
  )
}

function shiftDays(day: string, n: number): string {
  const d = new Date(day + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function rangeStatus(r: LabReading): RangeStatus {
  if (r.referenceMin == null && r.referenceMax == null) return "unknown"
  if (r.referenceMin != null && r.value < r.referenceMin) return "below"
  if (r.referenceMax != null && r.value > r.referenceMax) return "above"
  return "in-range"
}

/** Canonical substance name, so dosage text doesn't split one thing into two. */
function substance(name: string): string {
  return normalizeSupplement(name) ?? cleanLabel(name)
}

/** Distinct days each substance was logged on, within [from, to). */
function daysBySubstance(tags: DayTags[], from: string, to: string): Map<string, string[]> {
  const out = new Map<string, Set<string>>()
  for (const t of tags) {
    if (t.day < from || t.day >= to) continue
    const key = substance(t.name)
    if (!key) continue
    let set = out.get(key)
    if (!set) { set = new Set(); out.set(key, set) }
    set.add(t.day)
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]))
}

function intervalHabits(tags: DayTags[], from: string, to: string): IntervalHabit[] {
  const span = Math.max(1, daysBetween(from, to))
  const during = daysBySubstance(tags, from, to)
  // The same length of time before the earlier draw, for "was this new?"
  const before = daysBySubstance(tags, shiftDays(from, -span), from)

  const habits: IntervalHabit[] = []
  for (const [name, days] of during) {
    const pattern = describeCadence(days, span)
    // Either a recognisable rhythm that ran the window, or simply frequent.
    // A handful of scattered doses is neither and doesn't belong beside a
    // blood result.
    if (!pattern.consistent) continue

    const priorDays = before.get(name) ?? []
    const priorPattern = describeCadence(priorDays, span)
    // "New" has to be judged on the same footing: a weekly dose that was also
    // weekly before is not new, even though its coverage is only 14%.
    const wasThere = priorPattern.consistent || priorDays.length / span >= WAS_ABSENT

    habits.push({
      name,
      daysTaken: pattern.daysTaken,
      coverage: pattern.coverage,
      cadence: pattern.cadence,
      cadenceLabel: cadenceLabel(pattern),
      newSince: !wasThere,
    })
  }

  // Newly started things first — those are what actually changed.
  return habits
    .sort((a, b) => (Number(b.newSince) - Number(a.newSince)) || (b.coverage - a.coverage))
    .slice(0, MAX_HABITS)
}

const r1 = (n: number) => Math.round(n * 10) / 10

function buildSummary(t: Omit<MarkerTrend, "summary">): string {
  const u = t.unit ? ` ${t.unit}` : ""
  const now = `${r1(t.latest.value)}${u}`

  if (!t.previous) {
    const where =
      t.status === "above" ? ", above the range printed on the report"
        : t.status === "below" ? ", below the range printed on the report"
          : t.status === "in-range" ? ", within the range printed on the report"
            : ""
    return `${t.marker} ${now}${where}. First reading — nothing to compare it with yet.`
  }

  if (t.unitMismatch) {
    return `${t.marker} ${now}, but the previous result was reported in ${t.previous.unit} and the two units can't be reconciled for this marker — so no change is shown.`
  }

  const wasValue = t.converted ? t.converted.previousAs : t.previous.value
  const was = `${r1(wasValue)}${u}`
  const months = t.intervalDays != null ? Math.round(t.intervalDays / 30) : null
  const gap = months != null && months >= 1 ? ` over ${months} month${months === 1 ? "" : "s"}` : ""

  let line: string
  if (t.direction === "flat") {
    line = t.rcvPct != null
      ? `${t.marker} is holding steady at ${now} (was ${was}${gap}) — the ${Math.abs(Math.round(t.changePct!))}% difference is inside the ~${t.rcvPct}% this marker moves on its own.`
      : `${t.marker} is steady at ${now} (was ${was}${gap}).`
  } else {
    const word = t.direction === "up" ? "up" : "down"
    line = `${t.marker} ${word} from ${was} to ${now}${gap} (${t.changePct! > 0 ? "+" : ""}${Math.round(t.changePct!)}%).`
    if (t.significant === true && t.rcvPct != null) {
      line += ` That's a real move — bigger than the ~${t.rcvPct}% this marker varies between draws.`
    } else if (t.significant === null) {
      line += " How much this marker naturally varies isn't something we hold, so treat the size with caution."
    }
  }

  if (t.converted) {
    line += ` (The earlier result was printed in ${t.converted.from}; converted to ${t.converted.to} to compare.)`
  }

  if (t.crossed === "into range") line += " That brings it inside the report's reference range."
  else if (t.crossed === "out of range") line += " That takes it outside the report's reference range."
  else if (t.status === "above" || t.status === "below") line += ` Still ${t.status === "above" ? "above" : "below"} the reference range.`

  // Context, phrased as co-occurrence. The reader draws their own conclusion,
  // and the doctor who ordered the test draws the real one.
  const started = t.taken.filter(h => h.newSince)
  const context = started.length > 0 ? started : t.taken
  if (context.length > 0) {
    const list = context.slice(0, 2).map(h => `${h.name} (${h.cadenceLabel})`).join(" and ")
    line += started.length > 0
      ? ` You started logging ${list} in that window.`
      : ` Through that window you logged ${list}.`
  }

  return line
}

/**
 * One trend per marker, newest reading first, most-recently-drawn markers
 * first. `tags` is every logged dose — Oura tags and manual ones alike.
 */
export function computeLabTrends(readings: LabReading[], tags: DayTags[] = []): MarkerTrend[] {
  const byMarker = new Map<string, LabReading[]>()
  for (const r of readings) {
    if (!r.marker || !Number.isFinite(r.value)) continue
    const list = byMarker.get(r.marker)
    if (list) list.push(r)
    else byMarker.set(r.marker, [r])
  }

  const trends: MarkerTrend[] = []
  for (const [marker, list] of byMarker) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
    const latest = sorted[sorted.length - 1]
    const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null

    // Units are stored exactly as the lab printed them, so two readings can
    // legitimately disagree. Reconcile them where the conversion is defined,
    // and only give up where it genuinely isn't.
    let previousValue: number | null = previous ? previous.value : null
    let converted: MarkerTrend["converted"] = null
    let unitMismatch = false

    if (previous) {
      const sameUnit = normalizeUnit(previous.unit) === normalizeUnit(latest.unit)
      if (!sameUnit) {
        const asLatest = convertLabValue(previous.value, previous.unit, latest.unit, marker)
        if (asLatest == null) {
          previousValue = null
          unitMismatch = true
        } else {
          previousValue = asLatest
          converted = { from: previous.unit, to: latest.unit, previousAs: Math.round(asLatest * 1000) / 1000 }
        }
      }
    }

    const comparable = previousValue != null && previousValue !== 0
    const changePct = comparable ? ((latest.value - previousValue!) / Math.abs(previousValue!)) * 100 : null

    const rcvPct = referenceChangeValue(marker)
    // Below the marker's own noise floor is "steady", not a small change. With
    // no published variation for the marker we can't call it either way, so
    // the direction stands and `significant` says we don't know.
    const significant = changePct == null ? null : rcvPct == null ? null : Math.abs(changePct) >= rcvPct
    const direction = changePct == null ? null
      : significant === false ? "flat" as const
        : changePct > 0 ? "up" as const : "down" as const

    const status = rangeStatus(latest)
    const previousStatus = previous ? rangeStatus(previous) : "unknown" as RangeStatus
    const crossed =
      previous == null || status === "unknown" || previousStatus === "unknown" ? null
        : previousStatus !== "in-range" && status === "in-range" ? "into range" as const
          : previousStatus === "in-range" && status !== "in-range" ? "out of range" as const
            : null

    const intervalDays = previous ? daysBetween(previous.date, latest.date) : null
    const taken = previous && intervalDays != null && intervalDays > 0
      ? intervalHabits(tags, previous.date, latest.date)
      : []

    const base = {
      marker, unit: latest.unit, latest, previous, status, previousStatus,
      changePct, direction, significant, rcvPct, crossed, intervalDays, taken,
      converted, unitMismatch,
    }
    trends.push({ ...base, summary: buildSummary(base) })
  }

  return trends.sort((a, b) => b.latest.date.localeCompare(a.latest.date) || a.marker.localeCompare(b.marker))
}

/**
 * The markers worth putting in front of someone: outside the printed range,
 * newly crossed it, or moved further than the marker naturally moves.
 */
export function notableTrends(trends: MarkerTrend[]): MarkerTrend[] {
  return trends
    .filter(t => t.status === "above" || t.status === "below" || t.crossed != null || t.significant === true)
    .sort((a, b) =>
      (Number(b.crossed != null) - Number(a.crossed != null)) ||
      (Number(b.significant === true) - Number(a.significant === true)))
}
