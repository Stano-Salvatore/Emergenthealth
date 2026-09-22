// The phone's own guess at a night, for readers that would otherwise say
// "no sleep data" over it.
//
// `PhoneSleepSegment` is Android's Sleep API: motion and light, no stages, no
// score. 3.3.4 taught the brief and the quick answer to fall back to it, each
// with its own copy of the rule — and every other reader kept asserting
// ignorance: the chat prompt told Emergy "never state or imply sleep figures"
// for a night the phone had recorded, and the weekly review averaged "no
// data". One definition of a phone night now, so a third copy cannot drift:
//
//   · status 0 only — 1 is "missing data" and 2 is "not detected", and
//     neither is a night anyone slept through;
//   · three hours or more — a nap is not a night;
//   · filed under the day it ENDED, which is how the ring files a night too.
//
// Callers must label it as the phone's estimate. It is not comparable with a
// ring night and must never be averaged in with one.

import { prisma } from "@/lib/prisma"

export const PHONE_NIGHT_MIN_MINUTES = 180

export interface PhoneNight {
  start: Date
  end: Date
  minutes: number
  /** YYYY-MM-DD the night ended on, in the caller's timezone. */
  day: string
}

/** Every phone-estimated night ending in [from, to], longest-first within a day collapsed to one. */
export async function phoneNights(
  userId: string, from: Date, to: Date, timezone: string,
): Promise<PhoneNight[]> {
  const rows = await prisma.phoneSleepSegment.findMany({
    where: { userId, status: 0, end: { gte: from, lte: to } },
    select: { start: true, end: true },
    orderBy: { end: "asc" },
  }).catch(() => [] as { start: Date; end: Date }[])
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone })
  const byDay = new Map<string, PhoneNight>()
  for (const r of rows) {
    const minutes = Math.round((r.end.getTime() - r.start.getTime()) / 60_000)
    if (minutes < PHONE_NIGHT_MIN_MINUTES) continue
    const day = fmt.format(r.end)
    const have = byDay.get(day)
    if (!have || minutes > have.minutes) byDay.set(day, { start: r.start, end: r.end, minutes, day })
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`
}
