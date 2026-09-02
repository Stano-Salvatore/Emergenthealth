// When a reminder will actually go off.
//
// Emergy's create_reminder tool took a title, an optional date and a priority,
// and never a TIME. The phone's scheduler needs both:
//
//   if (r.isCompleted || !r.dueDate) continue          // no date, no alarm
//   const [h, m] = (r.reminderTime || "09:00")…        // no time, 9am
//
// So "remind me to take the pills at six" produced a row that either never
// rang at all or rang at nine the next morning, while the reply said
// "Created reminder". Asking for an alarm and being told you got one is worse
// than being told no.
//
// This works out the two fields the scheduler reads, and the sentence to say
// back, from what the user actually asked for.

/** Minutes past midnight, or null if the string isn't "HH:MM". */
export function parseHhMm(time: string | null | undefined): number | null {
  if (!time) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/** "2026-09-02" + 1 → "2026-09-03". Calendar arithmetic in UTC, no clock. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export interface ReminderWhen {
  /** What to store in Reminder.dueDate; null means it will never ring. */
  dueDate: string | null
  /** What to store in Reminder.reminderTime ("HH:MM"), or null. */
  reminderTime: string | null
  /** One line for the confirmation, so nobody has to guess. */
  label: string
}

/**
 * Decide when a reminder fires.
 *
 * A time with no date means the next time that clock reading comes round: at
 * 14:00 "at six" is tonight, at 19:00 it is tomorrow morning. Guessing "today"
 * either way would half the time schedule an alarm in the past, which the
 * phone silently drops.
 *
 * A reminder with no time at all is a to-do rather than an alarm; it keeps a
 * date if one was given (the scheduler will ring it at 09:00) and says so.
 */
export function resolveReminderWhen(input: {
  time?: string | null
  dueDate?: string | null
  /** Today where the USER is, "YYYY-MM-DD". */
  today: string
  /** Minutes past local midnight, right now. */
  nowMinutes: number
}): ReminderWhen {
  const mins = parseHhMm(input.time)
  const date = input.dueDate?.slice(0, 10) || null

  if (mins === null) {
    if (!date) {
      return {
        dueDate: null,
        reminderTime: null,
        label: "saved to your list — no date, so it won't ring",
      }
    }
    return {
      dueDate: date,
      reminderTime: null,
      label: `${dayWord(date, input.today)} at 09:00`,
    }
  }

  const hhmm = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`

  // A date the user named wins outright, even if that time today has gone —
  // they said which day.
  if (date) {
    return { dueDate: date, reminderTime: hhmm, label: `${dayWord(date, input.today)} at ${hhmm}` }
  }

  // Strictly after now: "remind me at 14:30" said at exactly 14:30 means
  // tomorrow, not an alarm for this very minute that may already be past.
  const day = mins > input.nowMinutes ? input.today : addDays(input.today, 1)
  return { dueDate: day, reminderTime: hhmm, label: `${dayWord(day, input.today)} at ${hhmm}` }
}

function dayWord(date: string, today: string): string {
  if (date === today) return "today"
  if (date === addDays(today, 1)) return "tomorrow"
  return `on ${date}`
}
