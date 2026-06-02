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
import { RefreshCw, TrendingDown, TrendingUp, DollarSign, Plus, Trash2, ChevronLeft, ChevronRight, CloudDownload, Repeat2, ChevronDown, ChevronUp } from "lucide-react"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts"

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

interface RecurringCharge {
  description: string
  amountCents: number
  currency: string
  occurrences: number
  lastDate: string
  avgIntervalDays: number
  category: string | null
}

interface EmailSub {
  id: string
  service: string
  subject: string
  snippet: string
  date: string
  from: string
}

const CATEGORIES = [
  "Food & Drink", "Transport", "Shopping", "Entertainment",
  "Health", "Bills & Utilities", "Housing", "Income", "Other",
]

const CATEGORY_META: Record<string, { color: string; emoji: string }> = {
  "Food & Drink":    { color: "bg-orange-500", emoji: "🍕" },
  "Transport":       { color: "bg-blue-500",   emoji: "🚗" },
  "Shopping":        { color: "bg-pink-500",   emoji: "🛍️" },
  "Entertainment":   { color: "bg-purple-500", emoji: "🎬" },
  "Health":          { color: "bg-green-500",  emoji: "💊" },
  "Bills & Utilities":{ color: "bg-yellow-500",emoji: "⚡" },
  "Housing":         { color: "bg-teal-500",   emoji: "🏠" },
  "Income":          { color: "bg-emerald-500",emoji: "💰" },
  "Other":           { color: "bg-slate-500",  emoji: "📦" },
  "Uncategorized":   { color: "bg-gray-500",   emoji: "❓" },
}

function formatAmount(milliunits: number) {
  return `€${(Math.abs(milliunits) / 100).toFixed(2)}`
}

