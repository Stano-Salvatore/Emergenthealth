// The menstrual cycle, from what was logged.
//
// Nothing here stores a period. A period is the run of bleeding days in the
// day log, so correcting one day corrects the period, the averages and every
// prediction together, and there is no second record to drift from the
// first. Days are the user's local days, as YYYY-MM-DD strings.
//
// What the dates mean, briefly. Day 1 is the first day of real flow — not
// spotting. Ovulation sits about two weeks BEFORE the next period: the half
// after ovulation (luteal) is the steady one, about 14 days for most people,
// while the half before it is what stretches and shrinks. So the next start
// comes from the user's own cycle length, and ovulation is counted back from it — or,
// when the ring's temperature shows the rise ovulation causes, taken from that.
//
// Every prediction is an estimate. The page says so, and none of it is a
// method of contraception.
//
// Pure, and safe in the browser: the page computes with the same functions.

import { addDaysISO } from "@/lib/local-date"

export type Flow = "none" | "spotting" | "light" | "medium" | "heavy"
export const FLOWS: Flow[] = ["none", "spotting", "light", "medium", "heavy"]

export interface CycleDayLog {
  day: string
  flow: Flow | null
  /** 0 none, 1 mild, 2 moderate, 3 severe. */
  pain?: number | null
  symptoms?: string[]
  moods?: string[]
  discharge?: string | null
  lhTest?: "positive" | "negative" | null
  note?: string | null
}

export type Contraception =
  | "none" | "copper_iud"
  | "combined_pill" | "ring" | "patch"
  | "progestin_pill" | "hormonal_iud" | "implant" | "injection"
export const CONTRACEPTION: Contraception[] = [
  "none", "combined_pill", "progestin_pill", "hormonal_iud", "copper_iud", "implant", "injection", "ring", "patch",
]

/** 21 active + 7 break, 24 + 4, or every day with no break. */
export type PackKind = "21_7" | "24_4" | "continuous"
export const PACKS: Record<PackKind, { active: number; length: number }> = {
  "21_7": { active: 21, length: 28 },
  "24_4": { active: 24, length: 28 },
  continuous: { active: 28, length: 28 },
}

export interface CycleSettings {
  enabled: boolean
  /** The user's own estimate, used until enough periods are logged to learn it. */
  cycleLength: number | null
  periodLength: number | null
  /** The last period's start as entered, standing in until one is logged. */
  lastStart: string | null
  contraception: Contraception
  /** For the pill, ring or patch: the pack and the day it started. */
  pack: { kind: PackKind; start: string } | null
  /** A push the morning the period is two days out. Off unless turned on. */
  headsUp: boolean
}

export const DEFAULT_CYCLE_SETTINGS: CycleSettings = {
  enabled: false, cycleLength: null, periodLength: null, lastStart: null,
  contraception: "none", pack: null, headsUp: false,
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const isDay = (v: unknown): v is string => typeof v === "string" && DAY_RE.test(v)
const intIn = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null

/** Tolerant: anything malformed falls back to the default rather than throwing. */
export function parseCycleSettings(raw: string | null | undefined): CycleSettings {
  let o: Record<string, unknown> = {}
  try {
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === "object") o = parsed as Record<string, unknown>
  } catch { /* defaults */ }
  const pack = o.pack as Record<string, unknown> | null | undefined
  const kind = pack && typeof pack.kind === "string" && pack.kind in PACKS ? pack.kind as PackKind : null
  return {
    enabled: o.enabled === true,
    cycleLength: intIn(o.cycleLength, 18, 60),
    periodLength: intIn(o.periodLength, 1, 12),
    lastStart: isDay(o.lastStart) ? o.lastStart : null,
    contraception: CONTRACEPTION.includes(o.contraception as Contraception) ? o.contraception as Contraception : "none",
    pack: kind && isDay(pack?.start) ? { kind, start: pack.start } : null,
    headsUp: o.headsUp === true,
  }
}

