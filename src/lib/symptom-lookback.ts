// "What came before this one?" — a look-back for a single symptom episode.
//
// The correlation engine's symptom cards need a symptom on four or more days
// before they will even try, and then a group big enough to pass its gates. A
// headache three or four times a month never gets there, so the Symptoms page
// was a plain list. This answers the smaller question a person actually asks
// the moment it hurts: was anything different in the day and a half before?
//
// It is anomalies.ts pointed at an instant instead of a morning. Each factor
// is measured over a window ending at the episode, and again over the same
// window ending at the same local clock time on each of the 45 days before —
// that set is the user's usual, and only a factor that sits outside it is
// reported. Median and MAD, for the reason anomalies.ts gives: one terrible
// night must not widen the usual until nothing ever looks different again.
//
// Pure: the route loads the rows, this decides what they say.

import { median, mad, Z_THRESHOLD, MIN_HISTORY_DAYS, TRACKED_METRICS } from "@/lib/anomalies"
import { localDateStr, localTimeStr, addDaysISO, zonedDateTime, zonedClock } from "@/lib/local-date"
import { standardDrinks } from "@/lib/body-load"
import { RING_OFF_MAX_STEPS } from "@/lib/sleep-quality"

/** Days of the user's own life the usual is drawn from. */
export const BASELINE_DAYS = 45
/** How far back anything is looked for — the night before, and the evening before that. */
export const LOOKBACK_HOURS = 36
/** Episodes of one symptom needed before anything is said about what they share. */
export const MIN_EPISODES = 3
/** The most recent episodes the recurring line is drawn from, this one included. */
export const RECENT_EPISODES = 5
/** Older episodes than this are a different stretch of life, not "your last few". */
export const EPISODE_HORIZON_DAYS = 180
/**
 * Logs of the same symptom closer together than this are one episode. A
 * headache logged at 08:00 and again at 10:00 as it got worse is one headache;
 * counting it twice would let one bad night vote twice.
 */
export const SAME_EPISODE_HOURS = 12

const HOUR = 3_600_000

export interface LookbackData {
  timezone: string
  /** HealthLog nights as the ring-wins row holds them. `morning` is the row's date. */
  nights: { morning: string; end: Date | null; minutes: number }[]
  /** HealthLog steps by the user's local day. */
  stepDays: { day: string; steps: number }[]
  /** Alcoholic drinks, in grams of ethanol. */
  drinks: { at: Date; grams: number }[]
  caffeine: { at: Date; mg: number }[]
  /**
   * Instants the user wrote anything down — any drink, a meal, a caffeine
   * entry. A stretch with none of these has unknown drinks and caffeine; a
   * stretch with some and no alcohol among them is a sober one.
   */
  diary: Date[]
  /** Phone barometer (station pressure). */
  pressure: { at: Date; hPa: number }[]
  /** Medication and supplement doses, by canonical name. */
  doses: { at: Date; name: string }[]
}

export interface SymptomRow { id: string; name: string; loggedAt: Date }

export type Direction = "above" | "below"

export interface LookbackFactor {
  key: string
  text: string
  direction: Direction
  value: number
  usual: number
}

export interface Lookback {
  /** Only what sat outside the user's usual, in a fixed order. */
  factors: LookbackFactor[]
  /** Checked and ordinary — so "nothing stood out" can say what was looked at. */
  steady: string[]
  /** No reading, or too little history to know what usual is. */
  unmeasured: string[]
}

export interface SymptomLookbackResult extends Lookback {
  /** Observations about what recent episodes shared. Empty below MIN_EPISODES. */
  recurring: string[]
  /** Distinct episodes of this symptom counted, this one included. */
  episodes: number
}

/**
 * Where `value` sits against a history of the same measurement, or null when
 * it sits inside it (or the history is too short to say).
 *
 * The one departure from detectAnomaly: a history with no spread at all. There
 * anomalies.ts stays silent, reasonably — a metronomic heart rate makes any
 * wobble look infinite. Here the flat histories are the drinks of someone who
 * mostly doesn't, and "three drinks against none" is the thing this exists to
 * notice. So with no spread, the relevance floor alone decides.
 */
