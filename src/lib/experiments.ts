import { prisma } from "@/lib/prisma"
import { addDaysISO, getUserTimezone, localDateStr } from "@/lib/local-date"
import { permutationP } from "@/lib/correlations"

// N-of-1 self-experiments.
//
// The correlation engine can only ever report that two things move together.
// It cannot separate "alcohol wrecks my sleep" from "the nights I drink are
// Fridays, and Fridays are late nights". An experiment can, because two things
// change: the user decides what to do BEFORE seeing the outcome, and alternates
// on and off in blocks so anything drifting with time — season, workload, mood,
// a new mattress — gets a chance to cancel out instead of masquerading as the
// effect.
//
// Design notes that are doing real statistical work:
//
//  - ONE outcome, chosen up front. This is why an experiment is stronger
//    evidence than the 51-question scan: that scan must spend power on
//    false-discovery correction precisely because nobody chose its questions
//    in advance. Here the question is pre-registered, so a single test is
//    honest without correction.
//  - ALTERNATING blocks (ABAB), not one long on and one long off. A real
//    effect reappears in the second ON block; a seasonal drift does not.
//  - RANDOMISED starting arm, so the first block isn't always the enthusiastic
//    one.
//  - WASHOUT days after every switch, dropped from the analysis, because a
//    supplement stopped on Sunday is still in the body on Monday.
//  - Non-adherent and unanswered days are excluded rather than assumed. An
//    unanswered day is unknown, not a silent yes.

export const MIN_ANALYSABLE_PER_ARM = 4

export type OutcomeSpec = {
  key: string
  label: string
  unit: string
  decimals: number
  higherIsBetter: boolean
  /** How the daily value is read; "next" outcomes are measured the morning after. */
  source: "health" | "checkin" | "focus" | "custom"
  field?: string
  nextDay?: boolean
}

/** What can be measured well enough to be worth testing against. */
export const OUTCOMES: OutcomeSpec[] = [
  { key: "sleepScore", label: "Sleep score", unit: "", decimals: 0, higherIsBetter: true, source: "health", field: "sleepScore", nextDay: true },
  { key: "sleepDuration", label: "Sleep duration", unit: "h", decimals: 1, higherIsBetter: true, source: "health", field: "sleepDuration", nextDay: true },
  { key: "deepSleep", label: "Deep sleep", unit: "min", decimals: 0, higherIsBetter: true, source: "health", field: "deepSleep", nextDay: true },
  { key: "remSleep", label: "REM sleep", unit: "min", decimals: 0, higherIsBetter: true, source: "health", field: "remSleep", nextDay: true },
  { key: "hrv", label: "HRV", unit: "ms", decimals: 0, higherIsBetter: true, source: "health", field: "hrv", nextDay: true },
  { key: "restingHR", label: "Resting heart rate", unit: "bpm", decimals: 0, higherIsBetter: false, source: "health", field: "restingHR", nextDay: true },
  { key: "readiness", label: "Readiness", unit: "", decimals: 0, higherIsBetter: true, source: "health", field: "readinessScore", nextDay: true },
  { key: "steps", label: "Steps", unit: "", decimals: 0, higherIsBetter: true, source: "health", field: "steps" },
  { key: "stressHigh", label: "Elevated-stress minutes", unit: "min", decimals: 0, higherIsBetter: false, source: "health", field: "stressHigh" },
  { key: "energy", label: "Morning energy", unit: "/5", decimals: 1, higherIsBetter: true, source: "checkin", field: "energy", nextDay: true },
  { key: "mood", label: "Morning mood", unit: "/5", decimals: 1, higherIsBetter: true, source: "checkin", field: "mood", nextDay: true },
  { key: "focusMin", label: "Deep-work minutes", unit: "min", decimals: 0, higherIsBetter: true, source: "focus" },
]

export function outcomeSpec(outcome: string): OutcomeSpec | null {
  if (outcome.startsWith("custom:")) {
    return { key: outcome, label: "Custom tracker", unit: "", decimals: 1, higherIsBetter: true, source: "custom" }
  }
  return OUTCOMES.find(o => o.key === outcome) ?? null
}

export type PhaseDay = {
  date: string
  block: number       // 1-based
  on: boolean
  washout: boolean    // inside the carry-over window after a switch
}

export type ExperimentRow = {
  id: string
  name: string
  action: string
  outcome: string
  blockDays: number
  blocks: number
  washoutDays: number
  startsOn: boolean
  startDate: string
  status: string
  note: string | null
}

