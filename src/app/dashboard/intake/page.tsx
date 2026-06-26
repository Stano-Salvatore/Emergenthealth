"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { format, subDays } from "date-fns"
import { Droplets, Coffee, Wine, Trash2, Plus, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import CaffeinePage from "@/app/dashboard/caffeine/page"

interface IntakeLog {
  id: string
  type: string
  amountMl: number
  note: string | null
  loggedAt: string
}

const QUICK_ADD = [
  { type: "water", label: "Water 250ml", amount: 250, icon: "💧" },
  { type: "water", label: "Water 500ml", amount: 500, icon: "💧" },
  { type: "water", label: "Water 1L", amount: 1000, icon: "🚰" },
  { type: "coffee", label: "Espresso", amount: 30, icon: "☕" },
  { type: "coffee", label: "Americano", amount: 200, icon: "☕" },
  { type: "coffee", label: "Latte", amount: 300, icon: "☕" },
  { type: "tea", label: "Tea", amount: 250, icon: "🍵" },
  { type: "beer",    label: "Beer 330ml", amount: 330, icon: "🍺" },
  { type: "beer",    label: "Beer 500ml", amount: 500, icon: "🍺" },
  { type: "wine",    label: "Wine 150ml", amount: 150, icon: "🍷" },
  { type: "wine",    label: "Wine 250ml", amount: 250, icon: "🍷" },
]

const TYPE_META: Record<string, { label: string; color: string; goal?: number; icon: React.ReactNode }> = {
  water:   { label: "Water",   color: "bg-blue-500",   goal: 2000, icon: <Droplets className="h-4 w-4 text-blue-400" /> },
  coffee:  { label: "Coffee",  color: "bg-amber-700",  goal: 400,  icon: <Coffee className="h-4 w-4 text-amber-600" /> },
  tea:     { label: "Tea",     color: "bg-green-600",              icon: <span className="text-sm">🍵</span> },
  alcohol: { label: "Alcohol", color: "bg-yellow-600",             icon: <Wine className="h-4 w-4 text-yellow-500" /> },
  beer:    { label: "Beer",    color: "bg-yellow-500",             icon: <span className="text-sm">🍺</span> },
  wine:    { label: "Wine",    color: "bg-rose-700",               icon: <span className="text-sm">🍷</span> },
  other:   { label: "Other",   color: "bg-slate-500",              icon: <Plus className="h-4 w-4 text-slate-400" /> },
}

function progressColor(pct: number) {
  if (pct >= 100) return "bg-green-500"
  if (pct >= 60) return "bg-blue-500"
  return "bg-blue-400/60"
}

interface WeekDay {
  date: string
  waterMl: number
  label: string
}

interface OuraEntry {
  id: string
  name: string
  type: string
  emoji: string
  amountMl: number | null
  timestamp: string
}

function localDateStr(d: Date = new Date()): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-")
}