function freqLabel(avgDays: number): string {
  if (avgDays <= 10) return "Weekly"
  if (avgDays <= 17) return "Bi-weekly"
  if (avgDays <= 45) return "Monthly"
  return "Yearly"
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
    date: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`,
    payee: "",
    amount: "",
    isExpense: true,
    category: "Other",
    notes: "",
  })
  const [saving, setSaving] = useState(false)
  const [driveSyncing, setDriveSyncing] = useState(false)
  const [monthlyTrend, setMonthlyTrend] = useState<{ month: string; spent: number; income: number }[]>([])
  const [recurring, setRecurring] = useState<RecurringCharge[]>([])
  const [emailSubs, setEmailSubs] = useState<EmailSub[]>([])
  const [subsLoading, setSubsLoading] = useState(false)
  const [subsOpen, setSubsOpen] = useState(true)
  const [trendError, setTrendError] = useState(false)

  useEffect(() => {
    fetch("/api/transactions/monthly")
      .then(r => r.json())
      .then(d => Array.isArray(d) ? setMonthlyTrend(d) : null)
      .catch(() => setTrendError(true))
  }, [])

  async function loadSubscriptions() {
    setSubsLoading(true)
    try {
      const res = await fetch("/api/subscriptions")
      if (res.ok) {
        const data = await res.json()
        setRecurring(data.recurring ?? [])
        setEmailSubs(data.emailSubs ?? [])
      }
    } finally {
      setSubsLoading(false)
    }
  }

  useEffect(() => { loadSubscriptions() }, [])
  const [driveMessage, setDriveMessage] = useState<string | null>(null)

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
      // Try YNAB first; fall back to Actual Budget only if env vars are set
      const ynabStatus = await fetch("/api/ynab/connect").then(r => r.json()).catch(() => ({ connected: false }))
      if (ynabStatus.connected) {
        const res = await fetch("/api/sync/ynab", { method: "POST" })
        const data = await res.json()
        if (res.ok) { setSyncMessage(`Synced ${data.synced} transactions from YNAB`); await loadTransactions() }
        else setSyncMessage(`YNAB: ${data.error ?? "Sync failed"}`)
      } else {
        // Check if Actual Budget is configured before trying
        const res = await fetch("/api/sync/finances", { method: "POST" })
        const data = await res.json()
        if (res.status === 503) {
          // Neither budget source is available
          setSyncMessage("No budget connected — reconnect YNAB in Settings")
        } else if (res.ok) {
          setSyncMessage(`Synced ${data.synced} transactions`)
          if (data.accounts) { setAccountBalances(data.accounts); localStorage.setItem("finance_accounts", JSON.stringify(data.accounts)) }
          await loadTransactions()
        } else {
          setSyncMessage(`Error: ${data.error}`)
        }
      }
    } finally {
      setSyncing(false)
    }
  }

  async function handleDriveSync() {
    setDriveSyncing(true)
    setDriveMessage(null)
    try {
      const res = await fetch("/api/import/drive", { method: "POST" })
      const data = await res.json()
      setDriveMessage(data.message ?? (res.ok ? "Done" : "Error"))
      if (data.imported > 0) await loadTransactions()
    } finally {
      setDriveSyncing(false)
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
    const d = new Date()
    setForm({ date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`, payee: "", amount: "", isExpense: true, category: "Other", notes: "" })
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
  const totalBalance = accountBalances.reduce((sum, a) => sum + a.balance, 0)

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
          {(syncMessage || driveMessage) && (
            <span className="text-xs text-muted-foreground">{driveMessage ?? syncMessage}</span>
          )}
          <Button size="sm" variant="outline" onClick={handleDriveSync} disabled={driveSyncing} className="gap-1">
            <CloudDownload className={`h-4 w-4 ${driveSyncing ? "animate-pulse" : ""}`} />
            Sync Drive
          </Button>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="gap-1">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            Sync
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
              <DollarSign className="h-4 w-4 text-primary" />
              {accountBalances.length > 0 ? "Total Balance" : `Net ${monthLabel(year, month)}`}
            </div>
            <div className={`text-2xl font-bold ${(accountBalances.length > 0 ? totalBalance : net) >= 0 ? "text-green-400" : "text-red-400"}`}>
              {accountBalances.length > 0
                ? `€${(Math.abs(totalBalance) / 100).toFixed(2)}`
                : `${net >= 0 ? "+" : ""}${formatAmount(net)}`}
            </div>
            {accountBalances.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">Connect YNAB or Actual Budget in Settings</p>
            )}
          </CardContent>
        </Card>
      </div>

      {(monthlyTrend.length >= 2 || trendError) && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">6-month spending trend</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">
            {trendError ? (
              <div className="h-[180px] flex items-center justify-center">
                <div className="text-center space-y-1.5">
                  <p className="text-sm text-muted-foreground">Couldn&apos;t load trend data</p>
                  <button onClick={() => { setTrendError(false); fetch("/api/transactions/monthly").then(r => r.json()).then(d => Array.isArray(d) && setMonthlyTrend(d)).catch(() => setTrendError(true)) }} className="text-xs text-primary underline">Retry</button>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthlyTrend.map(m => ({
                  ...m,
                  month: new Date(m.month + "-01").toLocaleDateString("en-US", { month: "short" }),
                }))} margin={{ top: 4, right: 4, left: -10, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke="rgba(128,128,128,0.12)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                    tickFormatter={v => `€${v}`} />
                  <Tooltip
                    formatter={(v) => [`€${Number(v).toFixed(2)}`]}
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="income" name="Income" fill="#10b981" radius={[3, 3, 0, 0]} opacity={0.8} />
                  <Bar dataKey="spent" name="Spent" fill="#f43f5e" radius={[3, 3, 0, 0]} opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Spending by Category</CardTitle></CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <p className="text-muted-foreground text-sm">No spending data</p>
            ) : (
              <div className="space-y-2.5">
                {categories.map(([cat, amt]) => {
                  const pct = (amt / totalSpent) * 100
                  const meta = CATEGORY_META[cat] ?? CATEGORY_META["Other"]
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="flex items-center gap-1.5">
                          <span>{meta.emoji}</span>
                          <span className="truncate max-w-[160px]">{cat}</span>
                        </span>
                        <div className="text-right shrink-0">
                          <span className="text-muted-foreground">{formatAmount(amt)}</span>
                          <span className="text-[10px] text-muted-foreground/60 ml-1">({pct.toFixed(0)}%)</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${meta.color}`} style={{ width: `${pct}%` }} />
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
              <div className="space-y-2 animate-pulse">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 py-2 border-b border-border last:border-0">
                    <div className="h-6 w-6 rounded bg-border shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-3.5 rounded bg-border w-2/3" />
                      <div className="h-3 rounded bg-border w-1/3" />
                    </div>
                    <div className="h-3.5 rounded bg-border w-16" />
                  </div>
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No transactions. Add one manually or sync from Actual Budget.
              </p>
            ) : (
              <div className="space-y-0 max-h-80 overflow-y-auto">
                {transactions.slice(0, 50).map((t) => {
                  const meta = CATEGORY_META[t.category ?? "Uncategorized"] ?? CATEGORY_META["Other"]
                  return (
                    <div key={t.id} className="flex items-center gap-2 py-2 border-b border-border last:border-0">
                      <span className="text-base shrink-0">{meta.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{t.payee ?? "Unknown"}</p>
                        <p className="text-xs text-muted-foreground hidden sm:block">
                          {t.category ?? "—"} · {new Date(t.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </p>
                        <p className="text-xs text-muted-foreground sm:hidden">
                          {new Date(t.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </p>
                      </div>
                      <span className={`text-sm font-medium shrink-0 ${t.amount < 0 ? "text-red-400" : "text-green-400"}`}>
                        {t.amount < 0 ? "-" : "+"}{formatAmount(t.amount)}
                      </span>
                      {!t.actualId && (
                        <button onClick={() => handleDelete(t.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1 shrink-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Recurring & Subscriptions ── */}
      <Card>
        <CardHeader className="pb-2 pt-4 cursor-pointer select-none" onClick={() => setSubsOpen(o => !o)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Repeat2 className="h-4 w-4 text-primary" />
              Recurring &amp; Subscriptions
            </CardTitle>
            <div className="flex items-center gap-2">
              {recurring.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  ~€{(recurring.reduce((s, r) => {
                    const monthly = r.avgIntervalDays <= 10
                      ? (r.amountCents / 100) * 4.33
                      : r.avgIntervalDays <= 17
                        ? (r.amountCents / 100) * 2.17
                        : r.avgIntervalDays <= 45
                          ? r.amountCents / 100
                          : (r.amountCents / 100) / 12
                    return s + monthly
                  }, 0)).toFixed(0)}/mo
                </span>
              )}
              <button
                onClick={e => { e.stopPropagation(); loadSubscriptions() }}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                title="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${subsLoading ? "animate-spin" : ""}`} />
              </button>
              {subsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>

        {subsOpen && (
          <CardContent className="space-y-4">
            {subsLoading && recurring.length === 0 && emailSubs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Analysing transactions…</p>
            ) : (
              <>
                {/* Recurring bank charges */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Bank charges</p>
                  {recurring.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recurring charges detected in the last 90 days.</p>
                  ) : (
                    <div className="space-y-1">
                      {recurring.map((r, i) => (
                        <div key={i} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate capitalize">{r.description}</p>
                            <p className="text-xs text-muted-foreground">
                              {freqLabel(r.avgIntervalDays)} · {r.occurrences}× · last {r.lastDate}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold text-red-400">
                              {r.currency === "EUR" ? "€" : r.currency}{(r.amountCents / 100).toFixed(2)}
                            </p>
                            <p className="text-xs text-muted-foreground">{freqLabel(r.avgIntervalDays).toLowerCase()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Email subscriptions */}
                {emailSubs.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Email subscriptions</p>
                    <div className="space-y-1">
                      {emailSubs.slice(0, 10).map(s => (
                        <div key={s.id} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{s.service}</p>
                            <p className="text-xs text-muted-foreground truncate">{s.subject}</p>
                          </div>
                          <p className="text-xs text-muted-foreground shrink-0">{new Date(s.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}