export function differsFromUsual(
  value: number,
  history: number[],
  minAbsShift: number,
): { usual: number; direction: Direction } | null {
  if (history.length < MIN_HISTORY_DAYS) return null
  const usual = median(history)
  const shift = Math.abs(value - usual)
  if (shift < minAbsShift) return null
  const spread = mad(history, usual)
  if (spread > 0 && shift / spread < Z_THRESHOLD) return null
  return { usual, direction: value > usual ? "above" : "below" }
}

// ── Reading the rows ──────────────────────────────────────────────────────────

type Timed = { at: Date }

/** Rows with `from < at <= to`, from an array sorted by `at`. */
function between<T extends Timed>(rows: T[], from: number, to: number): T[] {
  let lo = 0, hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].at.getTime() <= from) lo = mid + 1; else hi = mid
  }
  const out: T[] = []
  for (let i = lo; i < rows.length && rows[i].at.getTime() <= to; i++) out.push(rows[i])
  return out
}

interface Prepared {
  tz: string
  nights: { at: Date; hours: number }[]
  steps: Map<string, number>
  drinks: { at: Date; grams: number }[]
  caffeine: { at: Date; mg: number }[]
  diary: Timed[]
  pressure: { at: Date; hPa: number }[]
  doses: { at: Date; name: string }[]
  /** Dose logging's first day: before it, "not logged" says nothing. */
  dosesFrom: number | null
}

const byTime = <T extends Timed>(rows: T[]) => [...rows].sort((a, b) => a.at.getTime() - b.at.getTime())

function prepare(d: LookbackData): Prepared {
  const tz = d.timezone
  const nights: { at: Date; hours: number }[] = []
  for (const n of d.nights) {
    // A zero-minute night is a ring that was not worn, not a night without sleep.
    if (!(n.minutes > 0)) continue
    // Rows written without bed times still describe the night ending that
    // morning; 07:00 is only used to place it in the window.
    const end = n.end ?? zonedClock(tz, n.morning, "07:00")
    if (end) nights.push({ at: end, hours: n.minutes / 60 })
  }
  const steps = new Map<string, number>()
  for (const s of d.stepDays) steps.set(s.day, s.steps)
  const doses = byTime(d.doses)
  return {
    tz,
    nights: byTime(nights),
    steps,
    drinks: byTime(d.drinks),
    caffeine: byTime(d.caffeine),
    diary: byTime(d.diary.map(at => ({ at }))),
    pressure: byTime(d.pressure),
    doses,
    dosesFrom: doses.length ? doses[0].at.getTime() : null,
  }
}

// ── The factors ───────────────────────────────────────────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10
const hhmm = (min: number) => {
  const m = Math.round(min)
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}
const localMinutes = (tz: string, at: Date) => {
  const [h, m] = localTimeStr(tz, at).split(":").map(Number)
  return h * 60 + m
}
const drinksWord = (n: number) => {
  const half = Math.round(n * 2) / 2
  return half === 1 ? "1 drink" : `${half} drinks`
}
const stepsWord = (n: number) => (Math.round(n / 100) * 100).toLocaleString("en-GB")

/** The local day before the one `at` falls on. */
const dayBefore = (tz: string, at: Date) => addDaysISO(localDateStr(tz, at), -1)

/** Whether anything at all was written down in the window. */
function diaryOpen(p: Prepared, from: number, to: number): boolean {
  return between(p.diary, from, to).length > 0
    || between(p.drinks, from, to).length > 0
    || between(p.caffeine, from, to).length > 0
}

interface FactorSpec {
  key: string
  /** How the factor is named in the "checked" and "no data" lists. */
  noun: string
  minAbsShift: number
  measure: (p: Prepared, at: Date) => number | null
  describe: (value: number, usual: number, p: Prepared, at: Date) => string
  /** The subject of a recurring sentence, per direction. */
  subject: Record<Direction, string>
}

const spec = (key: string) => TRACKED_METRICS.find(m => m.key === key)!

