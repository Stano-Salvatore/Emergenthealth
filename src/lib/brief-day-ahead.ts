// What is left of the user's day, as one line of facts for Emergy's brief.
//
// The brief opens with last night's sleep and then turns to the day ahead —
// and it could only do the second half from guesswork: it was handed the
// habits already done and nothing still to come. Only what is still ahead
// goes in: an event that has started is behind them, a habit done or skipped
// is settled. A rest of the day with nothing in it is no line at all, so the
// brief doesn't invent a plan for an empty afternoon.

export interface DayAheadInput {
  nowMs: number
  /** An ISO instant as the user's local "HH:mm". */
  fmtTime: (iso: string) => string
  events: { title: string; start: string | null; isAllDay: boolean }[]
  habitsLeft: string[]
  remindersDue: string[]
  remindersOverdue: string[]
  /** todayDoseLines' entries that still have a dose to come ("due now", "due later", "not logged yet"). */
  dosesDue: string[]
}

const MAX = 5

const capped = (items: string[]) =>
  items.length <= MAX ? items.join(", ") : `${items.slice(0, MAX).join(", ")} +${items.length - MAX} more`

export function dayAheadLine(d: DayAheadInput): string | null {
  const timed = d.events
    .filter(e => !e.isAllDay && e.start && Date.parse(e.start) > d.nowMs)
    .sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!))
    .map(e => `${d.fmtTime(e.start!)} ${e.title}`)
  const allDay = d.events.filter(e => e.isAllDay).map(e => `all day: ${e.title}`)

  const parts: string[] = []
  if (timed.length + allDay.length > 0) parts.push(`events — ${capped([...timed, ...allDay])}`)
  if (d.habitsLeft.length > 0) parts.push(`habits not done yet — ${capped(d.habitsLeft)}`)
  const reminders = [...d.remindersDue, ...d.remindersOverdue.map(r => `overdue: ${r}`)]
  if (reminders.length > 0) parts.push(`reminders — ${capped(reminders)}`)
  if (d.dosesDue.length > 0) parts.push(`doses — ${capped(d.dosesDue)}`)

  return parts.length === 0 ? null : `Still ahead today: ${parts.join("; ")}.`
}