/** Every day of the plan, with the block it belongs to and whether it counts. */
export function buildSchedule(e: Pick<ExperimentRow, "blockDays" | "blocks" | "washoutDays" | "startsOn" | "startDate">): PhaseDay[] {
  const out: PhaseDay[] = []
  for (let b = 0; b < e.blocks; b++) {
    const on = e.startsOn ? b % 2 === 0 : b % 2 === 1
    for (let d = 0; d < e.blockDays; d++) {
      out.push({
        date: addDaysISO(e.startDate, b * e.blockDays + d),
        block: b + 1,
        on,
        // The first block needs no washout — nothing preceded it to carry over.
        washout: b > 0 && d < e.washoutDays,
      })
    }
  }
  return out
}

export function totalDays(e: Pick<ExperimentRow, "blockDays" | "blocks">): number {
  return e.blockDays * e.blocks
}

export function endDate(e: Pick<ExperimentRow, "blockDays" | "blocks" | "startDate">): string {
  return addDaysISO(e.startDate, totalDays(e) - 1)
}

export type ExperimentAnalysis = {
  outcomeLabel: string
  unit: string
  onAvg: number | null
  offAvg: number | null
  diff: number | null
  percent: number | null
  onN: number
  offN: number
  pValue: number | null
  /** Per-block means, so a reader can see whether the effect repeated. */
  blockMeans: { block: number; on: boolean; mean: number | null; n: number }[]
  droppedWashout: number
  droppedNonAdherent: number
  droppedNoData: number
  verdict: "not-enough-data" | "no-effect" | "suggestive" | "clear"
  betterOnOn: boolean | null
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

function round(n: number | null, d: number): number | null {
  if (n == null) return null
  const f = 10 ** d
  return Math.round(n * f) / f
}

/**
 * Read the outcome for every day of the plan, split it by arm, and test the
 * difference with the same permutation machinery the correlation engine uses.
 */
export async function analyseExperiment(
  userId: string,
  e: ExperimentRow,
  days: { date: string; adhered: boolean }[],
): Promise<ExperimentAnalysis> {
  const spec = outcomeSpec(e.outcome)
  const schedule = buildSchedule(e)
  const first = schedule[0]?.date ?? e.startDate
  const last = addDaysISO(schedule[schedule.length - 1]?.date ?? e.startDate, 1) // +1 for next-day outcomes

  const empty: ExperimentAnalysis = {
    outcomeLabel: spec?.label ?? e.outcome, unit: spec?.unit ?? "",
    onAvg: null, offAvg: null, diff: null, percent: null, onN: 0, offN: 0, pValue: null,
    blockMeans: [], droppedWashout: 0, droppedNonAdherent: 0, droppedNoData: 0,
    verdict: "not-enough-data", betterOnOn: null,
  }
  if (!spec) return empty

  // ── Daily outcome values ──────────────────────────────────────────────────
  const byDate = new Map<string, number>()
  if (spec.source === "health" && spec.field) {
    const rows = await prisma.healthLog.findMany({
      where: { userId, date: { gte: new Date(first + "T00:00:00Z"), lte: new Date(last + "T23:59:59Z") } },
      select: { date: true, sleepScore: true, sleepDuration: true, deepSleep: true, remSleep: true, hrv: true, restingHR: true, readinessScore: true, steps: true, stressHigh: true },
    }).catch(() => [])
    for (const r of rows) {
      const raw = (r as unknown as Record<string, number | null>)[spec.field]
      if (raw == null) continue
      // Sleep duration is stored in minutes; the experiment reports hours.
      byDate.set(r.date.toISOString().slice(0, 10), spec.key === "sleepDuration" ? raw / 60 : raw)
    }
  } else if (spec.source === "checkin" && spec.field) {
    const rows = await prisma.$queryRaw<{ date: string; energy: number; mood: number }[]>`
      SELECT "date", "energy", "mood" FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" >= ${first} AND "date" <= ${last}
    `.catch(() => [] as { date: string; energy: number; mood: number }[])
    for (const r of rows) {
      const v = spec.field === "energy" ? r.energy : r.mood
      if (v != null) byDate.set(r.date, v)
    }
  } else if (spec.source === "focus") {
    const rows = await prisma.focusSession.findMany({
      where: { userId, type: "focus", endedAt: { gte: new Date(first + "T00:00:00Z"), lte: new Date(last + "T23:59:59Z") } },
      select: { endedAt: true, durationMin: true },
    }).catch(() => [])
    for (const r of rows) {
      const d = r.endedAt.toISOString().slice(0, 10)
      byDate.set(d, (byDate.get(d) ?? 0) + r.durationMin)
    }
  } else if (spec.source === "custom") {
    const metricId = e.outcome.slice("custom:".length)
    const rows = await prisma.$queryRaw<{ date: string; value: number }[]>`
      SELECT "date"::text as "date", "value" FROM "CustomMetricLog"
      WHERE "userId" = ${userId} AND "metricId" = ${metricId}
        AND "date" >= ${first}::date AND "date" <= ${last}::date
    `.catch(() => [] as { date: string; value: number }[])
    for (const r of rows) byDate.set(r.date.slice(0, 10), Number(r.value))
  }

  // ── Split by arm ──────────────────────────────────────────────────────────
  const adherence = new Map(days.map(d => [d.date, d.adhered]))
  const onVals: number[] = []
  const offVals: number[] = []
  const perBlock = new Map<number, { on: boolean; vals: number[] }>()
  let droppedWashout = 0, droppedNonAdherent = 0, droppedNoData = 0

  const today = localDateStr(await getUserTimezone(userId))

  for (const day of schedule) {
    if (day.date > today) continue // the future isn't missing data, it just hasn't happened
    if (day.washout) { droppedWashout++; continue }
    // An unanswered day is unknown, not a silent yes — but only ON days need a
    // "did you do it": an OFF day's requirement is doing nothing, and the
    // explicit "no" that the user can still record is what marks a slip.
    const answered = adherence.get(day.date)
    if (day.on && answered !== true) { droppedNonAdherent++; continue }
    if (!day.on && answered === true) { droppedNonAdherent++; continue } // did it during an off block

    // A next-day outcome (last night's sleep, this morning's energy) belongs to
    // the day after the behaviour.
    const readDate = spec.nextDay ? addDaysISO(day.date, 1) : day.date
    const v = byDate.get(readDate)
    if (v == null) { droppedNoData++; continue }

    if (day.on) onVals.push(v); else offVals.push(v)
    const slot = perBlock.get(day.block) ?? { on: day.on, vals: [] }
    slot.vals.push(v)
    perBlock.set(day.block, slot)
  }

  const onAvg = mean(onVals)
  const offAvg = mean(offVals)
  const enough = onVals.length >= MIN_ANALYSABLE_PER_ARM && offVals.length >= MIN_ANALYSABLE_PER_ARM
  const pValue = enough ? permutationP(onVals, offVals, `exp:${e.id}`) : null

  const diff = onAvg != null && offAvg != null ? onAvg - offAvg : null
  const percent = diff != null && offAvg ? (diff / Math.abs(offAvg)) * 100 : null

  let verdict: ExperimentAnalysis["verdict"] = "not-enough-data"
  if (enough && pValue != null) {
    verdict = pValue <= 0.05 ? "clear" : pValue <= 0.15 ? "suggestive" : "no-effect"
  }

  const betterOnOn = diff == null ? null : spec.higherIsBetter ? diff > 0 : diff < 0

  return {
    outcomeLabel: spec.label,
    unit: spec.unit,
    onAvg: round(onAvg, spec.decimals),
    offAvg: round(offAvg, spec.decimals),
    diff: round(diff, spec.decimals),
    percent: round(percent, 0),
    onN: onVals.length,
    offN: offVals.length,
    pValue: pValue == null ? null : Math.round(pValue * 1000) / 1000,
    blockMeans: [...perBlock.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([block, s]) => ({ block, on: s.on, mean: round(mean(s.vals), spec.decimals), n: s.vals.length })),
    droppedWashout,
    droppedNonAdherent,
    droppedNoData,
    verdict,
    betterOnOn,
  }
}

/** Where the experiment stands today: which block, on or off, days remaining. */
export function currentPhase(e: ExperimentRow, today: string): { day: PhaseDay | null; dayIndex: number; daysLeft: number; finished: boolean } {
  const schedule = buildSchedule(e)
  const idx = schedule.findIndex(d => d.date === today)
  const total = schedule.length
  if (idx === -1) {
    const finished = today > (schedule[total - 1]?.date ?? e.startDate)
    return { day: null, dayIndex: finished ? total : -1, daysLeft: finished ? 0 : total, finished }
  }
  return { day: schedule[idx], dayIndex: idx + 1, daysLeft: total - idx - 1, finished: false }
}