const FACTORS: FactorSpec[] = [
  {
    key: "sleep",
    noun: "sleep",
    minAbsShift: spec("sleepDuration").minAbsShift,
    // The last night that ended in the 24 hours before — the one this
    // morning woke from, or last night's if the symptom came before bed. Not
    // the full look-back: with last night missing, the night before it would
    // stand in as "the night before this one", and it is not.
    measure: (p, at) => {
      const nights = between(p.nights, at.getTime() - 24 * HOUR, at.getTime())
      return nights.length ? nights[nights.length - 1].hours : null
    },
    describe: (v, u) => `${r1(v)}h sleep (your usual ${r1(u)}h)`,
    subject: { below: "A short night", above: "A long night" },
  },
  {
    key: "drinks",
    noun: "drinks",
    minAbsShift: 1,
    measure: (p, at) => {
      const from = at.getTime() - 24 * HOUR, to = at.getTime()
      const grams = between(p.drinks, from, to).reduce((s, d) => s + d.grams, 0)
      if (grams > 0) return standardDrinks(grams)
      return diaryOpen(p, from, to) ? 0 : null
    },
    describe: (v, u, p, at) => {
      const usual = u === 0 ? "none" : drinksWord(u)
      if (v === 0) return `no drinks in the 24h before (usually ${usual})`
      const drinks = between(p.drinks, at.getTime() - 24 * HOUR, at.getTime())
      return `${drinksWord(v)} ${whenWords(p.tz, drinks[drinks.length - 1].at, at)} (usually ${usual})`
    },
    subject: { above: "Drinking", below: "A night without drinks" },
  },
  {
    key: "caffeine",
    noun: "caffeine",
    minAbsShift: 80,
    measure: (p, at) => {
      const from = at.getTime() - 24 * HOUR, to = at.getTime()
      const mg = between(p.caffeine, from, to).reduce((s, c) => s + c.mg, 0)
      if (mg > 0) return mg
      return diaryOpen(p, from, to) ? 0 : null
    },
    describe: (v, u) => v === 0
      ? `no caffeine in the 24h before (usually ${Math.round(u)}mg)`
      : `${Math.round(v)}mg caffeine in 24h (usually ${Math.round(u)}mg)`,
    subject: { above: "More caffeine than usual", below: "Less caffeine than usual" },
  },
  {
    key: "lastCaffeine",
    noun: "caffeine timing",
    minAbsShift: 90,
    // The clock time of the day before's last caffeine. A day without any has
    // no such time — it must not become midnight.
    measure: (p, at) => {
      const day = dayBefore(p.tz, at)
      const start = zonedDateTime(p.tz, `${day}T00:00`)
      const end = zonedDateTime(p.tz, `${addDaysISO(day, 1)}T00:00`)
      if (!start || !end) return null
      const rows = between(p.caffeine, start.getTime() - 1, end.getTime() - 1)
      return rows.length ? localMinutes(p.tz, rows[rows.length - 1].at) : null
    },
    describe: (v, u) => `last caffeine ${hhmm(v)} the day before (usually ${hhmm(u)})`,
    subject: { above: "Late caffeine", below: "Earlier caffeine than usual" },
  },
  {
    key: "pressure",
    noun: "pressure",
    minAbsShift: 5,
    // Station pressure, so a drive uphill reads like a front. The medians of a
    // few hours at each end blunt a single reading taken on a hilltop; they
    // cannot tell a day spent up a mountain from weather, and that is why the
    // line says what the barometer did rather than what the sky did.
    measure: (p, at) => {
      const t = at.getTime()
      const now = between(p.pressure, t - 3 * HOUR, t).map(r => r.hPa)
      const then = between(p.pressure, t - 27 * HOUR, t - 21 * HOUR).map(r => r.hPa)
      return now.length && then.length ? median(now) - median(then) : null
    },
    describe: (v, u) => {
      const usual = Math.abs(u) < 2 ? "steady" : `${u > 0 ? "rises" : "falls"} ${Math.round(Math.abs(u))} hPa`
      return `pressure ${v < 0 ? "fell" : "rose"} ${Math.round(Math.abs(v))} hPa in 24h (usually ${usual})`
    },
    subject: { below: "Falling pressure", above: "Rising pressure" },
  },
  {
    key: "steps",
    noun: "steps",
    minAbsShift: spec("steps").minAbsShift,
    // The whole day before; today's count is not finished yet.
    measure: (p, at) => {
      const steps = p.steps.get(dayBefore(p.tz, at))
      return steps != null && steps >= RING_OFF_MAX_STEPS ? steps : null
    },
    describe: (v, u) => `${stepsWord(v)} steps the day before (usually ${stepsWord(u)})`,
    subject: { below: "Fewer steps than usual", above: "More steps than usual" },
  },
]

