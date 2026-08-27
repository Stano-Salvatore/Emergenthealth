// DELIBERATELY FREE OF PRISMA. The experiments page is a client component and
// imports OUTCOMES from here, so anything this file pulls in is traced into the
// browser bundle — importing the database client for a table of constants
// shipped the whole Prisma runtime to the browser. The one function that reads
// the database lives in experiments-analysis.ts, which only the server imports.

import { addDaysISO } from "@/lib/local-date"

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

/**
 * Read the outcome for every day of the plan, split it by arm, and test the
 * difference with the same permutation machinery the correlation engine uses.
 */
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
