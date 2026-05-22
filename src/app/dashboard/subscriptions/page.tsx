"use client"

import { useEffect, useState } from "react"
import { format, parseISO } from "date-fns"
import { Mail, RefreshCw, CreditCard, Repeat, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface SubscriptionEmail {
  id: string
  service: string
  subject: string
  snippet: string
  date: string
  from: string
}

interface RecurringCharge {
  description: string
  amountCents: number
  currency: string
  occurrences: number
  lastDate: string
  avgIntervalDays: number
  category: string | null
}

function intervalLabel(days: number) {
  if (days <= 9) return "Weekly"
  if (days <= 40) return "Monthly"
  return "Yearly"
}

function fmt(cents: number, currency = "EUR") {
  return `${currency === "EUR" ? "€" : "$"}${(cents / 100).toFixed(2)}`
}

function monthlyEst(cents: number, intervalDays: number) {
  const multiplier = intervalDays <= 9 ? 4.33 : intervalDays >= 330 ? 1 / 12 : 1
  return Math.round(cents * multiplier)
}

export default function SubscriptionsPage() {
  const [data, setData] = useState<{ emailSubs: SubscriptionEmail[]; recurring: RecurringCharge[] } | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/subscriptions")
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const monthlyTotal = data?.recurring.reduce((sum, r) => sum + monthlyEst(r.amountCents, r.avgIntervalDays), 0) ?? 0

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Subscriptions</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Detected recurring charges + Google Play receipts</p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Monthly summary */}
          {(data?.recurring.length ?? 0) > 0 && (
            <div className="rounded-2xl border p-5 card-finances">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Estimated monthly spend</p>
              <p className="text-4xl font-black tabular-nums text-emerald-400">{fmt(monthlyTotal)}</p>
              <p className="text-xs text-muted-foreground mt-1">{data!.recurring.length} recurring charges detected from last 90 days</p>
            </div>
          )}

          {/* Recurring bank charges */}
          {(data?.recurring.length ?? 0) > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <CreditCard className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-semibold">Recurring Bank Charges</h2>
                <Badge variant="secondary" className="text-xs">{data!.recurring.length}</Badge>
              </div>
              <div className="space-y-2">
                {data!.recurring.map((r, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border px-4 py-3 bg-card hover:bg-secondary/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                        <Repeat className="h-4 w-4 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{r.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{intervalLabel(r.avgIntervalDays)}</Badge>
                          {r.category && <span className="text-[10px] text-muted-foreground">{r.category}</span>}
                          <span className="text-[10px] text-muted-foreground">{r.occurrences}× in 90 days</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-bold tabular-nums">{fmt(r.amountCents, r.currency)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {intervalLabel(r.avgIntervalDays) !== "Monthly"
                          ? `≈ ${fmt(monthlyEst(r.amountCents, r.avgIntervalDays), r.currency)}/mo`
                          : `last ${format(parseISO(r.lastDate), "MMM d")}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Gmail subscription receipts */}
          {(data?.emailSubs.length ?? 0) > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Mail className="h-4 w-4 text-rose-400" />
                <h2 className="text-sm font-semibold">Google Play / Pay Receipts</h2>
                <Badge variant="secondary" className="text-xs">{data!.emailSubs.length}</Badge>
              </div>
              <div className="space-y-2">
                {data!.emailSubs.map(e => (
                  <div key={e.id} className="rounded-xl border px-4 py-3 bg-card hover:bg-secondary/30 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-rose-500/15 flex items-center justify-center shrink-0">
                          <Calendar className="h-4 w-4 text-rose-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{e.service}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{e.subject}</p>
                          {e.snippet && <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">{e.snippet}</p>}
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                        {e.date ? format(new Date(e.date), "MMM d") : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data && data.emailSubs.length === 0 && data.recurring.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Repeat className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No subscriptions detected yet.</p>
              <p className="text-xs mt-1">Connect Gmail and add 90+ days of bank transactions to detect recurring charges.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
