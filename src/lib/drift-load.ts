// The database half of the month-on-month comparison. See drift.ts for why
// the comparison is shaped the way it is; this only gathers.

import { prisma } from "@/lib/prisma"
import { addDaysISO, localDateStr } from "@/lib/local-date"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { normalizeSupplement, cleanLabel } from "@/lib/supplement-normalize"
import {
  DRIFT_METRICS, judgeFactors, judgeMetric,
  type DayValue, type DriftReport, type Window,
} from "@/lib/drift"

/** The last 30 days against the 30 before — the chat's window. */
export function rollingWindows(today: string): { recent: Window; prior: Window } {
  return {
    recent: { from: addDaysISO(today, -29), to: today },
    prior: { from: addDaysISO(today, -59), to: addDaysISO(today, -30) },
  }
}

/**
 * "Since <date>" against the same number of days before it — the chat's
 * anchor-date comparison. Matched length on purpose, as in the engine's
 * onset family: it keeps the sample sizes comparable and the seasons close,
 * where "since 18 August against the rest of the year" pits 24 days against
 * 34 weeks of a different season and calls the difference a change.
 */
export function anchoredWindows(since: string, until: string): { recent: Window; prior: Window; days: number } {
  const days = Math.round((Date.parse(until + "T00:00:00Z") - Date.parse(since + "T00:00:00Z")) / 86_400_000) + 1
  return {
    recent: { from: since, to: until },
    prior: { from: addDaysISO(since, -days), to: addDaysISO(since, -1) },
    days,
  }
}

/** Last calendar month against the one before — the monthly nudge's window. */
export function calendarWindows(today: string): { recent: Window; prior: Window } {
  const [y, m] = today.split("-").map(Number)
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`
  const lastOf = (yy: number, mm: number) => addDaysISO(mm === 12 ? first(yy + 1, 1) : first(yy, mm + 1), -1)
  const rm = m === 1 ? 12 : m - 1, ry = m === 1 ? y - 1 : y
  const pm = rm === 1 ? 12 : rm - 1, py = rm === 1 ? ry - 1 : ry
  return {
    recent: { from: first(ry, rm), to: lastOf(ry, rm) },
    prior: { from: first(py, pm), to: lastOf(py, pm) },
  }
}

export async function loadDriftReport(userId: string, timezone: string, windows: { recent: Window; prior: Window }): Promise<DriftReport> {
  const { recent, prior } = windows
  const from = new Date(prior.from + "T00:00:00Z")
  const to = new Date(recent.to + "T23:59:59.999Z")

  const [logs, moods, checkins, tags, habitDone, habits, workouts, intake] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: { date: true, sleepScore: true, sleepDuration: true, hrv: true, restingHR: true, readinessScore: true, steps: true },
    }).catch(() => []),
    prisma.moodLog.findMany({ where: { userId, date: { gte: from, lte: to } }, select: { date: true, mood: true } }).catch(() => []),
    prisma.$queryRaw<{ date: string; energy: number }[]>`
      SELECT "date", "energy" FROM "MorningCheckIn" WHERE "userId" = ${userId} AND "date" >= ${prior.from} AND "date" <= ${recent.to}
    `.catch(() => [] as { date: string; energy: number }[]),
    prisma.$queryRaw<{ day: string; tagName: string | null; text: string | null }[]>`
      SELECT "day", "tagName", "text" FROM "OuraTag" WHERE "userId" = ${userId} AND "day" >= ${prior.from} AND "day" <= ${recent.to}
    `.catch(() => [] as { day: string; tagName: string | null; text: string | null }[]),
    prisma.habitCompletion.findMany({ where: { userId, date: { gte: from, lte: to } }, select: { habitId: true, date: true } }).catch(() => []),
    prisma.habit.findMany({ where: { userId }, select: { id: true, name: true } }).catch(() => []),
    prisma.stravaActivity.findMany({ where: { userId, day: { gte: prior.from, lte: recent.to } }, select: { day: true } }).catch(() => []),
    prisma.intakeLog.findMany({ where: { userId, loggedAt: { gte: from, lte: to } }, select: { type: true, amountMl: true, loggedAt: true } }).catch(() => []),
  ])

  // @db.Date columns come back at UTC midnight, so the slice is the day.
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const series: Record<string, DayValue[]> = Object.fromEntries(DRIFT_METRICS.map(m => [m.key, []]))
  for (const l of logs) {
    const d = day(l.date)
    if (l.sleepScore != null) series.sleepScore.push({ day: d, value: l.sleepScore })
    if (l.sleepDuration != null) series.sleepDuration.push({ day: d, value: l.sleepDuration / 60 })
    if (l.hrv != null) series.hrv.push({ day: d, value: l.hrv })
    if (l.restingHR != null) series.restingHR.push({ day: d, value: l.restingHR })
    if (l.readinessScore != null) series.readinessScore.push({ day: d, value: l.readinessScore })
    if (l.steps != null) series.steps.push({ day: d, value: l.steps })
  }
  for (const m of moods) series.mood.push({ day: day(m.date), value: m.mood })
  for (const c of checkins) series.energy.push({ day: c.date, value: c.energy })

  let judged = 0
  const shifts = []
  for (const metric of DRIFT_METRICS) {
    const vals = series[metric.key]
    const enough = vals.filter(v => v.day >= prior.from && v.day <= prior.to).length >= 10
      && vals.filter(v => v.day >= recent.from && v.day <= recent.to).length >= 10
    if (!enough) continue
    judged++
    const s = judgeMetric(metric, vals, prior, recent, `drift:${userId}:${recent.from}`)
    if (s) shifts.push(s)
  }

  // Factors: tags (meds, supplements, drinks the ring app knows), habits done,
  // drinks logged here, workouts, water.
  const daysByLabel = new Map<string, Set<string>>()
  const add = (label: string, d: string) => {
    const set = daysByLabel.get(label) ?? new Set<string>()
    set.add(d)
    daysByLabel.set(label, set)
  }
  for (const t of tags) {
    const raw = ((t.tagName ?? t.text) ?? "").trim()
    if (!raw) continue
    const kind = classifyOuraTag(raw).kind
    const label = kind === "med" ? (normalizeSupplement(raw) ?? cleanLabel(raw)) : cleanLabel(raw)
    if (label) add(label, t.day)
  }
  const habitName = new Map(habits.map(h => [h.id, h.name]))
  for (const c of habitDone) {
    const name = habitName.get(c.habitId)
    if (name) add(`${name} (habit)`, day(c.date))
  }
  const waterByDay = new Map<string, number>()
  for (const i of intake) {
    const d = localDateStr(timezone, i.loggedAt)
    if (i.type === "water") waterByDay.set(d, (waterByDay.get(d) ?? 0) + i.amountMl)
    else if (i.type === "coffee" || i.type === "alcohol" || i.type === "beer" || i.type === "wine") add(i.type === "beer" || i.type === "wine" ? "alcohol" : i.type, d)
  }

  const factors = judgeFactors({ daysByLabel, workoutDays: workouts.map(w => w.day), waterByDay }, prior, recent)
  return { recent, prior, judged, shifts, factors }
}
