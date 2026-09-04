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

/**
 * One day's worth of the ordinary numbers the app already keeps, for the days
 * it has any record of at all.
 *
 * "Any record at all" is the important part. A window where nothing was
 * logged must not read as a window where nothing happened — a fortnight on
 * holiday with the phone in a drawer would otherwise come back as two sober,
 * sedentary weeks. So the caller supplies a row only for days it genuinely
 * knows something about, and a metric that is absent on a known day is null
 * rather than zero, except where zero is the real reading: no drink logged on
 * a day the app was in use is a day without a drink.
 */
export interface DayFacts {
  /** YYYY-MM-DD. */
  day: string
  alcoholMl?: number | null
  workoutMin?: number | null
  sleepH?: number | null
  steps?: number | null
  weightKg?: number | null
}

/**
 * How one everyday number differed through the interval between two draws,
 * measured against the same length of time before the earlier one.
 *
 * The comparison is the whole point. "You averaged 2 drinks a day" is trivia;
 * "2 a day, up from half of one" is the thing a reader can put next to a liver
 * marker — and, exactly like `IntervalHabit`, it is a co-occurrence and not a
 * cause.
 */
export interface IntervalBehaviour {
  key: string
  label: string
  /** Mean per day through the interval. */
  during: number
  /** Mean per day over the matching window before the earlier draw. */
  before: number
  changePct: number
  direction: "up" | "down"
  /** Ready to read: "38 min a day, up from 12". */
  phrase: string
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
  /** How daily life differed through the interval. Context, not cause. */
  behaviours: IntervalBehaviour[]
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
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

// ── Everyday numbers through the interval ────────────────────────────────────

/** Both windows need this many days carrying the number, and this much of the
 *  window covered, before the two are worth comparing. Below either, the
 *  comparison is between a fortnight and a Tuesday. */
const BEHAVIOUR_MIN_DAYS = 5
const BEHAVIOUR_MIN_COVERAGE = 0.4
/** Smaller than this and it is the same life with a different rounding. */
const BEHAVIOUR_MIN_CHANGE_PCT = 25
const MAX_BEHAVIOURS = 3

const BEHAVIOUR_METRICS: {
  key: string
  label: string
  pick: (f: DayFacts) => number | null | undefined
  say: (v: number) => string
}[] = [
  { key: "alcohol", label: "alcohol", pick: f => f.alcoholMl, say: v => `${Math.round(v)} ml a day` },
  { key: "workout", label: "exercise", pick: f => f.workoutMin, say: v => `${Math.round(v)} min a day` },
  { key: "sleep", label: "sleep", pick: f => f.sleepH, say: v => `${r1(v)} h a night` },
  { key: "steps", label: "steps", pick: f => f.steps, say: v => `${Math.round(v).toLocaleString("en-US")} a day` },
  { key: "weight", label: "weight", pick: f => f.weightKg, say: v => `${r1(v)} kg` },
]

function intervalBehaviours(facts: DayFacts[], from: string, to: string): IntervalBehaviour[] {
  const span = Math.max(1, daysBetween(from, to))
  const priorFrom = shiftDays(from, -span)
  const during = facts.filter(f => f.day >= from && f.day < to)
  const before = facts.filter(f => f.day >= priorFrom && f.day < from)

  const out: IntervalBehaviour[] = []
  for (const m of BEHAVIOUR_METRICS) {
    const d = during.map(m.pick).filter((v): v is number => v != null && Number.isFinite(v))
    const b = before.map(m.pick).filter((v): v is number => v != null && Number.isFinite(v))
    if (d.length < BEHAVIOUR_MIN_DAYS || b.length < BEHAVIOUR_MIN_DAYS) continue
    if (d.length < span * BEHAVIOUR_MIN_COVERAGE || b.length < span * BEHAVIOUR_MIN_COVERAGE) continue

    const dm = mean(d), bm = mean(b)
    // Measuring against whichever side is non-zero makes "didn't drink at all
    // before, does now" a clean 100% rather than a division by zero.
    const base = Math.abs(bm) || Math.abs(dm)
    if (base === 0) continue
    const changePct = ((dm - bm) / base) * 100
    if (Math.abs(changePct) < BEHAVIOUR_MIN_CHANGE_PCT) continue

    out.push({
      key: m.key,
      label: m.label,
      during: r1(dm),
      before: r1(bm),
      changePct: Math.round(changePct),
      direction: changePct > 0 ? "up" : "down",
      phrase: `${m.say(dm)}, ${changePct > 0 ? "up" : "down"} from ${m.say(bm)}`,
    })
  }

  // Biggest change first — that is the one worth a reader's attention.
  return out
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, MAX_BEHAVIOURS)
}

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

  // The same treatment for the numbers the app keeps anyway. Two at most: the
  // summary is already a paragraph, and a list of five changes reads as a
  // shrug rather than a signal.
  if (t.behaviours.length > 0) {
    const list = t.behaviours.slice(0, 2).map(b => `${b.label} ${b.phrase}`).join(", and ")
    line += ` Over the same window, ${list}.`
  }

  return line
}

/**
 * One trend per marker, newest reading first, most-recently-drawn markers
 * first. `tags` is every logged dose — Oura tags and manual ones alike;
 * `facts` is the everyday numbers, one row per day the app knows anything
 * about.
 */
export function computeLabTrends(
  readings: LabReading[],
  tags: DayTags[] = [],
  facts: DayFacts[] = [],
): MarkerTrend[] {
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
    const hasInterval = previous != null && intervalDays != null && intervalDays > 0
    const taken = hasInterval ? intervalHabits(tags, previous!.date, latest.date) : []
    const behaviours = hasInterval ? intervalBehaviours(facts, previous!.date, latest.date) : []

    const base = {
      marker, unit: latest.unit, latest, previous, status, previousStatus,
      changePct, direction, significant, rcvPct, crossed, intervalDays, taken,
      behaviours, converted, unitMismatch,
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
