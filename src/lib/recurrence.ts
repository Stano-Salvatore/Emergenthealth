// Repeat rules for reminders and app events, in date-string space.
//
// Five rules cover what people actually set in a calendar or a to-do app;
// anything fancier (every third Tuesday, the last Friday) is what the phone's
// own calendar is for. Everything here works on YYYY-MM-DD strings so the
// server, the phone scheduler and the page agree on which day an occurrence
// falls, with no clock or timezone in the way.

export type Repeat = "daily" | "weekdays" | "weekly" | "monthly" | "yearly"

export const REPEAT_OPTIONS: { value: Repeat | null; label: string }[] = [
  { value: null,       label: "Once" },
  { value: "daily",    label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly",   label: "Every week" },
  { value: "monthly",  label: "Every month" },
  { value: "yearly",   label: "Every year" },
]

const REPEATS = new Set<string>(["daily", "weekdays", "weekly", "monthly", "yearly"])

export function normalizeRepeat(raw: unknown): Repeat | null {
  if (typeof raw !== "string") return null
  const s = raw.trim().toLowerCase()
  if (s === "" || s === "none" || s === "once" || s === "never") return null
  if (s === "weekday" || s === "workdays" || s === "every weekday") return "weekdays"
  if (s === "day" || s === "every day") return "daily"
  if (s === "week" || s === "every week") return "weekly"
  if (s === "month" || s === "every month") return "monthly"
  if (s === "year" || s === "every year" || s === "annually") return "yearly"
  return REPEATS.has(s) ? (s as Repeat) : null
}

const DAY_MS = 86_400_000

function parse(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split("-").map(Number)
  return { y, m, d }
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10)
}

/** 0 = Sunday … 6 = Saturday, from a YYYY-MM-DD string. */
export function dayOfWeek(day: string): number {
  return new Date(day + "T12:00:00Z").getUTCDay()
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Same day-of-month `n` months on, clamped to the month's length (31 Jan → 28 Feb). */
function addMonthsClamped(anchor: string, n: number): string {
  const { y, m, d } = parse(anchor)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

/**
 * The first occurrence strictly after `after`, following `repeat` anchored on
 * `anchor` (the original date — it carries the weekday, day-of-month or
 * month/day the rule keeps). `after` defaults to the anchor itself.
 */
export function nextOccurrence(anchor: string, repeat: Repeat, after: string = anchor): string {
  switch (repeat) {
    case "daily":
      return addDays(after, 1)
    case "weekdays": {
      let d = addDays(after, 1)
      while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6) d = addDays(d, 1)
      return d
    }
    case "weekly": {
      // Same weekday as the anchor, first one after `after`.
      const want = dayOfWeek(anchor)
      let d = addDays(after, 1)
      while (dayOfWeek(d) !== want) d = addDays(d, 1)
      return d
    }
    case "monthly": {
      for (let n = 1; n < 1200; n++) {
        const d = addMonthsClamped(anchor, n)
        if (d > after) return d
      }
      return addMonthsClamped(anchor, 1)
    }
    case "yearly": {
      for (let n = 1; n < 400; n++) {
        const d = addMonthsClamped(anchor, 12 * n)
        if (d > after) return d
      }
      return addMonthsClamped(anchor, 12)
    }
  }
}

/**
 * Every day the rule lands on inside [from, to], the anchor included when it
 * falls in range. A null rule yields the anchor alone. `until` (inclusive)
 * ends the series; `exceptions` are single occurrences the user removed.
 */
export function occurrencesBetween(
  anchor: string,
  repeat: Repeat | null,
  from: string,
  to: string,
  opts: { until?: string | null; exceptions?: string[]; limit?: number } = {},
): string[] {
  const limit = opts.limit ?? 400
  const skip = new Set(opts.exceptions ?? [])
  const until = opts.until ?? null
  const out: string[] = []
  const push = (d: string) => { if (d >= from && d <= to && !skip.has(d)) out.push(d) }

  if (!repeat) {
    push(anchor)
    return out
  }
  let d = anchor
  let guard = 0
  while (d <= to && guard++ < 5000 && out.length < limit) {
    if (until && d > until) break
    push(d)
    d = nextOccurrence(anchor, repeat, d)
  }
  return out
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

/** "Every Monday", "Monthly on the 9th" — the sentence a list row shows. */
export function repeatLabel(repeat: Repeat | null, anchor: string | null): string {
  if (!repeat) return "Once"
  const a = anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? parse(anchor) : null
  switch (repeat) {
    case "daily": return "Every day"
    case "weekdays": return "Weekdays"
    case "weekly": return anchor ? `Every ${WEEKDAY_NAMES[dayOfWeek(anchor)]}` : "Every week"
    case "monthly": return a ? `Monthly on the ${ordinal(a.d)}` : "Every month"
    case "yearly": return a ? `Yearly on ${a.d} ${MONTH_NAMES[a.m - 1]}` : "Every year"
  }
}
