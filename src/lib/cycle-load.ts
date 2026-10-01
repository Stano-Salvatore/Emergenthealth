// Reading and saving cycle tracking: one loader for the page, the home card,
// Emergy, the report and the heads-up push, so all of them see the same day.

import { prisma } from "@/lib/prisma"
import { addDaysISO, localDateStr } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { getGoals } from "@/lib/goals"
import { loadMoodSeries } from "@/lib/mood-series"
import { isEmptyDay, mergeDay, type DayData } from "@/lib/cycle-input"
import {
  AVERAGE_METRICS, cycleToday, parseCycleSettings, periodsFrom, phaseAverages,
  type CycleDayLog, type CycleSettings, type CycleToday, type DayValue, type Flow, type PhaseAverages,
} from "@/lib/cycle"

export const CYCLE_SETTINGS_KEY = "cycle_settings"
/** About a year: enough cycles for the averages, and the calendar's back-scroll. */
const HISTORY_DAYS = 400

/**
 * on: the user turned it on. suggested: Goals has the sex set to female and
 * no choice has been made either way, so the page is offered rather than hidden. off:
 * everyone else — the page still opens from search, with its own switch.
 */
export type CycleVisibility = "on" | "suggested" | "off"

export async function getCycleSettings(userId: string): Promise<{ settings: CycleSettings; visibility: CycleVisibility }> {
  const [row, goals] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId_key: { userId, key: CYCLE_SETTINGS_KEY } }, select: { value: true } }).catch(() => null),
    getGoals(userId).catch(() => null),
  ])
  const settings = parseCycleSettings(row?.value)
  const visibility: CycleVisibility = settings.enabled ? "on" : !row && goals?.sex === "female" ? "suggested" : "off"
  return { settings, visibility }
}

export async function saveCycleSettings(userId: string, patch: Partial<CycleSettings>): Promise<CycleSettings> {
  const { settings: current } = await getCycleSettings(userId)
  const next = parseCycleSettings(JSON.stringify({ ...current, ...patch }))
  const value = JSON.stringify(next)
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: CYCLE_SETTINGS_KEY } },
    create: { userId, key: CYCLE_SETTINGS_KEY, value },
    update: { value },
  })
  return next
}

type Row = {
  day: string; flow: string | null; pain: number | null; symptoms: string[]; moods: string[]
  discharge: string | null; lhTest: string | null; note: string | null
}

export function toLog(r: Row): CycleDayLog {
  return {
    day: r.day, flow: (r.flow as Flow | null) ?? null, pain: r.pain, symptoms: r.symptoms, moods: r.moods,
    discharge: r.discharge, lhTest: r.lhTest === "positive" || r.lhTest === "negative" ? r.lhTest : null, note: r.note,
  }
}

// @db.Date columns come back at UTC midnight, so the slice is the day.
const dateDay = (d: Date) => d.toISOString().slice(0, 10)

export interface CycleLoad {
  settings: CycleSettings
  visibility: CycleVisibility
  todayStr: string
  timezone: string
  logs: CycleDayLog[]
  /** The ring's skin-temperature deviation by night, for the ovulation shift. */
  temps: DayValue[]
  today: CycleToday
}

export async function loadCycle(userId: string): Promise<CycleLoad> {
  const [timezone, { settings, visibility }] = await Promise.all([getUserTimezone(userId), getCycleSettings(userId)])
  const todayStr = localDateStr(timezone)
  // Emergy, the home page and the report all ask, for everyone; a year of
  // days and temperatures is only read for someone who tracks the cycle.
  if (!settings.enabled) {
    return { settings, visibility, todayStr, timezone, logs: [], temps: [], today: cycleToday(todayStr, [], settings) }
  }
  const from = addDaysISO(todayStr, -HISTORY_DAYS)
  const [rows, health] = await Promise.all([
    prisma.cycleDay.findMany({
      where: { userId, day: { gte: from, lte: todayStr } },
      orderBy: { day: "asc" },
      select: { day: true, flow: true, pain: true, symptoms: true, moods: true, discharge: true, lhTest: true, note: true },
    }).catch(() => [] as Row[]),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: new Date(from + "T00:00:00Z") }, skinTemp: { not: null } },
      orderBy: { date: "asc" },
      select: { date: true, skinTemp: true },
    }).catch(() => [] as { date: Date; skinTemp: number | null }[]),
  ])
  const logs = rows.map(toLog)
  const temps = health.flatMap(h => h.skinTemp == null ? [] : [{ date: dateDay(h.date), value: h.skinTemp }])
  return { settings, visibility, todayStr, timezone, logs, temps, today: cycleToday(todayStr, logs, settings, temps) }
}

