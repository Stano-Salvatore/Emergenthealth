// Events the app owns: validation on the way in, occurrences on the way out.
//
// One row per event, repeating or not. A repeating row is expanded into its
// occurrences inside whatever window a reader asks for, each keeping the
// anchor's local time of day — computed in the user's timezone, so a 09:00
// standup stays at 09:00 across a clock change rather than drifting an hour.

import { prisma } from "@/lib/prisma"
import { localDateStr, zonedDateTime, zonedDayRange } from "@/lib/local-date"
import { normalizeRepeat, occurrencesBetween, type Repeat } from "@/lib/recurrence"

export interface EventOccurrence {
  /** Stable per occurrence: "<eventId>:<YYYY-MM-DD>". */
  id: string
  eventId: string
  /** The day this occurrence falls on, user-local. */
  occurrence: string
  title: string
  description: string | null
  location: string | null
  color: string | null
  start: string
  end: string | null
  isAllDay: boolean
  repeat: Repeat | null
  repeatUntil: string | null
  alertMinutes: number | null
  source: "app"
  kind: "event"
}

export interface EventInput {
  title?: unknown
  description?: unknown
  location?: unknown
  color?: unknown
  /** ISO with offset, or user-local "YYYY-MM-DDTHH:MM" / "YYYY-MM-DD". */
  start?: unknown
  end?: unknown
  isAllDay?: unknown
  repeat?: unknown
  repeatUntil?: unknown
  alertMinutes?: unknown
}

type ParsedEvent = {
  title: string
  description: string | null
  location: string | null
  color: string | null
  start: Date
  end: Date | null
  isAllDay: boolean
  repeat: Repeat | null
  repeatUntil: Date | null
  alertMinutes: number | null
}

function parseWhen(raw: unknown, timezone: string): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  const s = raw.trim()
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return zonedDateTime(timezone, s)
}

/** Validate a create/update body. Returns the fields to write or an error. */
export function parseEventInput(input: EventInput, timezone: string, existing?: ParsedEvent | null): { ok: true; data: ParsedEvent } | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 200) : existing?.title ?? ""
  if (!title) return { ok: false, error: "title is required" }

  const isAllDay = typeof input.isAllDay === "boolean" ? input.isAllDay : existing?.isAllDay ?? false

  let start: Date | null = existing?.start ?? null
  if (input.start !== undefined) {
    start = isAllDay && typeof input.start === "string"
      ? (/^\d{4}-\d{2}-\d{2}/.test(input.start) ? new Date(input.start.slice(0, 10) + "T00:00:00Z") : null)
      : parseWhen(input.start, timezone)
    if (!start) return { ok: false, error: "start is not a valid date" }
  }
  if (!start) return { ok: false, error: "start is required" }
  if (isAllDay && existing && input.start === undefined && input.isAllDay === true) {
    // Switching an existing timed event to all-day keeps its day.
    start = new Date(localDateStr(timezone, start) + "T00:00:00Z")
  }

  let end: Date | null = existing?.end ?? null
  if (input.end !== undefined) {
    end = input.end === null || input.end === "" ? null : parseWhen(input.end, timezone)
    if (input.end && !end) return { ok: false, error: "end is not a valid date" }
  }
  if (isAllDay) end = null
  if (end && end.getTime() < start.getTime()) return { ok: false, error: "end is before start" }

  const repeat = input.repeat !== undefined ? normalizeRepeat(input.repeat) : existing?.repeat ?? null
  let repeatUntil: Date | null = existing?.repeatUntil ?? null
  if (input.repeatUntil !== undefined) {
    repeatUntil = typeof input.repeatUntil === "string" && /^\d{4}-\d{2}-\d{2}/.test(input.repeatUntil)
      ? new Date(input.repeatUntil.slice(0, 10) + "T00:00:00Z")
      : null
  }
  if (!repeat) repeatUntil = null

  let alertMinutes: number | null = existing?.alertMinutes ?? null
  if (input.alertMinutes !== undefined) {
    const n = Number(input.alertMinutes)
    alertMinutes = input.alertMinutes === null || input.alertMinutes === "" || !Number.isFinite(n) ? null : Math.max(0, Math.min(7 * 24 * 60, Math.round(n)))
  }

  const str = (v: unknown, prev: string | null | undefined, max: number) =>
    v === undefined ? prev ?? null : typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null

  return {
    ok: true,
    data: {
      title,
      description: str(input.description, existing?.description, 2000),
      location: str(input.location, existing?.location, 200),
      color: (() => {
        const c = str(input.color, existing?.color, 7)
        return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null
      })(),
      start, end, isAllDay, repeat, repeatUntil, alertMinutes,
    },
  }
}

