// A month at a glance: one mark per day, carrying how the day went.
//
// The app can already say a great deal about a single day and a fair amount
// about a run of them, but it has never been able to show a MONTH. Habits have
// a four-week heatmap, location has a day strip, weight has a sparkline —
// three private languages for the same idea, none of them about the day as a
// whole.
//
// The rule that matters here is the one that keeps coming up: a day nobody
// recorded anything on is UNKNOWN, and must not be drawn as a bad day. An
// empty outline says "nothing here"; a coloured disc says "this is how it
// went". Filling the empty ones with a default would turn every holiday, every
// flat battery and every forgotten evening into evidence.
//
// PURE — no database, no dates beyond string arithmetic, so the grid and the
// wording can be tested without a browser or a clock.

export interface DayFacts {
  /** Local YYYY-MM-DD. */
  date: string
  /** 1–5, or null if none was logged. */
  mood: number | null
  /** 0–100, or null. */
  sleepScore: number | null
  habitsDone: number
  /** How many habits existed to do. 0 means there were none, not that none were done. */
  habitsTotal: number
  /** Symptom entries that day — what puts a dot on the glyph. */
  symptoms: number
  /** A day that has not happened yet. Not the same as one nobody logged. */
  future?: boolean
}

export interface DayGlyph extends DayFacts {
  /** False when the day has nothing at all: drawn as an outline, counted as nothing. */
  recorded: boolean
  /** 0–1, or null when there were no habits to do. */
  habitRatio: number | null
  /** One line, for the title attribute. */
  summary: string
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/** "2026-04-24" → "24 Apr". */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-")
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? "?"}`
}

const MOOD_WORD: Record<number, string> = {
  1: "awful", 2: "bad", 3: "ok", 4: "good", 5: "great",
}

export function dayGlyph(f: DayFacts): DayGlyph {
  // Tomorrow has no habits undone. Counting a day that has not arrived as
  // "0 of 4" is the same error as counting a day with no GPS as a day at
  // home — it turns the absence of a future into a failure in the present.
  if (f.future) {
    return {
      ...f, mood: null, sleepScore: null, habitsDone: 0, habitsTotal: 0, symptoms: 0,
      recorded: false, habitRatio: null,
      summary: `${shortDate(f.date)} — not yet`,
    }
  }

  const recorded =
    f.mood != null || f.sleepScore != null || f.habitsDone > 0 || f.symptoms > 0
  const habitRatio = f.habitsTotal > 0 ? f.habitsDone / f.habitsTotal : null

  const parts: string[] = []
  if (f.mood != null) parts.push(`felt ${MOOD_WORD[f.mood] ?? f.mood}`)
  if (f.sleepScore != null) parts.push(`slept ${f.sleepScore}`)
  if (f.habitsTotal > 0) parts.push(`${f.habitsDone}/${f.habitsTotal} habits`)
  if (f.symptoms > 0) parts.push(`${f.symptoms} symptom${f.symptoms === 1 ? "" : "s"}`)

  return {
    ...f,
    recorded,
    habitRatio,
    summary: parts.length === 0
      ? `${shortDate(f.date)} — nothing recorded`
      : `${shortDate(f.date)} · ${parts.join(" · ")}`,
  }
}

export interface GridCell {
  date: string
  /** False for the leading and trailing days that belong to a neighbouring month. */
  inMonth: boolean
}

/** Days in a month, 1-indexed month. Handles February without a lookup table. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * A calendar grid for `month` ("YYYY-MM"), weeks starting Monday.
 *
 * Padded at both ends with the neighbouring months' days so every row has
 * seven cells — a ragged first row reads as a rendering fault, and the padding
 * days are marked so they can be drawn faintly rather than pretended into the
 * month.
 */
export function monthGrid(month: string): GridCell[] {
  const [y, m] = month.split("-").map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return []

  // 0 = Sunday from getUTCDay; shift so Monday is 0.
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const total = daysInMonth(y, m)

  const cells: GridCell[] = []

  const prevMonth = m === 1 ? 12 : m - 1
  const prevYear = m === 1 ? y - 1 : y
  const prevTotal = daysInMonth(prevYear, prevMonth)
  for (let i = firstWeekday; i > 0; i--) {
    cells.push({ date: iso(prevYear, prevMonth, prevTotal - i + 1), inMonth: false })
  }

  for (let d = 1; d <= total; d++) cells.push({ date: iso(y, m, d), inMonth: true })

  const nextMonth = m === 12 ? 1 : m + 1
  const nextYear = m === 12 ? y + 1 : y
  let d = 1
  while (cells.length % 7 !== 0) {
    cells.push({ date: iso(nextYear, nextMonth, d++), inMonth: false })
  }
  return cells
}

/** Shift "YYYY-MM" by n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number)
  const total = (y * 12 + (m - 1)) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`
}