export type CycleMode = "natural" | "pack" | "hormonal"

/** What the contraception means for the cycle the page can describe. */
export function cycleMode(c: Contraception): CycleMode {
  if (c === "combined_pill" || c === "ring" || c === "patch") return "pack"
  if (c === "progestin_pill" || c === "hormonal_iud" || c === "implant" || c === "injection") return "hormonal"
  return "natural"
}

// ── Periods ─────────────────────────────────────────────────────────────────

const BLEEDING = new Set<Flow>(["light", "medium", "heavy"])
export const isBleeding = (f: Flow | null | undefined): boolean => f != null && BLEEDING.has(f)

/** Bleeding days this close together are one period: a day or two goes unlogged. */
const MERGE_GAP_DAYS = 3
/** Bleeding that starts sooner than this after a period began is not a new cycle. */
const MIN_CYCLE_DAYS = 15
/** A longer "cycle" is a stretch nothing was logged in, not a cycle. */
const MAX_CYCLE_DAYS = 60
const RECENT = 6
const DEFAULT_CYCLE = 28
const DEFAULT_PERIOD = 5
const DEFAULT_LUTEAL = 14

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000)
}

/**
 * The luteal phase is the days after ovulation up to the day before the next
 * period: in a 28-day cycle, ovulation on day 14 and days 15–28 luteal.
 */
export const lutealDays = (ovulation: string, nextStart: string): number => daysBetween(ovulation, nextStart) - 1
export const ovulationBefore = (nextStart: string, luteal: number): string => addDaysISO(nextStart, -(luteal + 1))

export interface Period { start: string; end: string; days: number }

export function periodsFrom(logs: CycleDayLog[]): { periods: Period[]; between: string[] } {
  const bleeding = logs.filter(l => isBleeding(l.flow)).map(l => l.day).sort()
  const periods: Period[] = []
  const between: string[] = []
  for (const day of bleeding) {
    const last = periods[periods.length - 1]
    if (last && daysBetween(last.end, day) <= MERGE_GAP_DAYS) {
      last.end = day
      last.days = daysBetween(last.start, day) + 1
    } else if (last && daysBetween(last.start, day) < MIN_CYCLE_DAYS) {
      between.push(day)
    } else {
      periods.push({ start: day, end: day, days: 1 })
    }
  }
  return { periods, between }
}

// ── What the cycle is like ──────────────────────────────────────────────────

