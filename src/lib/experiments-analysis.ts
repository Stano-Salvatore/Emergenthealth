import { prisma } from "@/lib/prisma"
import { permutationP } from "@/lib/correlations"
import { addDaysISO, localDateStr } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import {
  MIN_ANALYSABLE_PER_ARM,
  buildSchedule,
  outcomeSpec,
  type ExperimentAnalysis,
  type ExperimentRow,
} from "@/lib/experiments"

// The database half of experiments — see the note in experiments.ts for why it
// is not in there.

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

function round(n: number | null, d: number): number | null {
  if (n == null) return null
  const f = 10 ** d
  return Math.round(n * f) / f
}

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
    // endedAt is a timestamp, not a date-only column, so slicing the ISO string
    // buckets it by UTC day. A session finishing at 00:30 local would land on
    // the day before — and in an experiment that means the wrong arm, which
    // corrupts the exact comparison the experiment exists to make.
    const tz = await getUserTimezone(userId)
    const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz })
    for (const r of rows) {
      const d = dayFmt.format(r.endedAt)
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
