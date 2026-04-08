"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, TrendingDown, TrendingUp, DollarSign } from "lucide-react"

interface Transaction {
  id: string
  date: string
  amount: number
  payee: string | null
  category: string | null
  accountName: string | null
  isTransfer: boolean
}

function formatAmount(milliunits: number) {
  return `€${(Math.abs(milliunits) / 100).toFixed(2)}`
}

export default function FinancesPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  const loadTransactions = useCallback(async () => {
    setLoading(true)
    const res = await fetch("/api/sync/finances")
    if (res.ok) setTransactions(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  async function handleSync() {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const res = await fetch("/api/sync/finances", { method: "POST" })
      const data = await res.json()
      if (res.ok) {
        setSyncMessage(`Synced ${data.synced} transactions`)
        await loadTransactions()
      } else {
        setSyncMessage(`Error: ${data.error}`)
      }
    } finally {
      setSyncing(false)
    }
  }

  const expenses = transactions.filter((t) => t.amount < 0 && !t.isTransfer)
  const income = transactions.filter((t) => t.amount > 0 && !t.isTransfer)
  const totalSpent = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0)
  const totalIncome = income.reduce((sum, t) => sum + t.amount, 0)

  const byCategory = expenses.reduce(
    (acc, t) => {
      const cat = t.category ?? "Uncategorized"
      acc[cat] = (acc[cat] ?? 0) + Math.abs(t.amount)
      return acc
    },
    {} as Record<string, number>
  )
  const categories = Object.entries(byCategory).sort(([, a], [, b]) => b - a)

  const now = new Date()
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Finances</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {syncMessage && (
            <span className="text-xs text-muted-foreground">{syncMessage}</span>
          )}
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="gap-1">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            Sync Actual
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingDown className="h-4 w-4 text-red-400" />
              Total Spent
            </div>
            <div className="text-2xl font-bold text-red-400">{formatAmount(totalSpent)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingUp className="h-4 w-4 text-green-400" />
              Income
            </div>
            <div className="text-2xl font-bold text-green-400">{formatAmount(totalIncome)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <DollarSign className="h-4 w-4 text-primary" />
              Net
            </div>
            <div
              className={`text-2xl font-bold ${
                totalIncome - totalSpent >= 0 ? "text-green-400" : "text-red-400"
              }`}
            >
              {totalIncome - totalSpent >= 0 ? "+" : ""}
              {formatAmount(totalIncome - totalSpent)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spending by Category</CardTitle>
          </CardHeader>
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
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : transactions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No transactions. Click &quot;Sync Actual&quot; to import.
              </p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin">
                {transactions.slice(0, 30).map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-sm truncate">{t.payee ?? "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.category ?? "—"} · {new Date(t.date).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={`text-sm font-medium shrink-0 ${
                        t.amount < 0 ? "text-red-400" : "text-green-400"
                      }`}
                    >
                      {t.amount < 0 ? "-" : "+"}{formatAmount(t.amount)}
                    </span>
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
