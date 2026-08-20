import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"
import { format } from "date-fns"
import { addDaysISO, getUserTimezone, localDateStr } from "@/lib/local-date"
import { activeOn } from "@/lib/med-schedule"
import { fold } from "@/lib/supplement-normalize"
import { formatDose, sumDoses, type ParsedDose } from "@/lib/dose"
import type { InsightResult } from "@/lib/correlations"

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
  prevAvg: number | null
  min: number | null
  max: number | null
  days: number      // days with a reading
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
  lastTaken: string | null
  /** Typical recorded amount, e.g. "12.5mg" or "½ tablet"; null when never stated. */
  typicalDose: string | null
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
  symptoms: SymptomSummary[]
  labs: LabSummary[]
  body: { weightKg: number | null; prevWeightKg: number | null; bodyFatPct: number | null; date: string | null }
  patterns: { finding: string; confidence: "solid" | "tentative" }[]
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
  const toStr = localDateStr(tz)
  const fromStr = addDaysISO(toStr, -(days - 1))
  const prevFromStr = addDaysISO(fromStr, -days)
  const from = new Date(fromStr + "T00:00:00Z")
  const to = new Date(toStr + "T23:59:59Z")
  const prevFrom = new Date(prevFromStr + "T00:00:00Z")
  const prevTo = new Date(addDaysISO(fromStr, -1) + "T23:59:59Z")

  const [user, logs, prevLogs, medSchedules, doseRows, symptomRows, labRows, bodyRows, insightRow] = await Promise.all([
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
    prisma.medSchedule.findMany({ where: { userId, active: true } }).catch(() => []),
    // Doses actually recorded — Oura tags and manual logs share this table.
    prisma.$queryRaw<{ tagName: string | null; text: string | null; day: string; timestamp: Date; doseAmount: number | null; doseUnit: string | null }[]>`
      SELECT "tagName", "text", "day", "timestamp", "doseAmount", "doseUnit" FROM "OuraTag"
      WHERE "userId" = ${userId} AND "day" >= ${fromStr} AND "day" <= ${toStr}
    `.catch(() => [] as { tagName: string | null; text: string | null; day: string; timestamp: Date; doseAmount: number | null; doseUnit: string | null }[]),
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
  ])

  // ── Vitals ────────────────────────────────────────────────────────────────
  type Row = (typeof logs)[number]
  const SPECS: { key: string; label: string; unit: string; decimals: number; higherIsBetter: boolean; pick: (l: Row) => number | null }[] = [
    { key: "sleep", label: "Sleep duration", unit: "h", decimals: 1, higherIsBetter: true, pick: l => l.sleepDuration != null ? l.sleepDuration / 60 : null },
    { key: "sleepScore", label: "Sleep score", unit: "/100", decimals: 0, higherIsBetter: true, pick: l => l.sleepScore },
    { key: "sleepEff", label: "Sleep efficiency", unit: "%", decimals: 0, higherIsBetter: true, pick: l => l.sleepEfficiency },
    { key: "rhr", label: "Resting heart rate", unit: "bpm", decimals: 0, higherIsBetter: false, pick: l => l.restingHR },
    { key: "hrv", label: "Heart-rate variability", unit: "ms", decimals: 0, higherIsBetter: true, pick: l => l.hrv },
    { key: "readiness", label: "Readiness score", unit: "/100", decimals: 0, higherIsBetter: true, pick: l => l.readinessScore },
    { key: "spo2", label: "Blood oxygen (SpO₂)", unit: "%", decimals: 1, higherIsBetter: true, pick: l => (l.spo2 && l.spo2 > 0 ? l.spo2 : null) },
    { key: "breathing", label: "Breathing rate", unit: "/min", decimals: 1, higherIsBetter: false, pick: l => l.breathingRate },
    { key: "steps", label: "Steps", unit: "/day", decimals: 0, higherIsBetter: true, pick: l => l.steps },
    { key: "stress", label: "Elevated-stress time", unit: "min/day", decimals: 0, higherIsBetter: false, pick: l => l.stressHigh },
  ]

  const metrics: MetricSummary[] = SPECS.map(s => {
    const vals = logs.map(s.pick).filter((v): v is number => v != null)
    const prevVals = prevLogs.map(s.pick as (l: (typeof prevLogs)[number]) => number | null).filter((v): v is number => v != null)
    return {
      key: s.key, label: s.label, unit: s.unit, decimals: s.decimals, higherIsBetter: s.higherIsBetter,
      avg: round(mean(vals), s.decimals),
      prevAvg: round(mean(prevVals), s.decimals),
      min: vals.length ? round(Math.min(...vals), s.decimals) : null,
      max: vals.length ? round(Math.max(...vals), s.decimals) : null,
      days: vals.length,
    }
  }).filter(m => m.days > 0)

  // ── Coverage ──────────────────────────────────────────────────────────────
  const windowDays: string[] = []
  for (let i = 0; i < days; i++) windowDays.push(addDaysISO(fromStr, i))
  const present = new Set(logs.map(l => l.date.toISOString().slice(0, 10)))
  const coverage = { daysWithWearable: present.size, longestGapDays: longestGap(windowDays, present) }

  // ── Medications ───────────────────────────────────────────────────────────
  // Adherence counts doses recorded in the app (manual entries and Oura tags)
  // against the schedule. It is a floor, not a measurement: a dose taken and
  // never logged is invisible here, which the report states in plain words.
  const meds: MedSummary[] = medSchedules.map(m => {
    let expected = 0
    for (const day of windowDays) {
      if (activeOn({
        id: m.id, name: m.name, times: m.times, daysOfWeek: m.daysOfWeek,
        active: m.active, startDate: m.startDate, endDate: m.endDate,
      }, day)) expected += Math.max(1, m.times.length)
    }
    const needle = fold(m.name).split(/\s+/)[0] ?? ""
    const hits = needle.length >= 3
      ? doseRows.filter(d => {
          const label = fold(`${d.tagName ?? ""} ${d.text ?? ""}`)
          return label.includes(needle)
        })
      : []
    const lastTaken = hits.length
      ? hits.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)).timestamp.toISOString()
      : null
    // The mean of what was actually recorded, in whichever unit was used.
    // Milligrams and tablet fractions are never mixed into one number.
    const doses: ParsedDose[] = hits
      .filter(h => h.doseAmount != null && (h.doseUnit === "mg" || h.doseUnit === "tablet"))
      .map(h => ({ amount: h.doseAmount as number, unit: h.doseUnit as ParsedDose["unit"] }))
    const totals = sumDoses(doses)
    const mgCount = doses.filter(d => d.unit === "mg").length
    const tabCount = doses.length - mgCount
    const typicalDose =
      totals.mg != null && mgCount > 0 ? formatDose(totals.mg / mgCount, "mg")
      : totals.tablets != null && tabCount > 0 ? formatDose(totals.tablets / tabCount, "tablet")
      : null

    return {
      name: m.name, dose: m.dose, times: m.times, daysOfWeek: m.daysOfWeek, note: m.note,
      expectedDoses: expected, loggedDoses: hits.length, lastTaken, typicalDose,
    }
  })

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
    const flag: LabSummary["flag"] =
      l.referenceMin != null && l.value < l.referenceMin ? "low"
      : l.referenceMax != null && l.value > l.referenceMax ? "high"
      : l.referenceMin != null || l.referenceMax != null ? "normal"
      : "unknown"
    labs.push({
      marker: l.marker, value: l.value, unit: l.unit,
      referenceMin: l.referenceMin, referenceMax: l.referenceMax,
      date: l.date.toISOString().slice(0, 10), flag,
    })
  }
  labs.sort((a, b) => (a.flag === "normal" || a.flag === "unknown" ? 1 : 0) - (b.flag === "normal" || b.flag === "unknown" ? 1 : 0))

  // ── Body ──────────────────────────────────────────────────────────────────
  const latestBody = bodyRows[0] ?? null
  const olderBody = bodyRows.find(b => b.weightKg != null && b !== latestBody) ?? null
  const body = {
    weightKg: latestBody?.weightKg ?? null,
    prevWeightKg: olderBody?.weightKg ?? null,
    bodyFatPct: latestBody?.bodyFatPct ?? null,
    date: latestBody ? latestBody.date.toISOString().slice(0, 10) : null,
  }

  // ── Patterns: only what survived the statistics ────────────────────────────
  let patterns: HealthReport["patterns"] = []
  try {
    const parsed = insightRow ? JSON.parse(insightRow.value) : null
    const insights: InsightResult[] = parsed?.payload?.insights ?? []
    patterns = insights
      .filter(i => (i.tier === "strong" || i.tier === "suggestive") && !i.weekendDriven)
      .slice(0, 6)
      .map(i => ({ finding: i.finding, confidence: i.tier === "strong" ? "solid" as const : "tentative" as const }))
  } catch { patterns = [] }

  // ── Narrative ─────────────────────────────────────────────────────────────
  const firstName = user?.name?.split(" ")[0] ?? "The patient"
  const metricLines = metrics.map(m => {
    const trend = m.prevAvg != null ? ` (previous ${days} days: ${m.prevAvg}${m.unit})` : ""
    return `- ${m.label}: mean ${m.avg}${m.unit}${trend}; range ${m.min}–${m.max}; ${m.days}/${days} days recorded`
  })
  const medLines = meds.map(m =>
    `- ${m.name}${m.dose ? ` (${m.dose})` : ""}, scheduled ${m.times.length}×/day at ${m.times.join(", ") || "unspecified"}; ${m.loggedDoses} doses recorded in-app of ~${m.expectedDoses} scheduled${m.typicalDose ? `; typical recorded amount ${m.typicalDose}` : ""}`)
  const symptomLines = symptoms.slice(0, 8).map(s =>
    `- ${s.name}: recorded ${s.occurrences}× , mean severity ${s.avgSeverity}/5, worst ${s.worstSeverity}/5, last on ${s.lastSeen}`)
  const labLines = labs.slice(0, 12).map(l =>
    `- ${l.marker}: ${l.value} ${l.unit} (${l.date})${l.referenceMin != null || l.referenceMax != null ? ` [ref ${l.referenceMin ?? "–"}–${l.referenceMax ?? "–"}]` : ""}${l.flag === "low" || l.flag === "high" ? ` — ${l.flag.toUpperCase()}` : ""}`)

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
    "SYMPTOMS (self-reported):",
    ...(symptomLines.length ? symptomLines : ["- none recorded"]),
    "",
    "LABORATORY RESULTS (most recent per marker, entered by the patient):",
    ...(labLines.length ? labLines : ["- none on file"]),
    "",
    body.weightKg != null ? `BODY: weight ${body.weightKg}kg${body.prevWeightKg != null ? ` (previous measurement ${body.prevWeightKg}kg)` : ""}${body.bodyFatPct != null ? `, body fat ${body.bodyFatPct}%` : ""}, recorded ${body.date}.` : "BODY: no measurements on file.",
    "",
    patterns.length
      ? `STATISTICAL ASSOCIATIONS found by the app in this person's own data (permutation-tested, false-discovery corrected; associations only, not causal):\n${patterns.map(p => `- [${p.confidence}] ${p.finding}`).join("\n")}`
      : "STATISTICAL ASSOCIATIONS: none reached significance.",
  ].join("\n")

  let narrative = ""
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const res = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 600,
        system: CLINICAL_SYSTEM,
        messages: [{ role: "user", content: `Write the summary section for this report.\n\n${context}` }],
      })
      narrative = res.content.map(c => (c.type === "text" ? c.text : "")).join("").trim()
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
    symptoms,
    labs,
    body,
    patterns,
    narrative,
  }
}

export function formatReportDate(iso: string): string {
  return format(new Date(iso + "T12:00:00Z"), "d MMM yyyy")
}