type Row = {
  id: string; title: string; description: string | null; location: string | null; color: string | null
  start: Date; end: Date | null; isAllDay: boolean; repeat: string | null; repeatUntil: Date | null
  exceptions: string[]; alertMinutes: number | null
}

/** Expand one row into its occurrences inside [from, to]. */
export function expandEvent(row: Row, from: Date, to: Date, timezone: string): EventOccurrence[] {
  const repeat = normalizeRepeat(row.repeat)
  const anchorDay = row.isAllDay ? row.start.toISOString().slice(0, 10) : localDateStr(timezone, row.start)
  const fromDay = localDateStr(timezone, from)
  const toDay = localDateStr(timezone, to)
  const durationMs = row.end ? row.end.getTime() - row.start.getTime() : 0
  // Offset from the anchor day's local midnight, so each occurrence keeps the
  // same wall-clock time whatever the offset does between now and then.
  const anchorMidnight = row.isAllDay ? row.start : zonedDayRange(timezone, anchorDay).start
  const timeOfDayMs = row.start.getTime() - anchorMidnight.getTime()

  // Widen the window by a day each side so a timed event that spills over a
  // local midnight, or a window edge in a different zone, isn't dropped.
  const days = occurrencesBetween(anchorDay, repeat, addDay(fromDay, -1), addDay(toDay, 1), {
    until: row.repeatUntil ? row.repeatUntil.toISOString().slice(0, 10) : null,
    exceptions: row.exceptions,
  })

  const out: EventOccurrence[] = []
  for (const day of days) {
    const start = row.isAllDay ? new Date(day + "T00:00:00Z") : new Date(zonedDayRange(timezone, day).start.getTime() + timeOfDayMs)
    const end = row.isAllDay ? null : row.end ? new Date(start.getTime() + durationMs) : null
    if (!row.isAllDay && (end ?? start).getTime() < from.getTime()) continue
    if (!row.isAllDay && start.getTime() > to.getTime()) continue
    if (row.isAllDay && (day < fromDay || day > toDay)) continue
    out.push({
      id: `${row.id}:${day}`, eventId: row.id, occurrence: day,
      title: row.title, description: row.description, location: row.location, color: row.color,
      start: row.isAllDay ? day : start.toISOString(),
      end: end ? end.toISOString() : null,
      isAllDay: row.isAllDay, repeat, repeatUntil: row.repeatUntil ? row.repeatUntil.toISOString().slice(0, 10) : null,
      alertMinutes: row.alertMinutes, source: "app", kind: "event",
    })
  }
  return out
}

function addDay(day: string, n: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10)
}

/** Every occurrence of the user's events inside the window, sorted by start. */
export async function loadEventOccurrences(userId: string, from: Date, to: Date, timezone: string): Promise<EventOccurrence[]> {
  const rows = await prisma.appEvent.findMany({
    where: {
      userId,
      // A repeating event anchored before the window can still land in it;
      // a one-off must start (or run) inside it.
      OR: [
        { repeat: { not: null }, start: { lte: to } },
        { repeat: null, start: { lte: to }, OR: [{ end: { gte: from } }, { end: null, start: { gte: new Date(from.getTime() - 86_400_000) } }] },
      ],
    },
    orderBy: { start: "asc" },
    take: 500,
  }).catch(() => [] as Row[])
  return rows.flatMap(r => expandEvent(r, from, to, timezone)).sort((a, b) => a.start.localeCompare(b.start))
}