export default function IntakePage() {
  const [activeTab, setActiveTab] = useState<"intake" | "caffeine">("intake")
  const [logs, setLogs] = useState<IntakeLog[]>([])
  const [ouraEntries, setOuraEntries] = useState<OuraEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)
  const [date, setDate] = useState(() => localDateStr())
  const [weekData, setWeekData] = useState<WeekDay[]>([])
  const [waterGoal, setWaterGoal] = useState(2000)
  const isToday = date === localDateStr()

  // Load check-in water goal for today
  useEffect(() => {
    const today = localDateStr()
    fetch(`/api/morning-checkin?date=${today}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.checkin?.waterGoalMl) setWaterGoal(data.checkin.waterGoalMl)
      })
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [logRes, ouraRes] = await Promise.all([
      fetch(`/api/intake?date=${date}`),
      fetch(`/api/intake/oura?date=${date}`),
    ])
    if (logRes.ok) setLogs(await logRes.json())
    if (ouraRes.ok) {
      const d = await ouraRes.json()
      setOuraEntries(d.entries ?? [])
    }
    setLoading(false)
  }, [date])

  useEffect(() => { load() }, [load])

  // Load 7-day water trend (batch single request)
  useEffect(() => {
    async function loadWeek() {
      const today = localDateStr()
      const res = await fetch(`/api/intake?date=${today}&days=7`)
      const byDay: Record<string, number> = res.ok ? await res.json() : {}
      const days: WeekDay[] = []
      for (let i = 6; i >= 0; i--) {
        const d = subDays(new Date(), i)
        const str = localDateStr(d)
        days.push({ date: str, waterMl: byDay[str] ?? 0, label: i === 0 ? "Today" : format(d, "EEE") })
      }
      setWeekData(days)
    }
    loadWeek()
  }, [])

  async function addEntry(type: string, amountMl: number) {
    if ("vibrate" in navigator) navigator.vibrate(20)
    setAdding(`${type}-${amountMl}`)
    await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, amountMl }),
    })
    setAdding(null)
    load()
  }

  async function deleteEntry(id: string) {
    await fetch("/api/intake", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    load()
  }

  function navDate(delta: number) {
    const d = new Date(date + "T12:00:00")
    d.setDate(d.getDate() + delta)
    const next = localDateStr(d)
    if (next <= localDateStr()) setDate(next)
  }

  // aggregate by type
  const totals = logs.reduce((acc, l) => {
    acc[l.type] = (acc[l.type] ?? 0) + l.amountMl
    return acc
  }, {} as Record<string, number>)

  const ouraTotals = ouraEntries.reduce((acc, e) => {
    if (e.amountMl) acc[e.type] = (acc[e.type] ?? 0) + e.amountMl
    return acc
  }, {} as Record<string, number>)

  const waterTotal = (totals.water ?? 0) + (ouraTotals.water ?? 0)
  const coffeeTotal = (totals.coffee ?? 0) + (ouraTotals.coffee ?? 0)
  const teaTotal = (totals.tea ?? 0) + (ouraTotals.tea ?? 0)
  const alcoholTotal = (totals.alcohol ?? 0) + (ouraTotals.alcohol ?? 0)
  const beerTotal = totals.beer ?? 0
  const wineTotal = totals.wine ?? 0

  const dateLabel = isToday ? "Today" : format(new Date(date + "T12:00:00"), "EEE, MMM d")

  return (
    <div className="space-y-5 max-w-2xl">
      {/* header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Droplets className="h-6 w-6 text-blue-400" /> Intake
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Water, coffee & more</p>
        </div>
        {activeTab === "intake" && (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navDate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium w-20 text-center">{dateLabel}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navDate(1)} disabled={isToday}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border">
        {([
          { key: "intake", label: "Intake", emoji: "🥤" },
          { key: "caffeine", label: "Caffeine", emoji: "☕" },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm transition-colors",
              activeTab === t.key
                ? "text-foreground border-b-2 border-primary font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="mr-1">{t.emoji}</span>{t.label}
          </button>
        ))}
      </div>

      {activeTab === "caffeine" ? <CaffeinePage /> : (<>

      {/* summary cards */}
      <div className={`grid gap-3 grid-cols-2 sm:grid-cols-${2 + (teaTotal > 0 ? 1 : 0) + (beerTotal > 0 ? 1 : 0) + (wineTotal > 0 ? 1 : 0) + (alcoholTotal > 0 ? 1 : 0)}`}>
        <SummaryCard label="Water" value={waterTotal} goal={waterGoal} unit="ml" color="text-blue-400" barColor="bg-blue-500" emoji="💧" />
        <SummaryCard label="Coffee" value={coffeeTotal} goal={400} unit="ml" color="text-amber-500" barColor="bg-amber-600" emoji="☕" />
        {teaTotal > 0 && <SummaryCard label="Tea" value={teaTotal} unit="ml" color="text-green-500" barColor="bg-green-600" emoji="🍵" />}
        {beerTotal > 0 && <SummaryCard label="Beer" value={beerTotal} unit="ml" color="text-yellow-400" barColor="bg-yellow-500" emoji="🍺" />}
        {wineTotal > 0 && <SummaryCard label="Wine" value={wineTotal} unit="ml" color="text-rose-400" barColor="bg-rose-700" emoji="🍷" />}
        {alcoholTotal > 0 && <SummaryCard label="Alcohol" value={alcoholTotal} unit="ml" color="text-yellow-500" barColor="bg-yellow-600" emoji="🍷" />}
      </div>

      {/* 7-day water trend */}
      {weekData.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">7-day water trend</p>
          <div className="flex items-end gap-1.5 h-16">
            {weekData.map(d => {
              const pct = Math.min(100, (d.waterMl / waterGoal) * 100)
              const isSelected = d.date === date
              const goalMet = d.waterMl >= waterGoal
              return (
                <button key={d.date} onClick={() => setDate(d.date)}
                  className="flex-1 flex flex-col items-center gap-0.5 group">
                  <div className="w-full flex items-end justify-center h-12">
                    <div
                      className={`w-full rounded-t-sm transition-all ${goalMet ? "bg-blue-500" : isSelected ? "bg-blue-400" : "bg-blue-500/30 group-hover:bg-blue-500/50"}`}
                      style={{ height: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                  <span className={`text-[9px] ${isSelected ? "text-blue-400 font-bold" : "text-muted-foreground"}`}>
                    {d.label}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Goal: {waterGoal >= 1000 ? `${waterGoal / 1000}L` : `${waterGoal}ml`}/day</span>
            <span>{weekData.filter(d => d.waterMl >= waterGoal).length}/7 days ✓</span>
          </div>
        </div>
      )}

      {/* quick add buttons */}
      {isToday && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick add</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_ADD.map(q => {
              const key = `${q.type}-${q.amount}`
              const isAdding = adding === key
              return (
                <button key={key} onClick={() => addEntry(q.type, q.amount)} disabled={!!adding}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-card hover:bg-secondary transition-colors text-sm disabled:opacity-50">
                  <span>{q.icon}</span>
                  <span>{isAdding ? "…" : q.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* log timeline */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {logs.length + ouraEntries.length} {logs.length + ouraEntries.length === 1 ? "entry" : "entries"}
        </p>
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 rounded-xl border bg-card animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 && ouraEntries.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center">
              <Droplets className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No entries for {dateLabel.toLowerCase()}</p>
              {isToday && <p className="text-xs text-muted-foreground mt-1">Use quick add above to log your intake</p>}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {[...logs].reverse().map(log => {
              const meta = TYPE_META[log.type] ?? TYPE_META.other
              return (
                <div key={log.id}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-card hover:bg-secondary/30 transition-colors group">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${meta.color}`} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{meta.label}</span>
                    <span className="text-muted-foreground text-sm"> · {log.amountMl} ml</span>
                    {log.note && <span className="text-xs text-muted-foreground ml-2">({log.note})</span>}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {format(new Date(log.loggedAt), "HH:mm")}
                  </span>
                  <button onClick={() => deleteEntry(log.id)}
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all p-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
            {ouraEntries.map(entry => {
              const meta = TYPE_META[entry.type] ?? TYPE_META.other
              return (
                <div key={entry.id}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border/40 bg-secondary/30">
                  <span className="text-base leading-none shrink-0">{entry.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{entry.name}</span>
                    {entry.amountMl && (
                      <span className="text-muted-foreground text-sm"> · {entry.amountMl} ml</span>
                    )}
                    <span className="text-xs text-muted-foreground/50 ml-2">· Oura Ring</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {format(new Date(entry.timestamp), "HH:mm")}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      </>)}
    </div>
  )
}

function SummaryCard({ label, value, goal, unit, color, barColor, emoji }: {
  label: string; value: number; goal?: number; unit: string; color: string; barColor: string; emoji: string
}) {
  const pct = goal ? Math.min(100, (value / goal) * 100) : null
  const display = value >= 1000 ? `${(value / 1000).toFixed(1)}L` : `${value}ml`
  return (
    <Card>
      <CardContent className="pt-4 pb-3 text-center">
        <p className="text-2xl mb-0.5">{emoji}</p>
        <p className={`text-xl font-black ${color}`}>{display}</p>
        {goal && <p className="text-[10px] text-muted-foreground">of {goal >= 1000 ? `${goal/1000}L` : `${goal}ml`}</p>}
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        {pct !== null && (
          <div className="mt-2 h-1 bg-secondary rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        {pct !== null && pct >= 100 && (
          <Badge className="mt-1.5 text-[9px] px-1.5 py-0 bg-green-500 hover:bg-green-500">Goal ✓</Badge>
        )}
      </CardContent>
    </Card>
  )
}
