"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Receipt, RefreshCw, Calendar, AlertCircle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface BillEmail {
  id: string
  sender: string
  senderName: string
  subject: string
  snippet: string
  date: string
  estimatedAmount?: number
  dueDateText?: string
}

export default function BillsPage() {
  const [bills, setBills] = useState<BillEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paid, setPaid] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      return new Set(JSON.parse(localStorage.getItem("paidBills") ?? "[]"))
    }
    return new Set()
  })

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/bills")
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setBills(data.bills ?? [])
    } catch (e: any) {
      setError(e.message ?? "Failed to load bills")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function togglePaid(id: string) {
    setPaid(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem("paidBills", JSON.stringify([...next]))
      return next
    })
  }

  const pending = bills.filter(b => !paid.has(b.id))
  const done = bills.filter(b => paid.has(b.id))

  const totalPending = pending.reduce((s, b) => s + (b.estimatedAmount ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Receipt className="h-6 w-6 text-primary" />
            Bills & Due Dates
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Scanned from your Gmail inbox
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 h-8 px-3 text-sm rounded-lg bg-primary/10 text-primary border border-primary/25 hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-3 pb-3 flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </CardContent>
        </Card>
      )}

      {!error && pending.length > 0 && totalPending > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-3 pb-3 text-sm">
            <span className="text-muted-foreground">Estimated total pending: </span>
            <span className="font-bold text-foreground">€{totalPending.toFixed(2)}</span>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          Scanning Gmail…
        </div>
      )}

      {!loading && !error && bills.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="pt-8 pb-8 text-center space-y-2">
            <Receipt className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No billing emails found</p>
            <p className="text-xs text-muted-foreground/60">
              Gmail is scanned for keywords like "payment due", "invoice", and "direct debit".
            </p>
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">
            Pending ({pending.length})
          </p>
          <div className="space-y-2">
            {pending.map(bill => (
              <BillCard key={bill.id} bill={bill} isPaid={false} onToggle={togglePaid} />
            ))}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">
            Marked Paid ({done.length})
          </p>
          <div className="space-y-2 opacity-50">
            {done.map(bill => (
              <BillCard key={bill.id} bill={bill} isPaid onToggle={togglePaid} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BillCard({ bill, isPaid, onToggle }: {
  bill: BillEmail
  isPaid: boolean
  onToggle: (id: string) => void
}) {
  return (
    <Card className={cn("border-border/50 transition-opacity", isPaid && "opacity-60")}>
      <CardContent className="pt-3 pb-3 flex items-start gap-3">
        <button
          onClick={() => onToggle(bill.id)}
          className={cn(
            "mt-0.5 h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors",
            isPaid
              ? "border-green-500 bg-green-500/20 text-green-400"
              : "border-border hover:border-primary/50"
          )}
        >
          {isPaid && <CheckCircle2 className="h-3.5 w-3.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-medium leading-snug line-clamp-1">{bill.subject}</p>
            {bill.estimatedAmount && (
              <span className="text-sm font-bold text-primary shrink-0">
                €{bill.estimatedAmount.toFixed(2)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{bill.senderName}</p>
          {bill.dueDateText && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-400">
              <Calendar className="h-3 w-3" />
              Due: {bill.dueDateText}
            </div>
          )}
          {bill.snippet && (
            <p className="text-xs text-muted-foreground/60 mt-1 line-clamp-1">{bill.snippet}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
