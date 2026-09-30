import { addDaysISO, localDateStr, localTimeStr } from "@/lib/local-date"
import type { RefKind } from "@/lib/log-refs"

// Reading back what the user logged, and describing one entry of it.
//
// Emergy could write a meal, a blood pressure reading, a tracker value and a
// symptom, then never see any of them again. What he says about them has to
// come from the rows — so this turns rows into the compact text the model
// reads, and the queries stay in claude.ts.
//
// Two rules shape every function here. Days are the user's local days: a
// slice of toast at 00:30 in Bratislava belongs to that date, not to the UTC
// one before it. And absent is not zero: a day with nothing logged is said to
// have nothing logged, never totalled as 0 kcal, and averages are over the
// days that have entries, saying so.

export const LOG_KINDS = ["food", "bp", "metric", "symptom"] as const
export type LogKind = (typeof LOG_KINDS)[number]

export function isLogKind(v: string): v is LogKind {
  return (LOG_KINDS as readonly string[]).includes(v)
}

/** Three months: enough for "this quarter", small enough to fit in a turn. */
export const MAX_RANGE_DAYS = 92

/** Rows fetched per read; one more than this means the answer is partial. */
export const LOG_ROW_CAP = 400

export interface LogRange { from: string; to: string }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function validDay(s: string): boolean {
  if (!ISO_DAY.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s
}

/**
 * The local days a read covers. Nothing given = the last seven days; a bare
 * `from` runs to today. A date that doesn't parse is refused rather than
 * replaced with a guess, because a guessed range reads back as a real answer.
 */
export function resolveLogRange(
  today: string, from?: string, to?: string,
): (LogRange & { clipped: boolean }) | { error: string } {
  const f = from?.trim() || ""
  const t = to?.trim() || ""
  for (const d of [f, t]) {
    if (d && !validDay(d)) return { error: `I couldn't read "${d}" as a date. Use YYYY-MM-DD in the user's local time.` }
  }
  let end = t || today
  let start = f || addDaysISO(end, -6)
  if (start > end) [start, end] = [end, start]
  const earliest = addDaysISO(end, -(MAX_RANGE_DAYS - 1))
  const clipped = start < earliest
  return { from: clipped ? earliest : start, to: end, clipped }
}

/**
 * A `@db.Date` column as the day it names. Prisma returns those at UTC
 * midnight of the stored date, so the ISO slice is exact here — unlike on a
 * timestamp, where it would give the UTC day.
 */
export function dateColumnDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysIn(range: LogRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1
}

const NUM = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 })
const n = (v: number) => NUM.format(v)

// A YYYY-MM-DD is already the user's date; formatting it in UTC keeps it so.
// Assembled from parts because en-GB's short September is "Sept" on newer ICU
// and "Sep" on older, and the text should not depend on the runtime.
const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
export function dayLabel(iso: string): string {
  const p = Object.fromEntries(DAY_FMT.formatToParts(new Date(`${iso}T00:00:00Z`)).map(x => [x.type, x.value]))
  return `${p.weekday} ${p.day} ${p.month}`
}

