// The quarter scale — the honest cousin of Apple's Longevity tab.
//
// No "health age": a synthetic number would conclude what the data has not.
// Instead, the same two moves this app already trusts, stretched to a longer
// horizon: the drift engine judging this quarter against the last (permutation
// test and relevance floor included), and twelve months of plain averages
// where an absent month stays a hole rather than a zero bar.

export interface MonthAvg {
  /** "YYYY-MM". */
  month: string
  /** Hours, one decimal; null when the month recorded no sleep. */
  sleepH: number | null
  steps: number | null
  /** Rows the month is built from. */
  days: number
}

export function monthlyAverages(
  rows: { date: string; sleepDuration: number | null; steps: number | null }[],
): MonthAvg[] {
  const byMonth = new Map<string, { sleep: number[]; steps: number[]; days: number }>()
  for (const r of rows) {
    const month = r.date.slice(0, 7)
    let m = byMonth.get(month)
    if (!m) { m = { sleep: [], steps: [], days: 0 }; byMonth.set(month, m) }
    m.days++
    if (r.sleepDuration != null) m.sleep.push(r.sleepDuration)
    if (r.steps != null) m.steps.push(r.steps)
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => {
      const sleep = avg(m.sleep)
      const steps = avg(m.steps)
      return {
        month,
        sleepH: sleep != null ? Math.round((sleep / 60) * 10) / 10 : null,
        steps: steps != null ? Math.round(steps) : null,
        days: m.days,
      }
    })
}
