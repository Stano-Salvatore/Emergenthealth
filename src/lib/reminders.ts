// Completing, un-completing and snoozing reminders — the one place that knows
// what a repeating reminder does when it is ticked.
//
// Four surfaces can complete a reminder (the page, the widget, Emergy, and the
// notification's ✓ button) and each used to flip isCompleted itself. That was
// fine while every reminder was a one-off. A repeating one has to file a done
// copy for its history and roll forward instead, and four copies of that rule
// would drift within a week — so all four call in here.

import { prisma } from "@/lib/prisma"
import { userToday } from "@/lib/user-timezone"
import { normalizeRepeat, nextOccurrence, addDays } from "@/lib/recurrence"

function dayOf(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

function dateColumn(day: string): Date {
  return new Date(day + "T00:00:00Z")
}

export type CompleteResult =
  | { ok: true; done: true; rolledTo: null }
  | { ok: true; done: false; rolledTo: string }
  | { ok: false; error: string }

/**
 * Tick a reminder. A one-off is marked done. A repeating one gets a completed
 * copy dated when it was due, and the row itself moves to the next
 * occurrence after today — after today, not after the due date, so a daily
 * reminder ignored for a week doesn't come back seven times in a row.
 */
export async function completeReminder(userId: string, id: string): Promise<CompleteResult> {
  const row = await prisma.reminder.findFirst({ where: { id, userId } })
  if (!row) return { ok: false, error: "Not found" }
  const repeat = normalizeRepeat(row.repeat)
  const due = dayOf(row.dueDate)
  const now = new Date()

  if (!repeat || !due) {
    await prisma.reminder.update({ where: { id }, data: { isCompleted: true, completedAt: now } })
    return { ok: true, done: true, rolledTo: null }
  }

  const today = await userToday(userId)
  const next = nextOccurrence(due, repeat, due > today ? due : today)
  const until = dayOf(row.repeatUntil)

  if (until && next > until) {
    // The series has run its course: the row itself is the last done entry,
    // so no copy — two "done" rows for one tick would read as a bug.
    await prisma.reminder.update({ where: { id }, data: { isCompleted: true, completedAt: now } })
    return { ok: true, done: true, rolledTo: null }
  }

  await prisma.reminder.create({
    data: {
      userId, title: row.title, description: row.description, dueDate: row.dueDate,
      reminderTime: row.reminderTime, priority: row.priority, tags: row.tags,
      isCompleted: true, completedAt: now, seriesId: row.id, repeat: null,
    },
  })
  await prisma.reminder.update({ where: { id }, data: { dueDate: dateColumn(next), isCompleted: false, completedAt: null } })
  return { ok: true, done: false, rolledTo: next }
}

/**
 * Untick. For a done copy of a series whose live row is still sitting on the
 * very next occurrence, the roll is undone: the copy goes and the series
 * steps back to that date. Otherwise the row simply reopens as a one-off.
 */
export async function uncompleteReminder(userId: string, id: string): Promise<{ ok: boolean }> {
  const row = await prisma.reminder.findFirst({ where: { id, userId } })
  if (!row) return { ok: false }
  if (row.seriesId && row.dueDate) {
    const series = await prisma.reminder.findFirst({ where: { id: row.seriesId, userId } })
    const repeat = series ? normalizeRepeat(series.repeat) : null
    if (series && repeat && series.dueDate) {
      const copyDay = dayOf(row.dueDate)!
      const seriesDay = dayOf(series.dueDate)!
      if (seriesDay > copyDay) {
        await prisma.reminder.update({ where: { id: series.id }, data: { dueDate: row.dueDate, isCompleted: false, completedAt: null } })
        await prisma.reminder.delete({ where: { id: row.id } })
        return { ok: true }
      }
    }
  }
  await prisma.reminder.update({ where: { id }, data: { isCompleted: false, completedAt: null } })
  return { ok: true }
}

export type SnoozeInput =
  | { minutes: number }
  | { date: string; time?: string | null }

/**
 * Push a reminder to later. `minutes` is relative to now in the user's clock;
 * `date`/`time` set it outright. Either way the row keeps its rule, so a
 * snoozed daily reminder still repeats from wherever it ends up.
 */
export async function snoozeReminder(userId: string, id: string, input: SnoozeInput, timezone: string): Promise<{ ok: boolean; dueDate?: string; reminderTime?: string | null }> {
  const row = await prisma.reminder.findFirst({ where: { id, userId } })
  if (!row) return { ok: false }
  let day: string
  let time: string | null
  if ("minutes" in input) {
    const at = new Date(Date.now() + Math.max(1, input.minutes) * 60_000)
    day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at)
    time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at)
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false }
    day = input.date
    time = input.time && /^\d{2}:\d{2}$/.test(input.time) ? input.time : row.reminderTime
  }
  await prisma.reminder.update({ where: { id }, data: { dueDate: dateColumn(day), reminderTime: time, isCompleted: false, completedAt: null } })
  return { ok: true, dueDate: day, reminderTime: time }
}

/** Tomorrow in the user's calendar — the most-used snooze target. */
export function tomorrowFor(today: string): string {
  return addDays(today, 1)
}
