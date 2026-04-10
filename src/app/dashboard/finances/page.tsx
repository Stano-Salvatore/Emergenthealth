"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { RefreshCw, TrendingDown, TrendingUp, DollarSign, Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react"

interface Transaction {
  id: string
  date: string
  amount: number
  payee: string | null
  category: string | null
  accountName: string | null
  isTransfer: boolean
  actualId: string | null
}

interface AccountBalance {
  id: string
  name: string
  balance: number
}

const CATEGORIES = [
  "Food & Drink", "Transport", "Shopping", "Entertainment",
  "Health", "Bills & Utilities", "Housing", "Income", "Other",
]

function formatAmount(milliunits: number) {
  return `€${(Math.abs(milliunits) / 100).toFixed(2)}`
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

export default function FinancesPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accountBalances, setAccountBalances] = useState<AccountBalance[]>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("finance_accounts") ?? "[]") } catch { return [] }
    }
    return []
  })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({
    date: now.toISOString().split("T")[0],
    payee: "",
    amount: "",
    isExpense: true,
    category: "Other",
    notes: "",
  })
  const [saving, setSaving] = useState(false)

  const loadTransactions = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/sync/finances?month=${year}-${String(month).padStart(2, "0")}`)
    if (res.ok) setTransactions(await res.json())
    setLoading(false)
  }, [year, month])

  useEffect(() => { loadTransactions() }, [loadTransactions])

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  async function handleSync() {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const res = await fetch("/api/sync/finances", { method: "POST" })
      const data = await res.json()
      if (res.ok) {
        setSyncMessage(`Synced ${data.synced} transactions`)
        if (data.accounts) {
          setAccountBalances(data.accounts)
          localStorage.setItem("finance_accounts", JSON.stringify(data.accounts))
        }
        await loadTransactions()
      } else {
        setSyncMessage(`Error: ${data.error}`)
      }
    } finally {
      setSyncing(false)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!form.payee.trim() && !form.amount) return
    setSaving(true)
    const amountEuros = form.isExpense
      ? -Math.abs(Number(form.amount))
      : Math.abs(Number(form.amount))
    await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: form.date,
        payee: form.payee || null,
        amountEuros,
        category: form.category,
        notes: form.notes || null,
      }),
    })
    setForm({ date: now.toISOString().split("T")[0], payee: "", amount: "", isExpense: true, category: "Other", notes: "" })
    setFormOpen(false)
    setSaving(false)
    loadTransactions()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/transactions/${id}`, { method: "DELETE" })
    loadTransactions()
  }

  const expenses = transactions.filter((t) => t.amount < 0 && !t.isTransfer)
  const income = transactions.filter((t) => t.amount > 0 && !t.isTransfer)
  const totalSpent = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0)
  const totalIncome = income.reduce((sum, t) => sum + t.amount, 0)
  const net = totalIncome - totalSpent

  const byCategory = expenses.reduce((acc, t) => {
    const cat = t.category ?? "Uncategorized"
    acc[cat] = (acc[cat] ?? 0) + Math.abs(t.amount)
    return acc
  }, {} as Record<string, number>)
  const categories = Object.entries(byCategory).sort(([, a], [, b]) => b - a)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Finances</h1>
          <div className="flex items-center gap-1 mt-0.5">
            <button onClick={prevMonth} className="text-muted-foreground hover:text-foreground p-0.5">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-muted-foreground">{monthLabel(year, month)}</span>
            <button onClick={nextMonth} className="text-muted-foreground hover:text-foreground p-0.5">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {syncMessage && <span className="text-xs text-muted-foreground">{syncMessage}</span>}
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="gap-1">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            Sync Actual
          </Button>
          <Dialog open={formOpen} onOpenChange={setFormOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-w-sm">
              <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
              <form onSubmit={handleAdd} className="space-y-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, isExpense: true }))}
                    className={`flex-1 py-2 rounded-md text-sm border transition-colors ${form.isExpense ? "border-red-400 bg-red-400/10 text-red-400" : "border-border text-muted-foreground"}`}
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, isExpense: false }))}
                    className={`flex-1 py-2 rounded-md text-sm border transition-colors ${!form.isExpense ? "border-green-400 bg-green-400/10 text-green-400" : "border-border text-muted-foreground"}`}
                  >
                    Income
                  </button>
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" className="mt-1" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div>
                  <Label>Payee / Description</Label>
                  <Input className="mt-1" placeholder="e.g. Supermarket" value={form.payee} onChange={e => setForm(f => ({ ...f, payee: e.target.value }))} autoFocus />
                </div>
                <div>
                  <Label>Amount (€)</Label>
                  <Input type="number" step="0.01" min="0" className="mt-1" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <Label>Category</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {CATEGORIES.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, category: c }))}
                        className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${form.category === c ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={saving || !form.amount}>
                  {saving ? "Saving..." : "Add Transaction"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {accountBalances.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Account Balances</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {accountBalances.map((acc) => (
              <Card key={acc.id}>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground truncate mb-1">{acc.name}</p>
                  <p className={`text-lg font-bold ${acc.balance >= 0 ? "text-foreground" : "text-red-400"}`}>
                    {acc.balance < 0 ? "-" : ""}€{(Math.abs(acc.balance) / 100).toFixed(2)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingDown className="h-4 w-4 text-red-400" /> Total Spent
            </div>
            <div className="text-2xl font-bold text-red-400">{formatAmount(totalSpent)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingUp className="h-4 w-4 text-green-400" /> Income
            </div>
            <div className="text-2xl font-bold text-green-400">{formatAmount(totalIncome)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <DollarSign className="h-4 w-4 text-primary" /> Remaining Balance {monthLabel(year, month)}
            </div>
            <div className={`text-2xl font-bold ${net >= 0 ? "text-green-400" : "text-red-400"}`}>
              {net >= 0 ? "+" : ""}{formatAmount(net)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Spending by Category</CardTitle></CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <p className="text-muted-foreground text-sm">No spending data</p>
            ) : (
              <div className="space-y-3">
                {categories.map(([cat, amt]) => {
                  const pct = (amt / totalSpent) * 100
                  return (
                    <div key={cat} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{cat}</span>
                        <span className="text-muted-foreground">{formatAmount(amt)}</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Transactions</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : transactions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No transactions. Add one manually or sync from Actual Budget.
              </p>
            ) : (
              <div className="space-y-0 max-h-80 overflow-y-auto">
                {transactions.slice(0, 50).map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-border last:border-0 gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{t.payee ?? "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.category ?? "—"} · {new Date(t.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <span className={`text-sm font-medium shrink-0 ${t.amount < 0 ? "text-red-400" : "text-green-400"}`}>
                      {t.amount < 0 ? "-" : "+"}{formatAmount(t.amount)}
                    </span>
                    {!t.actualId && (
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1 shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
