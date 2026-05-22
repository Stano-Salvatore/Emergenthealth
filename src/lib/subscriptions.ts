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

    // Only flag if interval looks monthly (20–40 days) or weekly (5–9 days) or yearly (330–395 days)
    const isMonthly = avgInterval >= 20 && avgInterval <= 40
    const isWeekly = avgInterval >= 5 && avgInterval <= 9
    const isYearly = avgInterval >= 330 && avgInterval <= 395
    if (!isMonthly && !isWeekly && !isYearly) continue

    // Check amounts are similar (within 10% of the mean)
    const amounts = sorted.map(t => Math.abs(t.amount))
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length
    const allSimilar = amounts.every(a => Math.abs(a - mean) / mean < 0.1)
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
