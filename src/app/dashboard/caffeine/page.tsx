"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import { format } from "date-fns"

const COMPOUNDS: Record<string, { label: string; mg: number; emoji: string }> = {
  espresso:      { label: "Espresso",      mg: 63,  emoji: "☕" },
  filter_coffee: { label: "Filter coffee", mg: 140, emoji: "☕" },
  green_tea:     { label: "Green tea",     mg: 30,  emoji: "🍵" },
  black_tea:     { label: "Black tea",     mg: 50,  emoji: "🍵" },
  matcha:        { label: "Matcha",        mg: 70,  emoji: "🍵" },
  energy_drink:  { label: "Energy drink",  mg: 80,  emoji: "⚡" },
  pre_workout:   { label: "Pre-workout",   mg: 200, emoji: "💪" },
  cola:          { label: "Cola (330ml)",  mg: 35,  emoji: "🥤" },
}

const LIMIT_MG = 400

interface CaffeineLog {
  id: string
  compound: string
  caffeineMg: number
  servings: number
  loggedAt: string
}

interface CaffeineData {
  logs: CaffeineLog[]
  totalMg: number
  limitMg: number
}

function progressColor(mg: number): string {
  if (mg < 200) return "bg-green-500"
  if (mg <= 350) return "bg-amber-500"
  return "bg-red-500"
}

export default function CaffeinePage() {
  const [data, setData] = useState<CaffeineData>({ logs: [], totalMg: 0, limitMg: LIMIT_MG })
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const res = await fetch("/api/caffeine")
    if (res.ok) {
      const d = await res.json() as CaffeineData
      setData(d)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  async function handleAdd(compound: string) {
    setAdding(compound)
    const res = await fetch("/api/caffeine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compound, servings: 1 }),
    })
    if (res.ok) {
      const d = await res.json() as CaffeineData
      setData(d)
    }
    setAdding(null)
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    const res = await fetch(`/api/caffeine?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    if (res.ok) {
      await loadData()
    }
    setDeleting(null)
  }

  const pct = Math.min((data.totalMg / LIMIT_MG) * 100, 100)
  const barColor = progressColor(data.totalMg)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            ☕ Caffeine
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track your daily caffeine intake by compound</p>
        </div>
        <div className="ml-auto">
          <Badge
            variant="secondary"
            className={`text-sm font-bold px-3 py-1 ${
              data.totalMg < 200
                ? "bg-green-500/15 text-green-400"
                : data.totalMg <= 350
                ? "bg-amber-500/15 text-amber-400"
                : "bg-red-500/15 text-red-400"
            }`}
          >
            {data.totalMg} mg
          </Badge>
        </div>
      </div>

      {/* Progress bar */}
      <Card className="rounded-2xl border border-border bg-card">
        <CardContent className="pt-4 pb-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Today&apos;s intake</span>
            <span className="font-semibold text-foreground">{data.totalMg} / {LIMIT_MG} mg</span>
          </div>
          <div className="h-3 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground/60">
            <span>0</span>
            <span>200 mg</span>
            <span>350 mg</span>
            <span>{LIMIT_MG} mg</span>
          </div>
        </CardContent>
      </Card>

      {/* Quick-add buttons */}
      <Card className="rounded-2xl border border-border bg-card">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Quick add
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(COMPOUNDS).map(([key, info]) => (
              <Button
                key={key}
                variant="outline"
                size="sm"
                disabled={adding !== null}
                onClick={() => handleAdd(key)}
                className={`flex flex-col h-auto py-3 gap-1 rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all ${
                  adding === key ? "opacity-60" : ""
                }`}
              >
                <span className="text-lg">{info.emoji}</span>
                <span className="text-xs font-medium leading-tight text-center">{info.label}</span>
                <span className="text-[10px] text-muted-foreground">{info.mg} mg</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Today's log */}
      <Card className="rounded-2xl border border-border bg-card">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Today&apos;s log
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-4 space-y-1.5">
          {data.logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No caffeine logged today — use the buttons above to track your intake
            </p>
          ) : (
            data.logs.map(log => {
              const info = COMPOUNDS[log.compound]
              return (
                <div
                  key={log.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/50 bg-secondary/20 text-sm"
                >
                  <span className="text-base shrink-0">{info?.emoji ?? "☕"}</span>
                  <span className="flex-1 font-medium">{info?.label ?? log.compound}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {log.caffeineMg} mg
                  </Badge>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {format(new Date(log.loggedAt), "HH:mm")}
                  </span>
                  <button
                    onClick={() => handleDelete(log.id)}
                    disabled={deleting === log.id}
                    className="text-muted-foreground/50 hover:text-destructive transition-colors disabled:opacity-30 shrink-0"
                    aria-label="Delete entry"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Tips */}
      <p className="text-xs text-muted-foreground/60 text-center px-4">
        Caffeine half-life is ~5h. Last coffee before 2pm avoids sleep disruption.
      </p>
    </div>
  )
}
