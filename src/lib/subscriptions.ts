export interface RecurringCharge {
  description: string
  amountCents: number
  currency: string
  occurrences: number
  lastDate: string
  avgIntervalDays: number
  category: string | null
}

export function detectRecurringCharges(
  transactions: { amount: number; description: string; date: Date; category?: string | null; currency?: string }[],
): RecurringCharge[] {
  // Only look at spending (negative amounts)
  const spending = transactions.filter(t => t.amount < 0)

  // Group by normalized description
  const groups = new Map<string, typeof spending>()
  for (const t of spending) {
    const key = normalizeDesc(t.description)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }

  const recurring: RecurringCharge[] = []

  for (const [, txns] of groups) {
    if (txns.length < 2) continue

    // Sort by date ascending
    const sorted = [...txns].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // Compute average interval in days
    const intervals: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const days = (new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86400000
      intervals.push(days)
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length

    // Flag weekly (5–10d), biweekly (11–17d), monthly (18–45d), or yearly (330–400d)
    const isWeekly    = avgInterval >= 5  && avgInterval <= 10
    const isBiweekly  = avgInterval >= 11 && avgInterval <= 17
    const isMonthly   = avgInterval >= 18 && avgInterval <= 45
    const isYearly    = avgInterval >= 330 && avgInterval <= 400
    if (!isWeekly && !isBiweekly && !isMonthly && !isYearly) continue

    // Check amounts are similar (within 25% of the mean — allows for tax/FX variation)
    const amounts = sorted.map(t => Math.abs(t.amount))
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length
    const allSimilar = amounts.every(a => Math.abs(a - mean) / mean < 0.25)
    if (!allSimilar) continue

    const last = sorted[sorted.length - 1]
    recurring.push({
      description: last.description,
      amountCents: Math.round(mean),
      currency: (last as any).currency ?? "EUR",
      occurrences: sorted.length,
      lastDate: new Date(last.date).toISOString().split("T")[0],
      avgIntervalDays: Math.round(avgInterval),
      category: (last as any).category ?? null,
    })
  }

  // Sort by amount descending
  return recurring.sort((a, b) => b.amountCents - a.amountCents)
}

function normalizeDesc(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/\d{4,}/g, "") // remove long numbers (ref numbers, dates)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
}
