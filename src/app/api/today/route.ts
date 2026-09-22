import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getWeatherCoords } from "@/lib/weather-location"
import { addDaysISO, localDateStr, localTimeStr, zonedDayRange } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { loadEventOccurrences } from "@/lib/app-events"
import { mergeDayEvents } from "@/lib/day-events"
import { getGoals } from "@/lib/goals"
import { HYDRATING_TYPES, sumHydration } from "@/lib/hydration"
import { isDueOn } from "@/lib/habit-schedule"
import { readSyncStatus } from "@/lib/sync-status-store"

/** The two-day outlook an evening brief needs: tonight's low, tomorrow's shape. */
export interface DayOutlook { date: string; max: number; min: number; code: number; rainPct: number }

/** Today's targets against the goals the user set — the evening's "how did the day go". */
export interface Targets {
  steps: { value: number | null; goal: number }
  hydrationMl: { value: number; goal: number }
  habits: { done: number; due: number }
  /** ISO instant of the newest successful ring or phone sync, or null. */
  lastSyncedAt: string | null
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

// Weather code → emoji
function outfitFromWeather(temp: number, rainPct: number, code: number): string {
  let base: string
  if (temp < 5) base = "🧥 Heavy coat + layers"
  else if (temp < 12) base = "🧣 Jacket and scarf"
  else if (temp < 18) base = "🧥 Light jacket or hoodie"
  else if (temp < 24) base = "👕 T-shirt weather"
  else base = "🩳 Light clothes, it's warm!"
  if (rainPct > 50) base += " · ☂️ Bring an umbrella"
  else if (code >= 71 && code <= 77) base += " · 🥾 Waterproof boots"
  return base
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const timezone = await getUserTimezone(userId)
  const todayStr = localDateStr(timezone)
  const tomorrowStr = addDaysISO(todayStr, 1)
  const todayRange = zonedDayRange(timezone, todayStr)
  const tomorrowRange = zonedDayRange(timezone, tomorrowStr)

  // Sleep + readiness from latest HealthLog
  const latestHealth = await prisma.healthLog.findFirst({
    where: { userId },
    orderBy: { date: "desc" },
    select: { sleepDuration: true, sleepScore: true, readinessScore: true },
  }).catch(() => null)

  const sleepHours = latestHealth?.sleepDuration != null ? latestHealth.sleepDuration / 60 : null
  const sleep = {
    hours: sleepHours ? Math.round(sleepHours * 10) / 10 : null,
    sleepScore: latestHealth?.sleepScore ?? null,
    readiness: latestHealth?.readinessScore ?? null,
    adequate: sleepHours != null ? sleepHours >= 7 : null,
  }

  // Calendar — look for Google Calendar integration
  // Try to load via existing calendar lib; gracefully fall back
  let calendar: { id: string; title: string; start: string; end: string }[] = []
  try {
    // Check if there's a calendar token/helper — import dynamically so missing module doesn't crash
    const calMod = await import("@/lib/google-calendar").catch(() => null)
    if (calMod?.getTodayEvents) {
      const events = await calMod.getTodayEvents(userId)
      calendar = (events ?? []).map(e => ({
        id: e.id,
        title: e.title,
        start: e.start ?? "",
        end: e.end ?? "",
      }))
    }
  } catch {}

  // Tomorrow: what an evening brief is for. Google plus the app's own
  // events, merged the way the dashboard merges them.
  let tomorrow: { id: string; title: string; start: string; end: string; isAllDay: boolean }[] = []
  try {
    const calMod = await import("@/lib/google-calendar").catch(() => null)
    const [google, own] = await Promise.all([
      calMod?.getEventsInRange
        ? calMod.getEventsInRange(userId, tomorrowRange.start.toISOString(), tomorrowRange.end.toISOString()).catch(() => [])
        : Promise.resolve([]),
      loadEventOccurrences(userId, tomorrowRange.start, tomorrowRange.end, timezone).catch(() => []),
    ])
    tomorrow = mergeDayEvents(
      google.map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, isAllDay: e.isAllDay })),
      own.map(o => ({ id: o.id, title: o.title, start: o.start, end: o.end, isAllDay: o.isAllDay })),
    ).map(e => ({ id: e.id, title: e.title, start: e.start ?? "", end: e.end ?? "", isAllDay: e.isAllDay }))
  } catch {}

  // Today's targets, against the goals the user set. Habits count only what
  // the schedule asked for today; a skipped one counts as done, as the
  // widget and the quests already read it.
  let targets: Targets | null = null
  try {
    const since = new Date(todayRange.start.getTime() - 60 * 86_400_000)
    const [goals, todayLog, drinks, habits, status] = await Promise.all([
      getGoals(userId),
      prisma.healthLog.findFirst({ where: { userId, date: new Date(todayStr + "T00:00:00Z") }, select: { steps: true } }).catch(() => null),
      prisma.intakeLog.findMany({
        where: { userId, type: { in: HYDRATING_TYPES }, loggedAt: { gte: todayRange.start, lte: todayRange.end } },
        select: { amountMl: true, type: true },
      }).catch(() => []),
      prisma.habit.findMany({
        where: { userId, isArchived: false },
        include: {
          completions: { where: { date: { gte: since } }, select: { date: true } },
          skips: { where: { date: { gte: since } }, select: { date: true } },
        },
      }).catch(() => []),
      readSyncStatus(userId).catch(() => ({} as Awaited<ReturnType<typeof readSyncStatus>>)),
    ])
    let due = 0, done = 0
    for (const h of habits) {
      const days = new Set(h.completions.map(c => isoDay(c.date)))
      const skipDays = new Set(h.skips.map(s => isoDay(s.date)))
      const schedule = { scheduleDays: h.scheduleDays, timesPerWeek: h.timesPerWeek }
      if (!isDueOn(schedule, todayStr, days) && !days.has(todayStr)) continue
      due++
      if (days.has(todayStr) || skipDays.has(todayStr)) done++
    }
    const syncs = [status["oura"], status["health-connect"]]
      .filter((r): r is NonNullable<typeof r> => !!r && r.ok)
      .map(r => r.at)
      .sort()
    targets = {
      steps: { value: todayLog?.steps ?? null, goal: goals.steps },
      hydrationMl: { value: sumHydration(drinks), goal: goals.waterMl },
      habits: { done, due },
      lastSyncedAt: syncs.length ? syncs[syncs.length - 1] : null,
    }
  } catch {}

  // Weather from Open-Meteo
  const wc = await getWeatherCoords(userId)
  let weatherData: { current: { temp: number; code: number }; hourly: { hour: string; temp: number; code: number; rainPct: number }[] } | null = null
  let daily: { today: DayOutlook; tomorrow: DayOutlook } | null = null
  // Named so the reader can act. "Check the weather" was advice about the sky.
  let outfit = wc ? "Check the weather to plan your outfit" : "Set your weather location in Settings to see the forecast here"
  try {
    if (!wc) throw new Error("no location")
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${wc.lat}&longitude=${wc.lon}&hourly=temperature_2m,weathercode,precipitation_probability&current=temperature_2m,weathercode&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max&forecast_days=2&timezone=${wc.tz}`,
      { signal: AbortSignal.timeout(4000), next: { revalidate: 1800 } }
    ).catch(() => null)

    if (res?.ok) {
      const data = await res.json()
      const currentTemp = Math.round(data.current?.temperature_2m ?? 15)
      const currentCode = data.current?.weathercode ?? 0

      // Open-Meteo returns times in the location's own timezone, so the
      // "hide hours already past" cut has to use the user's clock. Comparing
      // against the server's hour (UTC on Vercel) started the forecast a
      // couple of hours in the past and lost the end of the day.
      const nowHour = parseInt(localTimeStr(timezone).slice(0, 2), 10)
      const hours = (data.hourly?.time as string[] ?? [])
        .map((t: string, i: number) => ({
          hour: t.slice(11, 16), // "HH:MM"
          temp: Math.round(data.hourly.temperature_2m[i]),
          code: data.hourly.weathercode[i] as number,
          rainPct: data.hourly.precipitation_probability[i] as number,
        }))
        .filter(h => parseInt(h.hour.split(":")[0]) >= nowHour)
        .slice(0, 8)

      weatherData = { current: { temp: currentTemp, code: currentCode }, hourly: hours }
      const maxRain = Math.max(...hours.map(h => h.rainPct), 0)
      outfit = outfitFromWeather(currentTemp, maxRain, currentCode)

      // Two days of highs and lows — the evening brief's "tonight's low,
      // tomorrow's shape". Open-Meteo's daily rows come in the location's
      // own zone, one per calendar day, so index 0 is today and 1 tomorrow.
      const dl = data.daily
      const outlook = (i: number): DayOutlook | null =>
        dl?.time?.[i] && dl.temperature_2m_max?.[i] != null && dl.temperature_2m_min?.[i] != null
          ? {
              date: String(dl.time[i]),
              max: Math.round(dl.temperature_2m_max[i]),
              min: Math.round(dl.temperature_2m_min[i]),
              code: Number(dl.weathercode?.[i] ?? 0),
              rainPct: Number(dl.precipitation_probability_max?.[i] ?? 0),
            }
          : null
      const t0 = outlook(0), t1 = outlook(1)
      if (t0 && t1) daily = { today: t0, tomorrow: t1 }
    }
  } catch {}

  return NextResponse.json({ calendar, tomorrow, sleep, weather: weatherData, daily, outfit, targets })
}