/**
 * "last night", "earlier today" — on the user's clock. A drink at 00:30 is
 * last night's whatever the date says.
 */
function whenWords(tz: string, drink: Date, at: Date): string {
  const drinkDay = localDateStr(tz, drink)
  const hour = Math.floor(localMinutes(tz, drink) / 60)
  if (drinkDay === localDateStr(tz, at)) {
    if (hour < 5) return "last night"
    return hour >= 17 ? "this evening" : "earlier today"
  }
  if (drinkDay === dayBefore(tz, at)) return hour >= 17 ? "last night" : "yesterday"
  return "in the 24h before"
}

// ── One episode ───────────────────────────────────────────────────────────────

/**
 * The same local clock time on each of the BASELINE_DAYS before, skipping days
 * the same symptom was logged — the usual is what life looks like without it.
 */
function anchorsBefore(tz: string, at: Date, skipDays: ReadonlySet<string>): Date[] {
  const day = localDateStr(tz, at)
  const clock = localTimeStr(tz, at)
  const out: Date[] = []
  for (let k = 1; k <= BASELINE_DAYS; k++) {
    const d = addDaysISO(day, -k)
    if (skipDays.has(d)) continue
    const anchor = zonedDateTime(tz, `${d}T${clock}`)
    if (anchor) out.push(anchor)
  }
  return out
}

interface Evaluated {
  lookback: Lookback
  /** Factor keys that had a reading and a history, whichever way they went. */
  measured: Set<string>
  /** `${key}:${direction}` → the subject of a recurring sentence. */
  flagged: Map<string, string>
}

function evaluate(p: Prepared, at: Date, skipDays: ReadonlySet<string>): Evaluated {
  const anchors = anchorsBefore(p.tz, at, skipDays)
  const factors: LookbackFactor[] = []
  const steady: string[] = []
  const unmeasured: string[] = []
  const measured = new Set<string>()
  const flagged = new Map<string, string>()

  for (const f of FACTORS) {
    const value = f.measure(p, at)
    const history = anchors.map(a => f.measure(p, a)).filter((v): v is number => v != null)
    if (value == null || history.length < MIN_HISTORY_DAYS) { unmeasured.push(f.noun); continue }
    measured.add(f.key)
    const d = differsFromUsual(value, history, f.minAbsShift)
    if (!d) { steady.push(f.noun); continue }
    factors.push({ key: f.key, text: f.describe(value, d.usual, p, at), direction: d.direction, value: r1(value), usual: r1(d.usual) })
    flagged.set(`${f.key}:${d.direction}`, f.subject[d.direction])
  }

  // Doses, one factor per substance taken in the window. Only ever "taken and
  // not usually" — a regular dose missing from the log is a dose nobody
  // logged as often as one nobody took, and a look-back that said "no
  // magnesium" on the strength of an empty row would be inventing a miss.
  if (p.dosesFrom != null) {
    const covered = anchors.filter(a => a.getTime() - LOOKBACK_HOURS * HOUR >= p.dosesFrom!)
    if (covered.length >= MIN_HISTORY_DAYS) {
      measured.add("doses")
      const taken = between(p.doses, at.getTime() - LOOKBACK_HOURS * HOUR, at.getTime())
      const latest = new Map<string, Date>()
      for (const t of taken) latest.set(t.name, t.at)
      for (const [name, when] of latest) {
        const history = covered.map(a =>
          between(p.doses, a.getTime() - LOOKBACK_HOURS * HOUR, a.getTime()).some(t => t.name === name) ? 1 : 0)
        if (!differsFromUsual(1, history, 1)) continue
        factors.push({ key: `med:${name}`, text: `${name} at ${localTimeStr(p.tz, when)} (not a usual one)`, direction: "above", value: 1, usual: 0 })
        flagged.set(`med:${name}:above`, name)
      }
    }
  }

  return { lookback: { factors, steady, unmeasured }, measured, flagged }
}

