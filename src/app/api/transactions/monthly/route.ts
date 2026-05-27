import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const since = new Date()
  since.setMonth(since.getMonth() - 6)
  since.setDate(1)
  since.setHours(0, 0, 0, 0)

  const transactions = await prisma.transaction.findMany({
    where: { userId, date: { gte: since }, isTransfer: false },
    select: { date: true, amount: true, category: true },
  })

  // Group by YYYY-MM
  const byMonth: Record<string, { spent: number; income: number; byCategory: Record<string, number> }> = {}

  for (const t of transactions) {
    const key = t.date.toISOString().slice(0, 7)
    if (!byMonth[key]) byMonth[key] = { spent: 0, income: 0, byCategory: {} }
    if (t.amount < 0) {
      byMonth[key].spent += Math.abs(t.amount)
      const cat = t.category ?? "Other"
      byMonth[key].byCategory[cat] = (byMonth[key].byCategory[cat] ?? 0) + Math.abs(t.amount)
    } else {
      byMonth[key].income += t.amount
    }
  }

  const months = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      spent: Math.round(data.spent) / 100,
      income: Math.round(data.income) / 100,
      topCategory: Object.entries(data.byCategory).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null,
    }))

  return NextResponse.json(months)
}