function rangeLabel(range: LogRange): string {
  return range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`
}

function stamp(at: Date, tz: string): string {
  return `${dayLabel(localDateStr(tz, at))} ${localTimeStr(tz, at)}`
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = out.get(k)
    if (list) list.push(r)
    else out.set(k, [r])
  }
  return out
}

// ── Food ────────────────────────────────────────────────────────────────────

export interface FoodRow { name: string; calories: number; mealType: string; loggedAt: Date }

export function describeFood(r: FoodRow, tz: string): string {
  return `${r.name} ≈${n(r.calories)} kcal (${r.mealType}) logged at ${stamp(r.loggedAt, tz)}`
}

export function formatFoodLog(rows: FoodRow[], tz: string, range: LogRange): string {
  if (rows.length === 0) return `No food logged ${range.from === range.to ? "on" : "between"} ${rangeLabel(range).replace(" – ", " and ")}.`
  const sorted = [...rows].sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime())
  const byDay = groupBy(sorted, r => localDateStr(tz, r.loggedAt))
  const lines = [`Food, ${rangeLabel(range)} (user's local days, kcal are estimates):`]
  let total = 0
  for (const [day, meals] of byDay) {
    const kcal = meals.reduce((s, m) => s + m.calories, 0)
    total += kcal
    lines.push(`${dayLabel(day)} — ${n(kcal)} kcal: ${meals.map(m => `${localTimeStr(tz, m.loggedAt)} ${m.name} ${n(m.calories)}`).join(" · ")}`)
  }
  const span = daysIn(range)
  const empty = span - byDay.size
  if (empty > 0) lines.push(`Nothing logged on ${empty} of ${span} days — unknown, not zero.`)
  if (byDay.size > 1) lines.push(`Average ${n(Math.round(total / byDay.size))} kcal over the ${byDay.size} days with food logged.`)
  return lines.join("\n")
}

/**
 * A corrected kcal figure for a meal whose macros were estimated alongside the
 * old one: they described the old portion, so they move with it. Unknown
 * stays unknown — a null macro is not scaled into a zero.
 */
export function scaleFoodMacros(
  prev: { calories: number; proteinG: number | null; carbsG: number | null; fatG: number | null; sugarG: number | null },
  calories: number,
): Partial<Record<"proteinG" | "carbsG" | "fatG" | "sugarG", number | null>> {
  if (!(prev.calories > 0)) return {}
  const k = calories / prev.calories
  const s = (v: number | null) => (v == null ? null : Math.round(v * k * 10) / 10)
  return { proteinG: s(prev.proteinG), carbsG: s(prev.carbsG), fatG: s(prev.fatG), sugarG: s(prev.sugarG) }
}

// ── Blood pressure ──────────────────────────────────────────────────────────

export interface BpRow { systolic: number; diastolic: number; pulse: number | null; notes: string | null; loggedAt: Date }

function bpReading(r: BpRow): string {
  return `${r.systolic}/${r.diastolic}${r.pulse ? `, pulse ${r.pulse}` : ""}${r.notes ? ` (${r.notes})` : ""}`
}

export function describeBp(r: BpRow, tz: string): string {
  return `blood pressure ${bpReading(r)} at ${stamp(r.loggedAt, tz)}`
}

export function formatBpLog(rows: BpRow[], tz: string, range: LogRange): string {
  if (rows.length === 0) return `No blood pressure readings logged in ${rangeLabel(range)}.`
  const sorted = [...rows].sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime())
  const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`
  const lines = [`Blood pressure, ${rangeLabel(range)} — ${plural(sorted.length, "reading")} (mmHg, user's local time):`]
  for (const r of sorted) lines.push(`${stamp(r.loggedAt, tz)} — ${bpReading(r)}`)
  const avg = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) / xs.length)
  const pulses = sorted.map(r => r.pulse).filter((p): p is number => p != null && p > 0)
  lines.push(
    `Average ${avg(sorted.map(r => r.systolic))}/${avg(sorted.map(r => r.diastolic))} over ${plural(sorted.length, "reading")}` +
    (pulses.length ? `; pulse ${avg(pulses)} (${plural(pulses.length, "reading")} with pulse).` : "."),
  )
  return lines.join("\n")
}

// ── Custom metrics ──────────────────────────────────────────────────────────

export interface MetricDef { id: string; name: string; emoji: string; unit: string | null; type: string }
export interface MetricLogRow { metricId: string; date: string; value: number; note: string | null }

/** Exact name first, else every tracker whose name contains the query. */
export function matchMetrics<M extends { name: string }>(metrics: M[], q: string): M[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return metrics
  const exact = metrics.filter(m => m.name.toLowerCase() === needle)
  return exact.length ? exact : metrics.filter(m => m.name.toLowerCase().includes(needle))
}

function metricValue(m: Pick<MetricDef, "type" | "unit">, v: number): string {
  if (m.type === "boolean") return v >= 1 ? "yes" : "no"
  return `${n(v)}${m.unit ?? ""}`
}

export function describeMetricLog(m: Omit<MetricDef, "id">, date: string, value: number, note: string | null): string {
  return `${m.emoji} ${m.name} = ${metricValue(m, value)} on ${dayLabel(date)}${note ? ` (${note})` : ""}`
}

export function formatMetricLog(metrics: MetricDef[], logs: MetricLogRow[], range: LogRange): string {
  const byMetric = groupBy([...logs].sort((a, b) => a.date.localeCompare(b.date)), l => l.metricId)
  const lines = [`Trackers, ${rangeLabel(range)} (days without a value are unknown, not zero):`]
  for (const m of metrics) {
    const own = byMetric.get(m.id) ?? []
    if (own.length === 0) { lines.push(`${m.emoji} ${m.name}: nothing logged.`); continue }
    const values = own.map(l => `${dayLabel(l.date)} ${metricValue(m, l.value)}${l.note ? ` (${l.note})` : ""}`).join(" · ")
    let summary: string
    if (m.type === "boolean") {
      summary = `yes on ${own.filter(l => l.value >= 1).length} of ${own.length} logged days`
    } else {
      const vs = own.map(l => l.value)
      const avg = Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 10) / 10
      summary = `${own.length} day${own.length === 1 ? "" : "s"} logged, average ${metricValue(m, avg)}` +
        (own.length > 1 ? `, range ${n(Math.min(...vs))}–${n(Math.max(...vs))}` : "")
    }
    lines.push(`${m.emoji} ${m.name}: ${values} — ${summary}.`)
  }
  return lines.join("\n")
}

