import { parseInsightsCache } from "@/lib/insights-cache"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"
import { format } from "date-fns"
import { addDaysISO, localDateStr } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { adherenceOver, matchKey, sortedTimes, toDose, type DoseRow, type ScheduleLike } from "@/lib/med-schedule"
import { formatDose, sumDoses, type ParsedDose } from "@/lib/dose"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { supplementInfoFor } from "@/lib/supplement-info"
import { normalizeSupplement } from "@/lib/supplement-normalize"
import { loadWeightSeries } from "@/lib/weight-series"
import { RING_OFF_MAX_STEPS } from "@/lib/sleep-quality"
import { convertLabValue, normalizeUnit } from "@/lib/lab-units"
import { referenceChangeValue } from "@/lib/lab-variation"
import { rangeStatus } from "@/lib/lab-trends"
import { labValueText, parseLabFlag, parseLabQualifier, type LabQualifier } from "@/lib/lab-flags"
import { OPUS } from "@/lib/models"
import { recordModelTurn } from "@/lib/model-spend"

// The clinical summary. Everything else this app produces is written for the
// person living the data; this one is written for the fifteen minutes they get
// with a doctor. JSON and CSV exports are perfect for a script and useless
// across a desk.
//
// Two deliberate constraints:
//  - The narrative does NOT use Emergy's chat persona. A warm second-person
//    coach voice is wrong in a document a clinician reads; this prompt is
//    sober, third-person, factual, and forbidden from diagnosing or advising.
//  - Nothing is inferred that the data doesn't support. Coverage is printed
//    beside every number, so a 4-day average can never pass for a 90-day one.

export type MetricSummary = {
  key: string
  label: string
  unit: string
  avg: number | null
  /** Null when the previous period has too few readings to stand beside this one. */
  prevAvg: number | null
  /** Days with a reading in the previous period, so a thin baseline says so. */
  prevDays: number
  min: number | null
  max: number | null
  days: number      // days with a reading
  /** Days left out as the device not being worn (steps under RING_OFF_MAX_STEPS). */
  excludedDays?: number
  decimals: number
  higherIsBetter: boolean
}

export type MedSummary = {
  name: string
  dose: string | null
  times: string[]
  daysOfWeek: number[]
  note: string | null
  expectedDoses: number
  loggedDoses: number
  /** The user-local day (YYYY-MM-DD) of the most recent recorded dose. */
  lastTaken: string | null
  /** Typical recorded amount, e.g. "12.5mg" or "½ tablet"; null when never stated. */
  typicalDose: string | null
  /** The schedule is switched off but doses were still recorded in the period. */
  stopped?: true
}

/** A medicine or supplement taken in the period with no schedule behind it. */
export type OtherDoseSummary = {
  name: string
  count: number
  /** Distinct days it was taken. */
  days: number
  typicalDose: string | null
  lastTaken: string
}

export type SymptomSummary = {
  name: string
  occurrences: number
  avgSeverity: number
  worstSeverity: number
  lastSeen: string
}

export type LabSummary = {
  marker: string
  value: number
  unit: string
  referenceMin: number | null
  referenceMax: number | null
  date: string
  flag: "low" | "high" | "normal" | "unknown"
  /** Printed as "< 5" or "> 90": `value` is the limit. */
  qualifier?: LabQualifier | null
  /**
   * The reading before this one, so a clinician sees direction, not a dot.
   * Direction is judged in the latest reading's unit and against the marker's
   * own biological variation: 200 mg/dL then 5.2 mmol/L is flat, not a 97%
   * fall, and a 2% ferritin move is noise.
   */
  previous: {
    value: number
    unit: string
    date: string
    qualifier?: LabQualifier | null
    /** The previous value in the latest reading's unit; null when the units cannot be converted. */
    valueInLatestUnit: number | null
    /** Null when the two readings cannot be compared, or either was printed as a limit. */
    direction: "up" | "down" | "flat" | null
    unitMismatch: boolean
  } | null
}

export type BloodPressureSummary = {
  readings: number
  avgSystolic: number
  avgDiastolic: number
  maxSystolic: number
  maxDiastolic: number
  avgPulse: number | null
  last: { systolic: number; diastolic: number; date: string }
  /** ESC/ESH office-BP bands, on self-measured readings — a flag to discuss, never a diagnosis. */
  band: "optimal" | "normal" | "high-normal" | "grade 1" | "grade 2" | "grade 3"
}

