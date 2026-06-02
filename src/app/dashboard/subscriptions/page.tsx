import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserPlan } from "@/lib/plan"
import { detectRecurringCharges } from "@/lib/subscriptions"
import Link from "next/link"
import { ExternalLink } from "lucide-react"

export const metadata: Metadata = { title: "Subscriptions" }

function fmt(cents: number, currency = "EUR") {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100)
}

export default async function SubscriptionsPage() {
  const session = await auth()
  if (!session?.user?.id) return null
  const userId = session.user.id

  const plan = await getUserPlan(userId)

  // Get transactions for recurring charge detection
  const transactions = await prisma.transaction.findMany({
    where: { userId },
    select: { amount: true, payee: true, date: true, category: true },
    orderBy: { date: "desc" },
    take: 500,
  }).catch(() => [])

  const recurring = detectRecurringCharges(
    transactions.map(t => ({
      amount: t.amount,
      description: t.payee ?? "",
      date: t.date,
      category: t.category,
    }))
  ).slice(0, 20)

  const monthlyTotal = recurring
    .filter(r => r.avgIntervalDays >= 18 && r.avgIntervalDays <= 45)
    .reduce((sum, r) => sum + r.amountCents, 0)

  const yearlyTotal = recurring
    .filter(r => r.avgIntervalDays >= 330 && r.avgIntervalDays <= 400)
    .reduce((sum, r) => sum + r.amountCents, 0)

  function intervalLabel(days: number) {
    if (days <= 10) return "Weekly"
    if (days <= 17) return "Bi-weekly"
    if (days <= 45) return "Monthly"
    return "Yearly"
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Subscriptions</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Recurring charges detected from your transaction history
        </p>
      </div>

      {transactions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-muted-foreground text-sm mb-3">No transaction data yet.</p>
          <p className="text-xs text-muted-foreground/60">
            Import your bank transactions via{" "}
            <Link href="/dashboard/settings" className="text-primary hover:underline">
              Settings → CSV Import
            </Link>{" "}
            to detect recurring subscriptions.
          </p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Detected</p>
              <p className="text-2xl font-bold">{recurring.length}</p>
              <p className="text-xs text-muted-foreground">recurring charges</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Monthly cost</p>
              <p className="text-2xl font-bold">{fmt(monthlyTotal)}</p>
              <p className="text-xs text-muted-foreground">avg/month</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Yearly cost</p>
              <p className="text-2xl font-bold">{fmt(monthlyTotal * 12 + yearlyTotal)}</p>
              <p className="text-xs text-muted-foreground">projected/year</p>
            </div>
          </div>

          {/* List */}
          {recurring.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-muted-foreground text-sm">No recurring charges detected.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Need more transaction history — import more CSV data.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="divide-y divide-border/50">
                {recurring.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate capitalize">{r.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {intervalLabel(r.avgIntervalDays)} · {r.occurrences} payments · last {r.lastDate}
                        {r.category && ` · ${r.category}`}
                      </p>
                    </div>
                    <p className="text-sm font-semibold shrink-0 text-red-400">
                      {fmt(r.amountCents, r.currency)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground/60">
            Detected using transaction history. Import more data for better accuracy.
          </p>
        </>
      )}

      {/* Emergenthealth Pro subscription */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Emergenthealth</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {plan === "pro" ? "Pro plan — active" : "Free plan"}
            </p>
          </div>
          {plan === "pro" ? (
            <span className="rounded-full bg-primary/20 text-primary text-xs font-bold px-2.5 py-1">
              Pro
            </span>
          ) : (
            <Link
              href="/pricing"
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              Upgrade <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
