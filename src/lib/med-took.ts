// "✓ Took it" on a dose notification, as a plan: which doses to write and
// when. A tap after the dose was already ticked off in the app writes
// nothing — two rows for one pill would read as a double dose everywhere
// the log is read.

import { zonedClock } from "@/lib/local-date"
import { dosesByDay, sortedTimes, type DoseLike, type ScheduleLike } from "@/lib/med-schedule"

export interface TookItem {
  scheduleId: string
  time: string
  atScheduled?: boolean
}

export interface TookWrite {
  scheduleId: string
  name: string
  dose: string | null
  at: Date
}

export function planTook(
  items: TookItem[],
  schedules: (ScheduleLike & { dose?: string | null })[],
  doses: DoseLike[],
  today: string,
  tz: string,
  now: Date,
): { write: TookWrite[]; already: string[] } {
  const write: TookWrite[] = []
  const already: string[] = []
  const planned = new Map<string, number>()
  for (const item of items) {
    const s = schedules.find(x => x.id === item.scheduleId)
    if (!s) continue
    const slot = sortedTimes(s).indexOf(item.time)
    const covered = (dosesByDay(s, doses).get(today) ?? 0) + (planned.get(s.id) ?? 0)
    if (slot >= 0 && slot < covered) { already.push(s.name); continue }
    const scheduled = item.atScheduled ? zonedClock(tz, today, item.time) : null
    // Never in the future: a follow-up "Took it" for a time not yet come is the tap.
    const at = scheduled && scheduled.getTime() <= now.getTime() ? scheduled : now
    write.push({ scheduleId: s.id, name: s.name, dose: s.dose ?? null, at })
    planned.set(s.id, (planned.get(s.id) ?? 0) + 1)
  }
  return { write, already }
}