// ── Symptoms ────────────────────────────────────────────────────────────────

export interface SymptomRow { name: string; severity: number; note: string | null; day: string }

export function describeSymptom(r: SymptomRow): string {
  return `${r.name} ${r.severity}/5 on ${dayLabel(r.day)}${r.note ? ` (${r.note})` : ""}`
}

export function formatSymptomLog(rows: SymptomRow[], range: LogRange): string {
  if (rows.length === 0) return `No symptoms logged in ${rangeLabel(range)}.`
  const byDay = groupBy([...rows].sort((a, b) => b.day.localeCompare(a.day)), r => r.day)
  const lines = [`Symptoms, ${rangeLabel(range)} (severity 1–5):`]
  for (const [day, list] of byDay) {
    lines.push(`${dayLabel(day)} — ${list.map(r => `${r.name} ${r.severity}/5${r.note ? ` (${r.note})` : ""}`).join(" · ")}`)
  }
  const byName = groupBy(rows, r => r.name.toLowerCase())
  lines.push(`Across the period: ${[...byName.values()].map(list => {
    const days = new Set(list.map(r => r.day)).size
    return `${list[0].name} on ${days} day${days === 1 ? "" : "s"}, worst ${Math.max(...list.map(r => r.severity))}/5`
  }).join("; ")}.`)
  return lines.join("\n")
}

// ── Corrections ─────────────────────────────────────────────────────────────

export interface CorrectionInput {
  at: boolean
  amount: number | null
  label: string
  systolic: number | null
  diastolic: number | null
}

/** Which correct_log fields each kind has somewhere to put. */
const FIELDS: Record<RefKind, readonly (keyof CorrectionInput)[]> = {
  dose: ["at", "amount"],
  intake: ["at", "amount"],
  moment: ["at", "label"],
  food: ["at", "amount", "label"],
  bp: ["at", "systolic", "diastolic"],
  metric: ["at", "amount"],
  symptom: ["at", "amount", "label"],
}

const FIELD_WORDS: Record<keyof CorrectionInput, string> = {
  at: "time", amount: "amount", label: "label", systolic: "systolic", diastolic: "diastolic",
}

const orList = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`

const given = (c: CorrectionInput, f: keyof CorrectionInput) =>
  f === "at" ? c.at : f === "label" ? c.label.trim() !== "" : c[f] != null

/**
 * Why a correction can't be applied to this kind, or null when it can. A field
 * the kind has no column for is refused rather than dropped, since "Changed"
 * over an edit that was silently ignored tells the user something untrue.
 */
export function correctionProblem(kind: RefKind, c: CorrectionInput): string | null {
  const allowed = FIELDS[kind]
  const stray = (Object.keys(FIELD_WORDS) as (keyof CorrectionInput)[]).filter(f => given(c, f) && !allowed.includes(f))
  const takes = orList(allowed.map(f => FIELD_WORDS[f]))
  if (kind === "bp" && c.amount != null) return "A blood pressure takes systolic and diastolic, not an amount. Nothing was changed."
  if (stray.length) return `A ${kind} entry has no ${orList(stray.map(f => FIELD_WORDS[f]))} to change — it takes ${takes}. Nothing was changed.`
  if (!allowed.some(f => given(c, f))) return `Nothing to change — a ${kind} entry takes ${takes}.`
  const a = c.amount
  if (a != null) {
    if (!Number.isFinite(a)) return "An amount needs to be a number."
    if ((kind === "dose" || kind === "intake") && a <= 0) return "An amount needs to be a positive number."
    if (kind === "food" && (a < 0 || a > 10_000)) return "Calories need to be between 0 and 10,000."
    if (kind === "symptom" && !(Number.isInteger(a) && a >= 1 && a <= 5)) return "Severity is a whole number from 1 to 5."
  }
  if (c.systolic != null && !(c.systolic >= 60 && c.systolic <= 260)) return "That systolic is outside 60–260 mmHg — check the reading."
  if (c.diastolic != null && !(c.diastolic >= 30 && c.diastolic <= 160)) return "That diastolic is outside 30–160 mmHg — check the reading."
  return null
}
