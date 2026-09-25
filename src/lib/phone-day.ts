// What the phone's screen and light said about a night.
//
// The screen events and ambient samples were collected from 3.3.6 and read by
// nothing — battery spent on a table nobody looked at. This is the first
// reader, and the one definition, so the brief, the chat tool and any future
// card cannot each invent their own idea of "when the phone went down".
//
// The bedtime proxy is deliberately not "the last screen-off": a 3 a.m.
// glance at the clock would move bedtime to 3 a.m. Instead the night is the
// LONGEST quiet gap between screen events in the night window — the same
// "longest segment is the night" rule phone-sleep.ts uses, for the same
// reason. Under three hours of quiet is an evening out, not a night, and is
// reported as nothing.
//
// Everything here is a proxy, not a measurement: the phone going quiet says
// the phone was down, not that its owner was asleep. Callers must say so.

import { prisma } from "@/lib/prisma"
import { addDaysISO, localTimeStr, zonedDateTime, zonedDayRange } from "@/lib/local-date"
import { phoneNights, hoursLabel } from "@/lib/phone-sleep"

/** Under this, a screen-quiet gap is an evening out or a long film, not a night. */
export const MIN_NIGHT_GAP_MINUTES = 180

export interface PhoneNightUse {
  /** Start of the longest screen-quiet gap, or null when no gap qualified. */
  phoneDownAt: Date | null
  /** End of that gap: the first touch of the morning. */
  pickedUpAt: Date | null
  /** Minutes of the gap. */
  quietMinutes: number | null
  /** Screen-ons and unlocks between 22:00 and the phone going down. */
  pickupsAfter22: number
  /** Median lux over the evening (20:00–midnight before the night), null when unsampled. */
  eveningLux: number | null
  /** "HH:MM" local renderings, so no caller prints a UTC hour by accident. */
  phoneDownLocal: string | null
  pickedUpLocal: string | null
}

const EMPTY: PhoneNightUse = {
  phoneDownAt: null, pickedUpAt: null, quietMinutes: null,
  pickupsAfter22: 0, eveningLux: null, phoneDownLocal: null, pickedUpLocal: null,
}

/**
 * The night that ended on the morning of `dayISO`, in the user's timezone.
 *
 * Window: 20:00 the evening before to 11:00 that day — wide enough for early
 * nights and late mornings, narrow enough that an afternoon nap is not a
 * night. Charge events count as activity too: plugging the phone in at the
 * bedside is a touch, and excluding them would start the "night" before it.
 */
export async function phoneNightUse(
  userId: string, dayISO: string, timezone: string,
): Promise<PhoneNightUse> {
  const prevISO = addDaysISO(dayISO, -1)
  const windowStart = zonedDateTime(timezone, `${prevISO}T20:00`)
  const windowEnd = zonedDateTime(timezone, `${dayISO}T11:00`)
  const eveningEnd = zonedDateTime(timezone, `${dayISO}T00:00`)
  const tenPm = zonedDateTime(timezone, `${prevISO}T22:00`)
  if (!windowStart || !windowEnd || !eveningEnd || !tenPm) return EMPTY

  const [events, ambient] = await Promise.all([
    prisma.phoneEvent.findMany({
      where: { userId, at: { gte: windowStart, lte: windowEnd } },
      orderBy: { at: "asc" },
      select: { at: true, kind: true },
    }).catch(() => [] as { at: Date; kind: string }[]),
    prisma.ambientSample.findMany({
      where: { userId, at: { gte: windowStart, lte: eveningEnd }, lux: { not: null } },
      select: { lux: true },
    }).catch(() => [] as { lux: number | null }[]),
  ])

  const luxes = ambient.map(a => a.lux).filter((v): v is number => v !== null).sort((a, b) => a - b)
  const eveningLux = luxes.length ? luxes[Math.floor(luxes.length / 2)] : null

  // The longest gap between consecutive events is the night. One event or
  // none means the phone was quiet the whole window — which is a phone left
  // in another room, not a bedtime worth reporting.
  let best: { start: Date; end: Date; minutes: number } | null = null
  for (let i = 1; i < events.length; i++) {
    const minutes = (events[i].at.getTime() - events[i - 1].at.getTime()) / 60_000
    if (!best || minutes > best.minutes) best = { start: events[i - 1].at, end: events[i].at, minutes }
  }
  if (!best || best.minutes < MIN_NIGHT_GAP_MINUTES) {
    return { ...EMPTY, eveningLux }
  }

  const down = best.start
  const pickupsAfter22 = events.filter(
    e => (e.kind === "screen_on" || e.kind === "unlock") && e.at >= tenPm && e.at < down,
  ).length

  return {
    phoneDownAt: down,
    pickedUpAt: best.end,
    quietMinutes: Math.round(best.minutes),
    pickupsAfter22,
    eveningLux,
    phoneDownLocal: localTimeStr(timezone, down),
    pickedUpLocal: localTimeStr(timezone, best.end),
  }
}

/**
 * The phone's whole instrument panel for one day, shaped for a tool answer.
 *
 * One function because two tools serve it — the MCP connector and Emergy's
 * own chat — and the bug this closes was exactly those two describing the
 * same phone differently.
 */
export async function phoneDaySummary(userId: string, dayISO: string, timezone: string) {
  const { start, end } = zonedDayRange(timezone, dayISO)
  const [use, nights, eventCount, ambientAgg] = await Promise.all([
    phoneNightUse(userId, dayISO, timezone),
    phoneNights(userId, start, end, timezone),
    prisma.phoneEvent.count({ where: { userId, at: { gte: start, lte: end } } }).catch(() => 0),
    prisma.ambientSample.aggregate({
      where: { userId, at: { gte: start, lte: end } },
      _count: { _all: true }, _min: { lux: true }, _max: { lux: true }, _avg: { pressureHpa: true },
    }).catch(() => null),
  ])
  return {
    date: dayISO,
    night: {
      phoneDownAt: use.phoneDownLocal,
      firstPickedUpAt: use.pickedUpLocal,
      quietMinutes: use.quietMinutes,
      pickupsAfter22: use.pickupsAfter22,
      eveningMedianLux: use.eveningLux,
      note: "When the PHONE went quiet — a bedtime clue, not a sleep measurement.",
    },
    phoneDetectedSleep: nights.map(n => ({
      day: n.day, minutes: n.minutes, label: hoursLabel(n.minutes),
      start: n.start.toISOString(), end: n.end.toISOString(),
    })),
    counts: {
      screenAndChargeEvents: eventCount,
      ambientReadings: ambientAgg?._count._all ?? 0,
      luxMin: ambientAgg?._min.lux ?? null,
      luxMax: ambientAgg?._max.lux ?? null,
      pressureAvgHpa: ambientAgg?._avg.pressureHpa != null ? Math.round(ambientAgg._avg.pressureHpa * 10) / 10 : null,
    },
  }
}
