// Reading a year without reading 365 lines.
//
// get_health_range returned one line per day and was capped at 90 for it. That
// cap is not where the data ends — Samsung Health and Google Timeline exports
// go back years, and all of it is stored — it is just how much fits in a
// tool result. So the cap was really a rule saying "Emergy may not answer
// questions about last autumn", enforced by payload size.
//
// A long window does not want daily rows anyway. Nobody asks what their
// resting heart rate was on the 14th of October; they ask whether autumn was
// worse than summer, and fifty-two weekly means answer that better than three
// hundred and sixty-five daily ones — the noise is what hides the season.
//
// Weeks start on Monday, matching the month grid and the weekly review, so a
// week means the same thing everywhere in the app.

export interface DailyMetrics {
  /** YYYY-MM-DD */
  date: string
  sleepH: number | null
  restingHR: number | null
  hrv: number | null
  readiness: number | null
  steps: number | null
  mood: number | null
}

export interface WeekRollup {
  /** YYYY-MM-DD of the Monday. */
  weekStart: string
  /** How many days in this week had any data at all. */
  days: number
  sleepH: number | null
  restingHR: number | null
  hrv: number | null
  readiness: number | null
  steps: number | null
  mood: number | null
}

/** Beyond this many days a range is summarised by week rather than by day. */
export const DAILY_MAX_DAYS = 120

/** The Monday of the week a date falls in. */
export function isoWeekStart(dateISO: string): string {
  const t = Date.parse(`${dateISO}T00:00:00Z`)
  if (!Number.isFinite(t)) return dateISO
  const d = new Date(t)
  // getUTCDay is 0 for Sunday, which is six days into a Monday-start week.
  const back = (d.getUTCDay() + 6) % 7
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10)
}

function mean(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (present.length === 0) return null
  return present.reduce((a, b) => a + b, 0) / present.length
}

/**
 * Weekly means, oldest week first.
 *
 * Each metric averages only the days that HAVE it, rather than the days in the
 * week: a ring worn five nights out of seven gives a five-night average, not
 * one silently dragged down by two zeroes. `days` counts the days with any
 * data at all, so a week built from two readings cannot be mistaken for a
 * full one.
 */
export function rollupWeeks(days: DailyMetrics[]): WeekRollup[] {
  const byWeek = new Map<string, DailyMetrics[]>()
  for (const d of days) {
    const key = isoWeekStart(d.date)
    const list = byWeek.get(key) ?? []
    list.push(d)
    byWeek.set(key, list)
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, ds]) => ({
      weekStart,
      days: ds.length,
      sleepH: mean(ds.map(d => d.sleepH)),
      restingHR: mean(ds.map(d => d.restingHR)),
      hrv: mean(ds.map(d => d.hrv)),
      readiness: mean(ds.map(d => d.readiness)),
      steps: mean(ds.map(d => d.steps)),
      mood: mean(ds.map(d => d.mood)),
    }))
}

/** One week as a line, with the metrics that have nothing to say left out. */
export function renderWeek(w: WeekRollup): string {
  const parts: string[] = []
  if (w.sleepH != null) parts.push(`sleep ${w.sleepH.toFixed(1)}h`)
  if (w.restingHR != null) parts.push(`restingHR ${Math.round(w.restingHR)}bpm`)
  if (w.hrv != null) parts.push(`HRV ${Math.round(w.hrv)}ms`)
  if (w.readiness != null) parts.push(`readiness ${Math.round(w.readiness)}`)
  if (w.steps != null) parts.push(`steps ${Math.round(w.steps)}`)
  if (w.mood != null) parts.push(`mood ${w.mood.toFixed(1)}/5`)
  return `week of ${w.weekStart} (${w.days}d): ${parts.length ? parts.join(", ") : "nothing recorded"}`
}