export interface CycleStats {
  cycleLength: number
  /** personal: learned from 2+ logged cycles. entered: the user's own number. default: 28, knowing nothing. */
  basis: "personal" | "entered" | "default"
  /** Complete cycles logged (start to next start), gaps excluded. */
  cycles: number
  /** The recent cycle lengths the figure comes from. */
  lengths: number[]
  range: [number, number] | null
  /** Longest minus shortest of the recent cycles. */
  variesBy: number | null
  periodLength: number
  lutealLength: number
  lutealBasis: "temperature" | "typical"
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * `ovulations` maps a period's start to the ovulation the temperature showed
 * in the cycle it began, which is what makes the luteal length personal.
 */
export function cycleStats(periods: Period[], settings: CycleSettings, ovulations: Record<string, string> = {}): CycleStats {
  const lengths: number[] = []
  const luteal: number[] = []
  for (let i = 0; i + 1 < periods.length; i++) {
    const len = daysBetween(periods[i].start, periods[i + 1].start)
    if (len > MAX_CYCLE_DAYS) continue
    lengths.push(len)
    const ovu = ovulations[periods[i].start]
    if (ovu) {
      const l = lutealDays(ovu, periods[i + 1].start)
      if (l >= 8 && l <= 17) luteal.push(l)
    }
  }
  const recent = lengths.slice(-RECENT)
  let cycleLength: number
  let basis: CycleStats["basis"]
  if (recent.length >= 2) { cycleLength = Math.round(median(recent)); basis = "personal" }
  else if (settings.cycleLength) { cycleLength = settings.cycleLength; basis = "entered" }
  else if (recent.length === 1) { cycleLength = recent[0]; basis = "personal" }
  else { cycleLength = DEFAULT_CYCLE; basis = "default" }

  // The latest period may still be going, so it does not get a say in how
  // long periods last.
  const finished = periods.slice(0, -1).slice(-RECENT).map(p => p.days)
  const periodLength = finished.length > 0 ? Math.round(median(finished)) : settings.periodLength ?? DEFAULT_PERIOD

  const range: [number, number] | null = recent.length >= 2 ? [Math.min(...recent), Math.max(...recent)] : null
  return {
    cycleLength, basis, cycles: lengths.length, lengths: recent, range,
    variesBy: range ? range[1] - range[0] : null,
    periodLength,
    lutealLength: luteal.length >= 2 ? Math.round(median(luteal)) : DEFAULT_LUTEAL,
    lutealBasis: luteal.length >= 2 ? "temperature" : "typical",
  }
}

// ── Temperature ─────────────────────────────────────────────────────────────

export interface DayValue { date: string; value: number }

/** How far the three nights must sit above the six before them, on average. */
const SHIFT_MIN = 0.2

/**
 * Ovulation, read off the temperature rise it causes: the classic "three over
 * six" rule — three nights in a row each warmer than every one of the six
 * before, and clearly warmer on average. Ovulation is the day before the
 * first warm night. A missing night breaks the run; it is never filled in.
 * Searched from cycle day 7 (six nights of history) up to `until`.
 */
export function ovulationFromTemps(temps: DayValue[], cycleStart: string, until: string): string | null {
  const byDay = new Map(temps.map(t => [t.date, t.value]))
  for (let d = addDaysISO(cycleStart, 6); d <= until; d = addDaysISO(d, 1)) {
    const run = [0, 1, 2].map(k => byDay.get(addDaysISO(d, k)))
    if (run.some(v => v == null) || addDaysISO(d, 2) > until) continue
    const before = [1, 2, 3, 4, 5, 6].map(k => byDay.get(addDaysISO(d, -k))).filter((v): v is number => v != null)
    if (before.length < 4) continue
    const ceiling = Math.max(...before)
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const highs = run as number[]
    if (highs.every(v => v > ceiling) && mean(highs) - mean(before) >= SHIFT_MIN) return addDaysISO(d, -1)
  }
  return null
}

/** For each complete cycle, the ovulation its temperature showed, keyed by the cycle's start. */
export function ovulationsByCycle(periods: Period[], temps: DayValue[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (temps.length === 0) return out
  for (let i = 0; i + 1 < periods.length; i++) {
    const ovu = ovulationFromTemps(temps, periods[i].start, addDaysISO(periods[i + 1].start, -1))
    if (ovu) out[periods[i].start] = ovu
  }
  return out
}

// ── Today ───────────────────────────────────────────────────────────────────

export type Phase = "menstrual" | "follicular" | "ovulation" | "luteal"
export const PHASES: Phase[] = ["menstrual", "follicular", "ovulation", "luteal"]

export interface PackDay {
  /** Day of the pack, 1-based. */
  day: number
  length: number
  /** Taking active pills (or ring in / patch on) today. */
  active: boolean
  /** Days until the break starts; null during the break or with no break. */
  breakStartsIn: number | null
  /** The first day of the next break that has not started yet. */
  nextBreak: string | null
}

export interface CycleToday {
  day: string
  mode: CycleMode
  stats: CycleStats
  currentStart: string | null
  /** Day of the cycle, day 1 being the period's first day. */
  cycleDay: number | null
  phase: Phase | null
  /** The last five days before the period is due, and any day it is late. */
  premenstrual: boolean
  periodOngoing: boolean
  periodDay: number | null
  nextStart: string | null
  /** Where the next start probably falls, given how much the cycles vary. */
  nextWindow: [string, string] | null
  daysUntilNext: number | null
  /** Days past the predicted start with no period logged. */
  lateBy: number
  ovulation: string | null
  ovulationConfirmed: boolean
  /** The five days before ovulation and the day after: an estimate, never contraception. */
  fertile: [string, string] | null
  pack: PackDay | null
  /** Bleeding logged between periods in the current cycle. */
  betweenDays: string[]
}

export function packDay(kind: PackKind, start: string, day: string): PackDay | null {
  const p = PACKS[kind]
  const since = daysBetween(start, day)
  if (since < 0) return null
  const idx = since % p.length
  const active = idx < p.active
  const hasBreak = p.active < p.length
  const packStart = addDaysISO(day, -idx)
  const thisBreak = addDaysISO(packStart, p.active)
  const nextBreak = !hasBreak ? null : active ? thisBreak : addDaysISO(thisBreak, p.length)
  return {
    day: idx + 1,
    length: p.length,
    active,
    breakStartsIn: hasBreak && active ? p.active - idx : null,
    nextBreak,
  }
}

function phaseOn(day: string, start: string, periodDays: number, ovulation: string | null, periodOngoing: boolean): Phase {
  const cd = daysBetween(start, day)
  if (cd < periodDays && periodOngoing) return "menstrual"
  if (ovulation) {
    const toOvu = daysBetween(day, ovulation)
    if (Math.abs(toOvu) <= 1) return "ovulation"
    if (toOvu > 1) return "follicular"
  }
  return "luteal"
}

export function cycleToday(today: string, allLogs: CycleDayLog[], settings: CycleSettings, temps: DayValue[] = []): CycleToday {
  const logs = allLogs.filter(l => l.day <= today)
  const { periods, between } = periodsFrom(logs)
  const mode = cycleMode(settings.contraception)
  const stats = cycleStats(periods, settings, ovulationsByCycle(periods, temps))

  const loggedStart = periods.length > 0 ? periods[periods.length - 1].start : null
  const seed = settings.lastStart && settings.lastStart <= today ? settings.lastStart : null
  // The newest start wins: a logged period, or a later one only entered.
  const currentStart = loggedStart && (!seed || loggedStart >= seed) ? loggedStart : seed
  const fromLog = currentStart != null && currentStart === loggedStart
  const pack = mode === "pack" && settings.pack ? packDay(settings.pack.kind, settings.pack.start, today) : null

  const base: CycleToday = {
    day: today, mode, stats, currentStart, cycleDay: null, phase: null, premenstrual: false,
    periodOngoing: false, periodDay: null, nextStart: null, nextWindow: null, daysUntilNext: null,
    lateBy: 0, ovulation: null, ovulationConfirmed: false, fertile: null, pack, betweenDays: [],
  }
  if (!currentStart) return base

  const cycleDay = daysBetween(currentStart, today) + 1
  const current = fromLog ? periods[periods.length - 1] : null
  const loggedToday = logs.find(l => l.day === today)
  // Ongoing: flow logged today; or no "none" logged since the last flow and
  // still inside the usual length. A day past that with nothing logged is
  // taken as over — the next log corrects it either way.
  const lastFlowDay = current?.end ?? currentStart
  const saidNone = logs.some(l => l.flow === "none" && l.day > lastFlowDay && l.day <= today)
  const periodOngoing = isBleeding(loggedToday?.flow)
    || (!saidNone && cycleDay <= stats.periodLength && daysBetween(lastFlowDay, today) <= MERGE_GAP_DAYS)
  const betweenDays = between.filter(d => d >= currentStart)

  if (mode === "pack") {
    return { ...base, cycleDay, periodOngoing, periodDay: periodOngoing ? cycleDay : null, betweenDays }
  }

  // Under hormonal contraception ovulation may not happen at all, so neither
  // ovulation nor a fertile window is drawn — only the bleeding pattern.
  const natural = mode === "natural"
  const confirmed = natural ? ovulationFromTemps(temps, currentStart, today) : null
  const forecastFromCycle = mode === "hormonal" && stats.basis !== "personal" ? null : addDaysISO(currentStart, stats.cycleLength)
  const nextStart = confirmed ? addDaysISO(confirmed, stats.lutealLength + 1) : forecastFromCycle
  const spread = stats.range ? Math.max(1, Math.ceil((stats.range[1] - stats.range[0]) / 2)) : 3
  const ovulation = !natural ? null : confirmed ?? (nextStart ? ovulationBefore(nextStart, stats.lutealLength) : null)
  const untilNext = nextStart ? daysBetween(today, nextStart) : null
  const lateBy = untilNext != null && untilNext < 0 && !periodOngoing ? -untilNext : 0
  const phase = natural ? phaseOn(today, currentStart, Math.max(cycleDay, 1), ovulation, periodOngoing)
    : periodOngoing ? "menstrual" : null

  return {
    ...base,
    cycleDay,
    phase,
    premenstrual: phase === "luteal" && untilNext != null && untilNext <= 5,
    periodOngoing,
    periodDay: periodOngoing ? cycleDay : null,
    nextStart,
    nextWindow: nextStart ? [addDaysISO(nextStart, -spread), addDaysISO(nextStart, spread)] : null,
    daysUntilNext: untilNext == null ? null : Math.max(0, untilNext),
    lateBy,
    ovulation,
    ovulationConfirmed: confirmed != null,
    fertile: ovulation ? [addDaysISO(ovulation, -5), addDaysISO(ovulation, 1)] : null,
    betweenDays,
  }
}

// ── The calendar ────────────────────────────────────────────────────────────

export type DayMark = "period" | "spotting" | "between" | "predicted" | "fertile" | "ovulation" | "break"

/**
 * What each date shows. Logged days show what was logged; predictions are
 * drawn only forward from today (and the current cycle's own ovulation
 * estimate), never painted over days that already happened.
 */
export function dayMarks(dates: string[], logs: CycleDayLog[], t: CycleToday, settings: CycleSettings): Record<string, DayMark> {
  const byDay = new Map(logs.map(l => [l.day, l]))
  const between = new Set(t.betweenDays)
  const out: Record<string, DayMark> = {}
  const { cycleLength, periodLength, lutealLength } = t.stats

  const predicted = new Set<string>()
  const ovulations = new Set<string>()
  const fertile = new Set<string>()
  if (t.periodOngoing && t.currentStart) {
    for (let i = 0; i < periodLength; i++) predicted.add(addDaysISO(t.currentStart, i))
  }
  if (t.nextStart) {
    const starts = [0, 1, 2, 3].map(k => addDaysISO(t.nextStart!, k * cycleLength))
    for (const s of starts.slice(0, 3)) for (let i = 0; i < periodLength; i++) predicted.add(addDaysISO(s, i))
    if (t.mode === "natural") {
      const ovus = [t.ovulation, ...starts.slice(1).map(s => ovulationBefore(s, lutealLength))].filter((d): d is string => d != null)
      for (const o of ovus) {
        ovulations.add(o)
        for (let i = -5; i <= 1; i++) fertile.add(addDaysISO(o, i))
      }
    }
  }
  const breaks = new Set<string>()
  if (t.mode === "pack" && settings.pack) {
    const p = PACKS[settings.pack.kind]
    for (const d of dates) {
      const pd = packDay(settings.pack.kind, settings.pack.start, d)
      if (pd && !pd.active && p.active < p.length) breaks.add(d)
    }
  }

  for (const d of dates) {
    const l = byDay.get(d)
    if (l && isBleeding(l.flow)) { out[d] = between.has(d) ? "between" : "period"; continue }
    if (l?.flow === "spotting") { out[d] = "spotting"; continue }
    if (d <= t.day && !(t.currentStart && d >= t.currentStart && (ovulations.has(d) || fertile.has(d)))) {
      if (breaks.has(d)) out[d] = "break"
      continue
    }
    if (ovulations.has(d)) out[d] = "ovulation"
    else if (d > t.day && predicted.has(d)) out[d] = "predicted"
    else if (breaks.has(d)) out[d] = "break"
    else if (fertile.has(d)) out[d] = "fertile"
  }
  return out
}

// ── Phases in the user's own data ──────────────────────────────────────────────

/** What the phase averages read, in the order the page shows them. */
export const AVERAGE_METRICS: { key: string; label: string; unit: string; decimals: number }[] = [
  { key: "sleepScore", label: "Sleep score", unit: "", decimals: 0 },
  { key: "hrv", label: "HRV", unit: " ms", decimals: 0 },
  { key: "restingHR", label: "Resting heart rate", unit: " bpm", decimals: 0 },
  { key: "readinessScore", label: "Readiness", unit: "", decimals: 0 },
  { key: "mood", label: "Mood", unit: "/5", decimals: 1 },
  { key: "energy", label: "Morning energy", unit: "/5", decimals: 1 },
]

export interface PhaseAverages {
  /** Complete cycles with readings in them — logged cycles without data do not count. */
  cycles: number
  byPhase: Record<Phase, Record<string, { mean: number; n: number }>>
}

const MIN_DAYS_PER_PHASE = 5
const MIN_CYCLES = 2

/**
 * Each metric's average in each phase, over complete cycles of an ordinary
 * length. Said only with two cycles or more and five days in the phase —
 * one cycle is an anecdote.
 */
export function phaseAverages(
  periods: Period[],
  series: Record<string, DayValue[]>,
  settings: CycleSettings,
  temps: DayValue[] = [],
): PhaseAverages {
  const byPhase = { menstrual: {}, follicular: {}, ovulation: {}, luteal: {} } as PhaseAverages["byPhase"]
  const ovulations = ovulationsByCycle(periods, temps)
  const { lutealLength } = cycleStats(periods, settings, ovulations)
  const sums: Record<string, Record<string, { sum: number; n: number }>> = {}
  const maps = Object.fromEntries(Object.entries(series).map(([k, v]) => [k, new Map(v.map(x => [x.date, x.value]))]))
  // Per metric, the cycles it has readings in: three logged cycles with ring
  // data in only one of them is one cycle of evidence, not three.
  const cyclesWith: Record<string, number> = {}
  let cycles = 0
  for (let i = 0; i + 1 < periods.length; i++) {
    const start = periods[i].start
    const next = periods[i + 1].start
    const len = daysBetween(start, next)
    if (len < 21 || len > 45) continue
    const ovu = ovulations[start] ?? ovulationBefore(next, lutealLength)
    const seen = new Set<string>()
    for (let k = 0; k < len; k++) {
      const d = addDaysISO(start, k)
      const phase = phaseOn(d, start, periods[i].days, ovu, true)
      for (const [metric, m] of Object.entries(maps)) {
        const v = m.get(d)
        if (v == null) continue
        seen.add(metric)
        const cell = ((sums[phase] ??= {})[metric] ??= { sum: 0, n: 0 })
        cell.sum += v
        cell.n++
      }
    }
    if (seen.size > 0) cycles++
    for (const metric of seen) cyclesWith[metric] = (cyclesWith[metric] ?? 0) + 1
  }
  for (const phase of PHASES) {
    for (const [metric, c] of Object.entries(sums[phase] ?? {})) {
      if (c.n >= MIN_DAYS_PER_PHASE && (cyclesWith[metric] ?? 0) >= MIN_CYCLES) {
        byPhase[phase][metric] = { mean: Math.round((c.sum / c.n) * 10) / 10, n: c.n }
      }
    }
  }
  return { cycles, byPhase }
}