// ── Across episodes ───────────────────────────────────────────────────────────

/** "headaches", "stomach aches" — and "brain fog episodes" rather than a guessed plural. */
function episodesWord(name: string): string {
  const lower = name.toLowerCase()
  return /ache$/.test(lower) ? `${lower}s` : `${lower} episodes`
}

/**
 * What the recent episodes had in common, as observations. A factor counts
 * only over the episodes it was measured for, and the sentence says so when
 * that is fewer than all of them — "3 of your last 4" over three measured
 * episodes would be a count nobody made.
 */
function recurringLines(name: string, episodes: Evaluated[]): string[] {
  const n = episodes.length
  if (n < MIN_EPISODES) return []
  const nounOf = (key: string) => key.startsWith("med:") ? "doses" : FACTORS.find(f => f.key === key)?.noun ?? key
  const measuredKey = (key: string) => key.startsWith("med:") ? "doses" : key

  const seen = new Map<string, string>()
  for (const e of episodes) for (const [k, subject] of e.flagged) if (!seen.has(k)) seen.set(k, subject)

  const lines: { text: string; share: number; k: number }[] = []
  for (const [flag, subject] of seen) {
    const key = flag.slice(0, flag.lastIndexOf(":"))
    const measured = episodes.filter(e => e.measured.has(measuredKey(key))).length
    const k = episodes.filter(e => e.flagged.has(flag)).length
    if (measured < MIN_EPISODES || k < 2 || k * 2 < measured) continue
    const text = measured === n
      ? `${subject} showed up before ${k} of your last ${n} ${episodesWord(name)}`
      : `${subject} showed up before ${k} of the ${measured} recent ${episodesWord(name)} with ${nounOf(key)} recorded`
    lines.push({ text, share: k / measured, k })
  }
  return lines
    .sort((a, b) => b.share - a.share || b.k - a.k)
    .slice(0, 3)
    .map(l => l.text)
}

/**
 * The current episode, and up to RECENT_EPISODES - 1 before it: logs of the
 * same name, at least SAME_EPISODE_HOURS apart, within EPISODE_HORIZON_DAYS.
 */
function recentEpisodes(current: SymptomRow, sameName: SymptomRow[]): Date[] {
  const t0 = current.loggedAt.getTime()
  const earlier = sameName
    .filter(r => r.id !== current.id && r.name === current.name)
    .map(r => r.loggedAt.getTime())
    .filter(t => t < t0 && t >= t0 - EPISODE_HORIZON_DAYS * 24 * HOUR)
    .sort((a, b) => b - a)
  const kept = [t0]
  for (const t of earlier) {
    if (kept.length >= RECENT_EPISODES) break
    if (kept[kept.length - 1] - t >= SAME_EPISODE_HOURS * HOUR) kept.push(t)
  }
  return kept.map(t => new Date(t))
}

/**
 * The earliest instant the rows must reach back to: the oldest episode that
 * will be counted, less its whole usual and the look-back behind that, plus a
 * day for the "day before" of the first anchor.
 */
export function lookbackSince(current: SymptomRow, sameName: SymptomRow[]): Date {
  const oldest = Math.min(...recentEpisodes(current, sameName).map(d => d.getTime()))
  return new Date(oldest - ((BASELINE_DAYS + 1) * 24 + LOOKBACK_HOURS) * HOUR)
}

/**
 * The look-back for one logged symptom. `sameName` is every log the route
 * found for the user (other names are ignored), with or without `current`.
 */
export function symptomLookback(data: LookbackData, current: SymptomRow, sameName: SymptomRow[]): SymptomLookbackResult {
  const p = prepare(data)
  const rows = [current, ...sameName.filter(r => r.name === current.name && r.id !== current.id)]
  const skipDays = new Set(rows.map(r => localDateStr(p.tz, r.loggedAt)))
  const episodes = recentEpisodes(current, rows)
  const evaluated = episodes.map(at => evaluate(p, at, skipDays))
  return {
    ...evaluated[0].lookback,
    recurring: recurringLines(current.name, evaluated),
    episodes: episodes.length,
  }
}