/** The user's own numbers by phase, over the cycles logged in the last year. */
export async function loadPhaseAverages(userId: string, load: CycleLoad): Promise<PhaseAverages> {
  const from = addDaysISO(load.todayStr, -HISTORY_DAYS)
  const [health, moods, checkins] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: new Date(from + "T00:00:00Z") } },
      select: { date: true, sleepScore: true, hrv: true, restingHR: true, readinessScore: true },
    }).catch(() => []),
    loadMoodSeries(userId, from, load.todayStr).catch(() => [] as { day: string; mood: number }[]),
    prisma.morningCheckIn.findMany({
      where: { userId, date: { gte: from, lte: load.todayStr } },
      select: { date: true, energy: true },
    }).catch(() => [] as { date: string; energy: number }[]),
  ])
  const series: Record<string, DayValue[]> = Object.fromEntries(AVERAGE_METRICS.map(m => [m.key, []]))
  for (const h of health) {
    const d = dateDay(h.date)
    if (h.sleepScore != null) series.sleepScore.push({ date: d, value: h.sleepScore })
    if (h.hrv != null) series.hrv.push({ date: d, value: h.hrv })
    if (h.restingHR != null) series.restingHR.push({ date: d, value: h.restingHR })
    if (h.readinessScore != null) series.readinessScore.push({ date: d, value: h.readinessScore })
  }
  for (const m of moods) series.mood.push({ date: m.day, value: m.mood })
  for (const c of checkins) series.energy.push({ date: c.date, value: c.energy })
  return phaseAverages(periodsFrom(load.logs).periods, series, load.settings, load.temps)
}

/** The latest ferritin, if there is one in Labs — iron is the period's own lab number. */
export async function latestFerritin(userId: string): Promise<{ value: number; unit: string; date: string; flag: string | null; qualifier: string | null } | null> {
  const r = await prisma.labResult.findFirst({
    where: { userId, marker: "Ferritin" },
    orderBy: { date: "desc" },
    select: { value: true, unit: true, date: true, flag: true, qualifier: true },
  }).catch(() => null)
  return r ? { value: r.value, unit: r.unit, date: dateDay(r.date), flag: r.flag, qualifier: r.qualifier } : null
}

/**
 * Writes one day — the page and Emergy both come through here. A day left
 * with nothing on it is deleted rather than kept as an empty row, and a
 * "no flow" day is kept: it is what ends a period.
 */
export async function saveCycleDay(
  userId: string, day: string, update: DayData, opts: { union?: boolean } = {},
): Promise<CycleDayLog | null> {
  const existing = await prisma.cycleDay.findUnique({
    where: { userId_day: { userId, day } },
    select: { day: true, flow: true, pain: true, symptoms: true, moods: true, discharge: true, lhTest: true, note: true },
  })
  const merged = mergeDay(existing ? toLog(existing) : {}, update, opts)
  if (isEmptyDay(merged)) {
    await prisma.cycleDay.deleteMany({ where: { userId, day } })
    return null
  }
  const data = {
    flow: merged.flow ?? null, pain: merged.pain ?? null, symptoms: merged.symptoms ?? [], moods: merged.moods ?? [],
    discharge: merged.discharge ?? null, lhTest: merged.lhTest ?? null, note: merged.note ?? null,
  }
  const row = await prisma.cycleDay.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, ...data },
    update: data,
    select: { day: true, flow: true, pain: true, symptoms: true, moods: true, discharge: true, lhTest: true, note: true },
  })
  return toLog(row)
}
