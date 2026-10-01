// The second word about a dose: still unlogged two hours after its time.
//
// The reminder fires once at the time and then never again, so a pill
// forgotten at 08:00 stayed forgotten. This is the follow-up Emergy asks in
// the chat — a question, because an unlogged dose is often a taken one
// nobody ticked off, and "yes" from the user is what files it.

import { activeOn, dosesByDay, minutesOfDay, sortedTimes, type DoseLike, type ScheduleLike } from "@/lib/med-schedule"

/** Long enough to be past "I'm just about to", short enough to still remember. */
export const FOLLOW_UP_AFTER_MIN = 120
/** The cron runs every ten minutes but GitHub can hold it for hours; past this the question is stale. */
const FOLLOW_UP_WINDOW_MIN = 120
/** No follow-up asked between these local times. */
const QUIET_FROM_MIN = 22 * 60
const QUIET_UNTIL_MIN = 7 * 60

export interface FollowUp {
  scheduleId: string
  name: string
  dose: string | null
  time: string
}

export function followUpsDue(
  schedules: (ScheduleLike & { dose?: string | null })[],
  doses: DoseLike[],
  today: string,
  nowMinutes: number,
): FollowUp[] {
  if (nowMinutes >= QUIET_FROM_MIN || nowMinutes < QUIET_UNTIL_MIN) return []
  const out: FollowUp[] = []
  for (const s of schedules) {
    if (!activeOn(s, today)) continue
    const logged = dosesByDay(s, doses).get(today) ?? 0
    const times = sortedTimes(s)
    times.forEach((time, i) => {
      // Doses fill the times in order, the same rule the reminder and the page use.
      if (i < logged) return
      const askAt = minutesOfDay(time) + FOLLOW_UP_AFTER_MIN
      if (nowMinutes < askAt || nowMinutes >= askAt + FOLLOW_UP_WINDOW_MIN) return
      // Once the next time of the same medicine has come, its own reminder is
      // the live question; asking about the earlier one too is noise.
      const next = times[i + 1]
      if (next && nowMinutes >= minutesOfDay(next)) return
      out.push({ scheduleId: s.id, name: s.name, dose: s.dose ?? null, time })
    })
  }
  return out
}

/** A question, never an instruction — whether to take it late is not Emergy's to say. */
export function followUpText(due: FollowUp[]): string {
  const one = (f: FollowUp) => `${f.time} ${f.name}`
  if (due.length === 1) {
    const f = due[0]
    return `Your ${one(f)}${f.dose ? ` (${f.dose})` : ""} isn't logged yet. Did you take it?`
  }
  const shown = due.slice(0, 3).map(one)
  const list = due.length > 3
    ? `${shown.join(", ")} and ${due.length - 3} more`
    : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`
  return `Your ${list} aren't logged yet. Did you take them?`
}
