// Server-side "what day is it for this user?" helpers.
//
// The server runs in UTC, so `new Date()` there is not the user's day. For a
// user in UTC+2 the two disagree between 00:00 and 02:00 local — long enough
// that a habit ticked just after midnight was being filed under yesterday.
// Everything here works in plain YYYY-MM-DD strings, which compare and sort
// correctly without any further timezone juggling.
//
// PURE ON PURPOSE — no database, nothing server-only. Client components import
// these date helpers, so anything this file pulls in is traced into the browser
// bundle; it used to import the Prisma client for one lookup, which shipped the
// whole Prisma runtime to the browser. That lookup is user-timezone.ts now.

// Today's date in the user's timezone. en-CA formats as YYYY-MM-DD.
export function localDateStr(timezone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

// Current wall-clock time in the user's timezone, as "HH:MM" (24h).
export function localTimeStr(timezone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(at)
    const h = parts.find(p => p.type === "hour")?.value ?? "00"
    const m = parts.find(p => p.type === "minute")?.value ?? "00"
    return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`
  } catch {
    return at.toISOString().slice(11, 16)
  }
}

// Minutes that `timezone` is ahead of UTC at a given instant (handles DST).
export function tzOffsetMinutes(timezone: string, at: Date = new Date()): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone, hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).formatToParts(at).filter(p => p.type !== "literal").map(p => [p.type, p.value])
    ) as Record<string, string>
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
    )
    return Math.round((asUTC - at.getTime()) / 60000)
  } catch {
    return 0
  }
}

// The instant local midnight falls at, for a given YYYY-MM-DD. Resolved in two
// passes: the first guess uses the offset at UTC midnight, the second uses the
// offset actually in force at that guess — which is what makes the clock-change
// days come out right rather than an hour adrift.
function zonedMidnight(timezone: string, dayISO: string): Date {
  const naive = Date.parse(`${dayISO}T00:00:00Z`)
  const first = naive - tzOffsetMinutes(timezone, new Date(naive)) * 60000
  return new Date(naive - tzOffsetMinutes(timezone, new Date(first)) * 60000)
}

// The instants at which the user's day starts and ends. Querying a calendar
// for "today" using the server's own midnight silently shifts the window by the
// user's offset — dropping early-morning events and pulling in last night's.
// Deriving the end from the *next* local midnight also makes the 23- and
// 25-hour days around a clock change exact.
export function zonedDayRange(timezone: string, dayISO?: string): { start: Date; end: Date } {
  const day = dayISO ?? localDateStr(timezone)
  const start = zonedMidnight(timezone, day)
  const end = new Date(zonedMidnight(timezone, addDaysISO(day, 1)).getTime() - 1)
  return { start, end }
}

// The instant a given local wall-clock time falls at, as UTC. Same two-pass
// resolution as zonedMidnight, for the same reason.
//
// Needed wherever the user tells us *when* something happened rather than
// logging it as it happens: "put this at 23:40" has to mean 23:40 where they
// are, not on the server. Accepts "YYYY-MM-DD" (midday, so a bare date can't
// land on the wrong side of a boundary) or "YYYY-MM-DDTHH:MM" / with a space.
// Returns null rather than guessing at anything it can't parse.
export function zonedDateTime(timezone: string, input: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(input.trim())
  if (!m) return null
  const [, day, hh, mm] = m
  const hour = hh === undefined ? 12 : Number(hh)
  const min = mm === undefined ? 0 : Number(mm)
  if (hour > 23 || min > 59) return null

  const naive = Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`)
  if (Number.isNaN(naive)) return null
  const first = naive - tzOffsetMinutes(timezone, new Date(naive)) * 60000
  return new Date(naive - tzOffsetMinutes(timezone, new Date(first)) * 60000)
}

// Shift a YYYY-MM-DD string by n days, staying in date-string space.
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

// Today as the *device* would write it — for client components, where the
// browser's own clock is already the user's.
//
// The mistake this replaces is `new Date().toISOString().slice(0, 10)`, which
// looks local and is not: toISOString converts to UTC first, so for anyone
// ahead of Greenwich the first hours of every morning report yesterday.
export function todayLocalISO(at: Date = new Date()): string {
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, "0")
  const d = String(at.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