export type HealthReport = {
  generatedAt: string
  periodDays: number
  from: string
  to: string
  user: { name: string | null; email: string | null }
  coverage: { daysWithWearable: number; longestGapDays: number }
  metrics: MetricSummary[]
  meds: MedSummary[]
  /** Doses of things with no schedule — as-needed medicines, one-offs, supplements. */
  otherDoses: OtherDoseSummary[]
  symptoms: SymptomSummary[]
  labs: LabSummary[]
  bloodPressure: BloodPressureSummary | null
  body: { weightKg: number | null; prevWeightKg: number | null; bodyFatPct: number | null; bodyFatDate: string | null; date: string | null }
  /** Weight across the reporting period itself, from whichever source recorded it. */
  weightTrend: { first: number; last: number; changeKg: number; readings: number; firstDate: string; lastDate: string } | null
  patterns: {
    finding: string
    confidence: "solid" | "tentative"
    /** Why the comparison may not be what it looks like, as the engine said it. */
    confounded?: string
    coverage?: string
    days?: { with: number; without: number }
  }[]
  /** The day the associations were computed; they cover the 90 days before it, not the report period. */
  patternsAsOf: string | null
  narrative: string
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

function round(n: number | null, decimals: number): number | null {
  if (n == null) return null
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/** Longest run of consecutive days with no wearable reading inside the window. */
function longestGap(daysInWindow: string[], present: Set<string>): number {
  let worst = 0
  let run = 0
  for (const d of daysInWindow) {
    if (present.has(d)) { run = 0 } else { run++; if (run > worst) worst = run }
  }
  return worst
}

const CLINICAL_SYSTEM = `You are preparing the summary section of a personal health-tracking report that a patient will bring to a medical appointment.

Write 2-3 short paragraphs of plain, factual prose in the third person ("the patient", or use their first name). Rules, all mandatory:
- State what the data shows and how much data it rests on. If coverage is partial, say so in the same sentence as the number.
- Do NOT diagnose, do NOT suggest treatment, do NOT recommend supplements, medications, or dose changes, and do NOT tell the patient or clinician what to do.
- Do not speculate about causes. Correlations from the app may be mentioned only as observed associations, never as causes.
- No greetings, no headings, no bullet points, no markdown, no closing pleasantries.
- If something in the data is notable enough that a clinician would want to see it (a marked change, an out-of-range lab, a frequently recorded symptom), point at it neutrally and let them interpret it.
- Prefer specific numbers over adjectives. Under 220 words.`

export async function buildHealthReport(userId: string, periodDays = 90): Promise<HealthReport> {
  const days = Math.min(365, Math.max(7, Math.round(periodDays)))
  const tz = await getUserTimezone(userId)
  const reportDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz })
  const toStr = localDateStr(tz)
  const fromStr = addDaysISO(toStr, -(days - 1))
  const prevFromStr = addDaysISO(fromStr, -days)
  const from = new Date(fromStr + "T00:00:00Z")
  const to = new Date(toStr + "T23:59:59Z")
  const prevFrom = new Date(prevFromStr + "T00:00:00Z")
  const prevTo = new Date(addDaysISO(fromStr, -1) + "T23:59:59Z")

  const [user, logs, prevLogs, medSchedules, doseRows, symptomRows, labRows, bodyRows, insightRow, bpRows, weightSeries] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }).catch(() => null),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      select: {
        date: true, sleepDuration: true, sleepScore: true, sleepEfficiency: true, steps: true,
        restingHR: true, hrv: true, readinessScore: true, spo2: true, breathingRate: true, stressHigh: true,
      },
    }).catch(() => []),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: prevFrom, lte: prevTo } },
      select: {
        sleepDuration: true, sleepScore: true, sleepEfficiency: true, steps: true,
        restingHR: true, hrv: true, readinessScore: true, spo2: true, breathingRate: true, stressHigh: true,
      },
    }).catch(() => []),
    // Stopped schedules too: one paused last week still had a week of doses.
    prisma.medSchedule.findMany({ where: { userId } }).catch(() => []),
    // Doses actually recorded — Oura tags and manual logs share this table.
    prisma.$queryRaw<(DoseRow & { doseAmount: number | null; doseUnit: string | null })[]>`
      SELECT "id", "tagName", "text", "day", "timestamp", "doseAmount", "doseUnit" FROM "OuraTag"
      WHERE "userId" = ${userId} AND "day" >= ${fromStr} AND "day" <= ${toStr}
    `.catch(() => [] as (DoseRow & { doseAmount: number | null; doseUnit: string | null })[]),
    prisma.symptomLog.findMany({
      where: { userId, day: { gte: fromStr, lte: toStr } },
      select: { name: true, severity: true, day: true },
    }).catch(() => [] as { name: string; severity: number; day: string }[]),
    prisma.labResult.findMany({
      where: { userId }, orderBy: { date: "desc" }, take: 200,
    }).catch(() => []),
    prisma.bodyMeasurement.findMany({
      where: { userId }, orderBy: { date: "desc" }, take: 60,
    }).catch(() => []),
    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "insights_cache:overall" } },
      select: { value: true },
    }).catch(() => null),

    // Blood pressure lives in a raw-DDL table with no Prisma model. It is the
    // single most clinically actionable thing this app records, and the report
    // was leaving it out entirely.
    prisma.$queryRaw<{ systolic: number; diastolic: number; pulse: number | null; loggedAt: Date }[]>`
      SELECT "systolic", "diastolic", "pulse", "loggedAt" FROM "BloodPressureLog"
      WHERE "userId" = ${userId} AND "loggedAt" >= ${from} AND "loggedAt" <= ${to}
      ORDER BY "loggedAt" ASC
    `.catch(() => [] as { systolic: number; diastolic: number; pulse: number | null; loggedAt: Date }[]),

    // Weight arrives through chat and the quick box (HealthLog.weight) far more
    // often than through the Body page; reading only the latter showed a
    // doctor a six-month-old figure. 365 days covers the longest period.
    loadWeightSeries(userId, 365).catch(() => []),
  ])

  // ── Vitals ────────────────────────────────────────────────────────────────
  type Row = (typeof logs)[number]
  // partialToday: the metric accumulates through the day, so today's row is a
  // morning's worth and would drag the mean and the minimum down.
  const SPECS: { key: string; label: string; unit: string; decimals: number; higherIsBetter: boolean; partialToday?: boolean; pick: (l: Row) => number | null }[] = [
    { key: "sleep", label: "Sleep duration", unit: "h", decimals: 1, higherIsBetter: true, pick: l => l.sleepDuration != null ? l.sleepDuration / 60 : null },
    { key: "sleepScore", label: "Sleep score", unit: "/100", decimals: 0, higherIsBetter: true, pick: l => l.sleepScore },
    { key: "sleepEff", label: "Sleep efficiency", unit: "%", decimals: 0, higherIsBetter: true, pick: l => l.sleepEfficiency },
    { key: "rhr", label: "Resting heart rate", unit: "bpm", decimals: 0, higherIsBetter: false, pick: l => l.restingHR },
    { key: "hrv", label: "Heart-rate variability", unit: "ms", decimals: 0, higherIsBetter: true, pick: l => l.hrv },
    { key: "readiness", label: "Readiness score", unit: "/100", decimals: 0, higherIsBetter: true, pick: l => l.readinessScore },
    { key: "spo2", label: "Blood oxygen (SpO₂)", unit: "%", decimals: 1, higherIsBetter: true, pick: l => (l.spo2 && l.spo2 > 0 ? l.spo2 : null) },
    { key: "breathing", label: "Breathing rate", unit: "/min", decimals: 1, higherIsBetter: false, pick: l => l.breathingRate },
    // A day under RING_OFF_MAX_STEPS is a ring in a drawer, not a person; it
    // is left out and counted, never averaged in as a real day.
    { key: "steps", label: "Steps", unit: "/day", decimals: 0, higherIsBetter: true, partialToday: true, pick: l => (l.steps != null && l.steps >= RING_OFF_MAX_STEPS ? l.steps : null) },
    { key: "stress", label: "Elevated-stress time", unit: "min/day", decimals: 0, higherIsBetter: false, partialToday: true, pick: l => l.stressHigh },
  ]

  // A previous-period mean over a handful of days beside a full one reads as a
  // change the data cannot carry.
  const prevFloor = Math.max(7, Math.ceil(days / 3))
  const metrics: MetricSummary[] = SPECS.map(s => {
    const rows = s.partialToday ? logs.filter(l => l.date.toISOString().slice(0, 10) !== toStr) : logs
    const vals = rows.map(s.pick).filter((v): v is number => v != null)
    const prevVals = prevLogs.map(s.pick as (l: (typeof prevLogs)[number]) => number | null).filter((v): v is number => v != null)
    const excluded = s.key === "steps"
      ? rows.filter(l => l.steps != null && l.steps < RING_OFF_MAX_STEPS).length
      : 0
    return {
      key: s.key, label: s.label, unit: s.unit, decimals: s.decimals, higherIsBetter: s.higherIsBetter,
      avg: round(mean(vals), s.decimals),
      prevAvg: prevVals.length >= prevFloor ? round(mean(prevVals), s.decimals) : null,
      prevDays: prevVals.length,
      min: vals.length ? round(Math.min(...vals), s.decimals) : null,
      max: vals.length ? round(Math.max(...vals), s.decimals) : null,
      days: vals.length,
      ...(excluded > 0 ? { excludedDays: excluded } : {}),
    }
  }).filter(m => m.days > 0)

  // ── Coverage ──────────────────────────────────────────────────────────────
  const windowDays: string[] = []
  for (let i = 0; i < days; i++) windowDays.push(addDaysISO(fromStr, i))
  // Health Connect writes a row with phone steps every day the app is open,
  // so a row alone is not a day the ring was worn. Steps are not counted for
  // the same reason.
  const wearableDay = (l: Row) =>
    l.sleepDuration != null || l.sleepScore != null || l.sleepEfficiency != null ||
    l.restingHR != null || l.hrv != null || l.readinessScore != null ||
    (l.spo2 != null && l.spo2 > 0) || l.breathingRate != null || l.stressHigh != null
  const present = new Set(logs.filter(wearableDay).map(l => l.date.toISOString().slice(0, 10)))
  const coverage = { daysWithWearable: present.size, longestGapDays: longestGap(windowDays, present) }

  // ── Medications ───────────────────────────────────────────────────────────
  // Adherence counts doses recorded in the app (manual entries and Oura tags)
  // against the schedule. It is a floor, not a measurement: a dose taken and
  // never logged is invisible here, which the report states in plain words.
  //
  // Matching and the per-time cap are the Medications page's own
  // (matchKey/adherenceOver), so the report and the app never disagree, and
  // today is left out because its later doses have not happened yet.
  const doseList = doseRows.flatMap(r => {
    const d = toDose(r, tz)
    return d ? [{ ...d, row: r }] : []
  })
  const completeDays = windowDays.filter(d => d !== toStr)
  const shaped: ScheduleLike[] = medSchedules.map(m => ({
    id: m.id, name: m.name, times: m.times, daysOfWeek: m.daysOfWeek,
    active: m.active, startDate: m.startDate, endDate: m.endDate,
  }))
  const adherence = new Map(adherenceOver(shaped, doseList, completeDays).map(a => [a.scheduleId, a]))

  type DoseRec = (typeof doseRows)[number]
  const lastOf = (hits: DoseRec[]) => hits.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)).day
  // The mean of what was actually recorded, in whichever unit was used.
  // Milligrams and tablet fractions are never mixed into one number.
  const typicalOf = (hits: DoseRec[]): string | null => {
    const doses: ParsedDose[] = hits
      .filter(h => h.doseAmount != null && (h.doseUnit === "mg" || h.doseUnit === "tablet"))
      .map(h => ({ amount: h.doseAmount as number, unit: h.doseUnit as ParsedDose["unit"] }))
    const totals = sumDoses(doses)
    const mgCount = doses.filter(d => d.unit === "mg").length
    const tabCount = doses.length - mgCount
    return totals.mg != null && mgCount > 0 ? formatDose(totals.mg / mgCount, "mg")
      : totals.tablets != null && tabCount > 0 ? formatDose(totals.tablets / tabCount, "tablet")
      : null
  }

  const meds: MedSummary[] = medSchedules.flatMap((m, i) => {
    const key = matchKey(m.name)
    const hits = doseList.filter(d => matchKey(d.name) === key).map(d => d.row)
    // A stopped schedule matters only for the doses it still had.
    if (!m.active && hits.length === 0) return []
    const adh = adherence.get(m.id)
    // An as-needed schedule has no times, so adherenceOver expects nothing and
    // counts nothing; its recorded doses are still what the doctor needs. A
    // stopped one expects nothing either, and the same holds.
    const countAll = !m.active || sortedTimes(shaped[i]).length === 0
    return [{
      name: m.name, dose: m.dose, times: m.times, daysOfWeek: m.daysOfWeek, note: m.note,
      expectedDoses: adh?.expected ?? 0, loggedDoses: countAll ? hits.length : adh?.taken ?? 0,
      lastTaken: hits.length ? lastOf(hits) : null, typicalDose: typicalOf(hits),
      ...(m.active ? {} : { stopped: true as const }),
    }]
  })

  // ── Doses with no schedule ────────────────────────────────────────────────
  // Frontin taken as needed, a one-off painkiller, a supplement: without a
  // schedule none of it reached the report. A tag counts when it is a dose
  // and not a drink, and either the app knows the substance or it was logged
  // in the app as a dose — a free-text Oura tag like "Sauna" is neither.
  const scheduledKeys = new Set(medSchedules.map(m => matchKey(m.name)))
  const others = new Map<string, { labels: Map<string, number>; hits: DoseRec[] }>()
  for (const d of doseList) {
    if (classifyOuraTag(d.name).kind !== "med") continue
    const known = supplementInfoFor(d.name) != null || normalizeSupplement(d.name) != null
    const loggedAsDose = d.row.id?.startsWith("manual_") || d.row.doseAmount != null
    if (!known && !loggedAsDose) continue
    const key = matchKey(d.name)
    if (scheduledKeys.has(key)) continue
    const g = others.get(key) ?? { labels: new Map<string, number>(), hits: [] }
    g.labels.set(d.name, (g.labels.get(d.name) ?? 0) + 1)
    g.hits.push(d.row)
    others.set(key, g)
  }
  const otherDoses: OtherDoseSummary[] = [...others.values()]
    .map(g => ({
      name: [...g.labels.entries()].sort((a, b) => b[1] - a[1])[0][0],
      count: g.hits.length,
      days: new Set(g.hits.map(h => h.day)).size,
      typicalDose: typicalOf(g.hits),
      lastTaken: lastOf(g.hits),
    }))
    .sort((a, b) => b.count - a.count || b.lastTaken.localeCompare(a.lastTaken))

  // ── Symptoms ──────────────────────────────────────────────────────────────
  const symptomMap = new Map<string, { sev: number[]; last: string }>()
  for (const s of symptomRows) {
    const entry = symptomMap.get(s.name) ?? { sev: [], last: s.day }
    entry.sev.push(s.severity)
    if (s.day > entry.last) entry.last = s.day
    symptomMap.set(s.name, entry)
  }
  const symptoms: SymptomSummary[] = [...symptomMap.entries()]
    .map(([name, e]) => ({
      name,
      occurrences: e.sev.length,
      avgSeverity: Math.round((mean(e.sev) ?? 0) * 10) / 10,
      worstSeverity: Math.max(...e.sev),
      lastSeen: e.last,
    }))
    .sort((a, b) => b.occurrences - a.occurrences)

  // ── Labs: newest value per marker, flagged against its own reference range ─
  const seenMarkers = new Set<string>()
  const labs: LabSummary[] = []
  for (const l of labRows) {
    if (seenMarkers.has(l.marker)) continue
    seenMarkers.add(l.marker)
    // labRows is newest-first, so the next row for this marker is the one before.
    const prior = labRows.find(o => o.marker === l.marker && o.date < l.date)
    const qualifier = parseLabQualifier(l.qualifier)
    // Range first, the lab's own mark where the range can't say.
    const status = rangeStatus({
      marker: l.marker, value: l.value, unit: l.unit, date: "",
      referenceMin: l.referenceMin, referenceMax: l.referenceMax,
      flag: parseLabFlag(l.flag), qualifier,
    })
    const flag: LabSummary["flag"] =
      status === "below" ? "low" : status === "above" ? "high" : status === "in-range" ? "normal" : "unknown"
    let previous: LabSummary["previous"] = null
    if (prior) {
      const priorQualifier = parseLabQualifier(prior.qualifier)
      const conv = normalizeUnit(prior.unit) === normalizeUnit(l.unit)
        ? prior.value
        : convertLabValue(prior.value, prior.unit, l.unit, l.marker)
      const pct = conv != null && conv !== 0 ? ((l.value - conv) / Math.abs(conv)) * 100 : null
      const rcv = referenceChangeValue(l.marker)
      // A limit on either side is not a measurement to take a direction from:
      // "< 5" twice is not "flat".
      const direction: "up" | "down" | "flat" | null =
        conv == null || qualifier || priorQualifier ? null
        : pct == null ? (l.value === conv ? "flat" : l.value > conv ? "up" : "down")
        : rcv != null && Math.abs(pct) < rcv ? "flat"
        : pct > 0 ? "up" : pct < 0 ? "down" : "flat"
      previous = {
        value: prior.value,
        unit: prior.unit,
        date: prior.date.toISOString().slice(0, 10),
        qualifier: priorQualifier,
        valueInLatestUnit: conv == null ? null : Math.round(conv * 100) / 100,
        direction,
        unitMismatch: conv == null,
      }
    }
    labs.push({
      marker: l.marker, value: l.value, unit: l.unit,
      referenceMin: l.referenceMin, referenceMax: l.referenceMax,
      date: l.date.toISOString().slice(0, 10), flag, qualifier,
      previous,
    })
  }
  labs.sort((a, b) => (a.flag === "normal" || a.flag === "unknown" ? 1 : 0) - (b.flag === "normal" || b.flag === "unknown" ? 1 : 0))

  // ── Body ──────────────────────────────────────────────────────────────────
  // weightSeries is oldest first, one point per day. Body fat only ever comes
  // from the Body page, so it carries its own date rather than borrowing the
  // weigh-in's.
  // The series reaches back a year; a Body-page weight older than that is
  // still the latest one on file and is shown with its date, as before.
  const oldBodyWeighs = weightSeries.length ? [] : bodyRows
    .filter(b => b.weightKg != null)
    .map(b => ({ date: b.date.toISOString().slice(0, 10), kg: b.weightKg as number }))
  const latestWeigh = weightSeries.length ? weightSeries[weightSeries.length - 1] : oldBodyWeighs[0] ?? null
  const prevWeigh = weightSeries.length > 1 ? weightSeries[weightSeries.length - 2] : oldBodyWeighs[1] ?? null
  const fatRow = bodyRows.find(b => b.bodyFatPct != null) ?? null
  const body = {
    weightKg: latestWeigh?.kg ?? null,
    prevWeightKg: prevWeigh?.kg ?? null,
    bodyFatPct: fatRow?.bodyFatPct ?? null,
    bodyFatDate: fatRow ? fatRow.date.toISOString().slice(0, 10) : null,
    date: latestWeigh?.date ?? null,
  }

  // ── Patterns: only what survived the statistics ────────────────────────────
  // A confounded finding is never "solid": the engine has said the comparison
  // may be measuring something else, and the doctor needs that sentence too.
  let patterns: HealthReport["patterns"] = []
  let patternsAsOf: string | null = null
  try {
    const { insights, at } = parseInsightsCache(insightRow?.value)
    patterns = insights
      .filter(i => (i.tier === "strong" || i.tier === "suggestive") && !i.weekendDriven && typeof i.finding === "string")
      .slice(0, 6)
      .map(i => ({
        finding: i.finding as string,
        confidence: i.tier === "strong" && !i.confounded ? "solid" as const : "tentative" as const,
        ...(i.confounded ? { confounded: i.confounded } : {}),
        ...(i.coverage ? { coverage: i.coverage } : {}),
        ...(typeof i.highGroupN === "number" && typeof i.lowGroupN === "number"
          ? { days: { with: i.highGroupN, without: i.lowGroupN } }
          : {}),
      }))
    patternsAsOf = at != null ? reportDayFmt.format(new Date(at)) : null
  } catch { patterns = [] }

  // ── Blood pressure ────────────────────────────────────────────────────────
  // Bands are the standard office-BP thresholds, applied to self-measured
  // readings — which run lower than office readings, so this is a prompt for a
  // conversation and never a diagnosis. The report says as much in print.
  function bpBand(sys: number, dia: number): BloodPressureSummary["band"] {
    if (sys >= 180 || dia >= 110) return "grade 3"
    if (sys >= 160 || dia >= 100) return "grade 2"
    if (sys >= 140 || dia >= 90) return "grade 1"
    if (sys >= 130 || dia >= 85) return "high-normal"
    if (sys >= 120 || dia >= 80) return "normal"
    return "optimal"
  }

  let bloodPressure: BloodPressureSummary | null = null
  if (bpRows.length > 0) {
    const sys = bpRows.map(r => r.systolic)
    const dia = bpRows.map(r => r.diastolic)
    const pulses = bpRows.map(r => r.pulse).filter((p): p is number => p != null)
    const last = bpRows[bpRows.length - 1]
    const avgSys = Math.round(mean(sys) ?? 0)
    const avgDia = Math.round(mean(dia) ?? 0)
    bloodPressure = {
      readings: bpRows.length,
      avgSystolic: avgSys,
      avgDiastolic: avgDia,
      maxSystolic: Math.max(...sys),
      maxDiastolic: Math.max(...dia),
      avgPulse: pulses.length ? Math.round(mean(pulses) ?? 0) : null,
      // loggedAt is a timestamp: sliced, a reading taken after local midnight
      // is dated the day before on a report handed to a doctor.
      last: { systolic: last.systolic, diastolic: last.diastolic, date: reportDayFmt.format(last.loggedAt) },
      band: bpBand(avgSys, avgDia),
    }
  }

  // ── Weight across the period ──────────────────────────────────────────────
  // Both tables count — HealthLog.weight (chat, the quick box, a Health
  // Connect scale) and BodyMeasurement — through the one shared merge.
  const weightPoints = weightSeries.filter(w => w.date >= fromStr && w.date <= toStr)
  const weightTrend = weightPoints.length >= 2
    ? {
        first: Math.round(weightPoints[0].kg * 10) / 10,
        last: Math.round(weightPoints[weightPoints.length - 1].kg * 10) / 10,
        changeKg: Math.round((weightPoints[weightPoints.length - 1].kg - weightPoints[0].kg) * 10) / 10,
        readings: weightPoints.length,
        firstDate: weightPoints[0].date,
        lastDate: weightPoints[weightPoints.length - 1].date,
      }
    : null

  // ── Narrative ─────────────────────────────────────────────────────────────
  const firstName = user?.name?.split(" ")[0] ?? "The patient"
  const metricLines = metrics.map(m => {
    const trend = m.prevAvg != null ? ` (previous ${days} days: ${m.prevAvg}${m.unit}, ${m.prevDays}/${days} days recorded)` : ""
    const excluded = m.excludedDays ? `; ${m.excludedDays} further days under ${RING_OFF_MAX_STEPS} steps left out as the device not worn` : ""
    return `- ${m.label}: mean ${m.avg}${m.unit}${trend}; range ${m.min}–${m.max}; ${m.days}/${days} days recorded${excluded}`
  })
  const medLines = meds.map(m => m.stopped
    ? `- ${m.name}${m.dose ? ` (${m.dose})` : ""}: schedule stopped or paused; ${m.loggedDoses} doses still recorded in the period, last on ${m.lastTaken}${m.typicalDose ? `; typical recorded amount ${m.typicalDose}` : ""}`
    : `- ${m.name}${m.dose ? ` (${m.dose})` : ""}, scheduled ${m.times.length}×/day at ${m.times.join(", ") || "unspecified"}; ${m.loggedDoses} doses recorded in-app of ~${m.expectedDoses} scheduled${m.typicalDose ? `; typical recorded amount ${m.typicalDose}` : ""}`)
  const otherDoseLines = otherDoses.slice(0, 12).map(o =>
    `- ${o.name}: ${o.count} doses on ${o.days} days, last on ${o.lastTaken}${o.typicalDose ? `; typical recorded amount ${o.typicalDose}` : ""}`)
  const symptomLines = symptoms.slice(0, 8).map(s =>
    `- ${s.name}: recorded ${s.occurrences}× , mean severity ${s.avgSeverity}/5, worst ${s.worstSeverity}/5, last on ${s.lastSeen}`)
  const bpLine = bloodPressure
    ? `BLOOD PRESSURE (self-measured, ${bloodPressure.readings} readings): mean ${bloodPressure.avgSystolic}/${bloodPressure.avgDiastolic} mmHg, highest ${bloodPressure.maxSystolic}/${bloodPressure.maxDiastolic}, most recent ${bloodPressure.last.systolic}/${bloodPressure.last.diastolic} on ${bloodPressure.last.date}${bloodPressure.avgPulse != null ? `, mean pulse ${bloodPressure.avgPulse}` : ""}. Mean falls in the "${bloodPressure.band}" band by office thresholds; home readings typically run lower than office readings.`
    : "BLOOD PRESSURE: none recorded."
  const weightLine = weightTrend
    ? `WEIGHT: ${weightTrend.first}kg on ${weightTrend.firstDate} to ${weightTrend.last}kg on ${weightTrend.lastDate} (${weightTrend.changeKg >= 0 ? "+" : ""}${weightTrend.changeKg}kg across ${weightTrend.readings} measurements).`
    : null
  const labLines = labs.slice(0, 12).map(l =>
    `- ${l.marker}: ${labValueText(l.value, l.qualifier)} ${l.unit} (${l.date})${l.referenceMin != null || l.referenceMax != null ? ` [ref ${l.referenceMin ?? "–"}–${l.referenceMax ?? "–"}]` : ""}${l.flag === "low" || l.flag === "high" ? ` — ${l.flag.toUpperCase()}` : ""}${l.previous ? `; ${labPreviousText(l, l.previous)}` : ""}`)

  const context = [
    `Patient: ${firstName}. Reporting period: ${fromStr} to ${toStr} (${days} days).`,
    `Wearable coverage: ${coverage.daysWithWearable}/${days} days with data; longest uninterrupted gap ${coverage.longestGapDays} days.`,
    "",
    "VITALS AND SLEEP (device-measured, Oura ring):",
    ...(metricLines.length ? metricLines : ["- none recorded"]),
    "",
    "MEDICATIONS (self-reported schedule; adherence counts only doses logged in the app and is therefore a lower bound):",
    ...(medLines.length ? medLines : ["- none on file"]),
    "",
    "OTHER DOSES LOGGED (no schedule — as-needed medicines, one-offs and supplements, as recorded by the patient):",
    ...(otherDoseLines.length ? otherDoseLines : ["- none recorded"]),
    "",
    "SYMPTOMS (self-reported):",
    ...(symptomLines.length ? symptomLines : ["- none recorded"]),
    "",
    bpLine,
    "",
    "LABORATORY RESULTS (most recent per marker, entered by the patient; previous value given where one exists):",
    ...(labLines.length ? labLines : ["- none on file"]),
    "",
    weightLine,
    body.weightKg != null ? `BODY: weight ${body.weightKg}kg${body.prevWeightKg != null ? ` (previous measurement ${body.prevWeightKg}kg)` : ""}, recorded ${body.date}${body.bodyFatPct != null ? `; body fat ${body.bodyFatPct}% recorded ${body.bodyFatDate}` : ""}.` : "BODY: no measurements on file.",
    "",
    patterns.length
      ? `STATISTICAL ASSOCIATIONS found by the app in this person's own data, computed over the most recent 90 days${patternsAsOf ? `, as of ${patternsAsOf}` : ""} (independent of the reporting period; permutation-tested, false-discovery corrected; associations only, not causal):\n${patterns.map(p =>
          `- [${p.confidence}] ${p.finding}${p.days ? ` (${p.days.with}+${p.days.without} days)` : ""}${p.coverage ? ` [coverage: ${p.coverage}]` : ""}${p.confounded ? ` [confounded: ${p.confounded}]` : ""}`).join("\n")}`
      : "STATISTICAL ASSOCIATIONS: none reached significance.",
  ].filter((l): l is string => l != null).join("\n")

  let narrative = ""
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const res = await client.messages.create({
        model: OPUS,
        // Thinking counts against this on the current model; 600 could be
        // spent before a word of summary was written. Length is the prompt's job.
        max_tokens: 8192,
        system: CLINICAL_SYSTEM,
        messages: [{ role: "user", content: `Write the summary section for this report.\n\n${context}` }],
      })
      recordModelTurn({ userId, model: OPUS, feature: "health report", stopReason: res.stop_reason, usage: res.usage })
      narrative = res.stop_reason === "refusal" ? "" : res.content.map(c => (c.type === "text" ? c.text : "")).join("").trim()
    } catch {
      narrative = ""
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    periodDays: days,
    from: fromStr,
    to: toStr,
    user: { name: user?.name ?? null, email: user?.email ?? null },
    coverage,
    metrics,
    meds,
    otherDoses,
    symptoms,
    labs,
    bloodPressure,
    body,
    weightTrend,
    patterns,
    patternsAsOf,
    narrative,
  }
}

function labPreviousText(l: LabSummary, p: NonNullable<LabSummary["previous"]>): string {
  if (p.unitMismatch) return `previous ${labValueText(p.value, p.qualifier)} ${p.unit} on ${p.date} (different unit, not comparable)`
  return `previous ${labValueText(p.valueInLatestUnit ?? p.value, p.qualifier)} ${l.unit} on ${p.date}${p.direction === "flat" ? " (within normal variation)" : ""}`
}

export function formatReportDate(iso: string): string {
  return format(new Date(iso + "T12:00:00Z"), "d MMM yyyy")
}
