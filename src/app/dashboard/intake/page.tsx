"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { format, subDays } from "date-fns"
import { Droplets, Coffee, Wine, Trash2, Plus, ChevronLeft, ChevronRight, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { estimateCaffeine, decayed, hoursToBedtime } from "@/lib/caffeine"
import CaffeinePage from "@/app/dashboard/caffeine/page"
import MedicationsPage from "@/app/dashboard/medications/page"
import { FoodTab } from "@/components/intake/FoodTab"

interface IntakeLog {
  id: string
  type: string
  amountMl: number
  note: string | null
  loggedAt: string
}

interface QuickItem { type: string; label: string; amount: number; icon: string; note?: string }

// Grouped quick-adds. `note` carries strength (beer degrees / ABV) into the log.
const QUICK_GROUPS: { title: string; items: QuickItem[] }[] = [
  {
    title: "Water",
    items: [
      { type: "water",     label: "Water 250ml",     amount: 250,  icon: "💧" },
      { type: "water",     label: "Water 500ml",     amount: 500,  icon: "💧" },
      { type: "water",     label: "Water 1L",        amount: 1000, icon: "🚰" },
      { type: "sparkling", label: "Sparkling 330ml", amount: 330,  icon: "🫧" },
      { type: "sparkling", label: "Sparkling 500ml", amount: 500,  icon: "🫧" },
    ],
  },
  {
    title: "Coffee & tea",
    items: [
      // note doubles as the drink style for the caffeine auto-log
      { type: "coffee", label: "Espresso",   amount: 30,  icon: "☕", note: "Espresso" },
      { type: "coffee", label: "Americano",  amount: 200, icon: "☕", note: "Americano" },
      { type: "coffee", label: "Flat white", amount: 160, icon: "☕", note: "Flat white" },
      { type: "coffee", label: "Latte",      amount: 300, icon: "☕", note: "Latte" },
      { type: "coffee", label: "Cold brew",  amount: 300, icon: "🧊", note: "Cold brew" },
      { type: "coffee", label: "Batch brew", amount: 250, icon: "🫖", note: "Batch brew" },
      { type: "tea",    label: "Tea",        amount: 250, icon: "🍵" },
      { type: "matcha", label: "Matcha",     amount: 250, icon: "🍃" },
    ],
  },
  {
    title: "Alcohol",
    items: [
      { type: "beer",    label: "Beer 330ml",   amount: 330, icon: "🍺" },
      { type: "beer",    label: "Beer 500ml",   amount: 500, icon: "🍺" },
      { type: "beer",    label: "Beer 10°",     amount: 500, icon: "🍺", note: "10°" },
      { type: "beer",    label: "Beer 12°",     amount: 500, icon: "🍺", note: "12°" },
      { type: "beer",    label: "Beer 13°",     amount: 500, icon: "🍺", note: "13°" },
      { type: "beer",    label: "Beer 17°",     amount: 400, icon: "🍻", note: "17°" },
      { type: "wine",    label: "Wine 150ml",   amount: 150, icon: "🍷" },
      { type: "wine",    label: "Wine 250ml",   amount: 250, icon: "🍷" },
      { type: "spirits", label: "Shot 40ml",    amount: 40,  icon: "🥃", note: "40%" },
      { type: "alcohol", label: "Cider 5.5%",   amount: 330, icon: "🍾", note: "5.5%" },
    ],
  },
]

const TYPE_META: Record<string, { label: string; color: string; goal?: number; icon: React.ReactNode }> = {
  water:     { label: "Water",     color: "bg-blue-500",   goal: 2000, icon: <Droplets className="h-4 w-4 text-blue-400" /> },
  sparkling: { label: "Sparkling", color: "bg-cyan-500",               icon: <span className="text-sm">🫧</span> },
  coffee:    { label: "Coffee",    color: "bg-amber-700",  goal: 400,  icon: <Coffee className="h-4 w-4 text-amber-600" /> },
  tea:       { label: "Tea",       color: "bg-green-600",              icon: <span className="text-sm">🍵</span> },
  matcha:    { label: "Matcha",    color: "bg-emerald-500",            icon: <span className="text-sm">🍃</span> },
  alcohol:   { label: "Alcohol",   color: "bg-yellow-600",             icon: <Wine className="h-4 w-4 text-yellow-500" /> },
  beer:      { label: "Beer",      color: "bg-yellow-500",             icon: <span className="text-sm">🍺</span> },
  wine:      { label: "Wine",      color: "bg-rose-700",               icon: <span className="text-sm">🍷</span> },
  spirits:   { label: "Spirits",   color: "bg-purple-500",             icon: <span className="text-sm">🥃</span> },
  other:     { label: "Other",     color: "bg-slate-500",              icon: <Plus className="h-4 w-4 text-slate-400" /> },
}

// Types the custom-entry form offers, and which of them ask for a strength.
const CUSTOM_TYPES = ["water", "sparkling", "coffee", "tea", "matcha", "beer", "wine", "spirits", "alcohol", "other"] as const
const STRENGTH_TYPES = new Set(["beer", "wine", "spirits", "alcohol"])
const CUSTOM_EMOJI: Record<string, string> = {
  water: "💧", sparkling: "🫧", coffee: "☕", tea: "🍵", matcha: "🍃",
  beer: "🍺", wine: "🍷", spirits: "🥃", alcohol: "🍾", other: "🥤",
}

// Literal classes, indexed by how many summary cards are showing.
const SUMMARY_COLS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
  6: "sm:grid-cols-6",
  7: "sm:grid-cols-4",
  8: "sm:grid-cols-4",
  9: "sm:grid-cols-5",
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

function localDateStr(d: Date = new Date()): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-")
}

type Tab = "intake" | "food" | "caffeine" | "meds"

const TAB_META: Record<Tab, { title: string; subtitle: string; icon: string }> = {
  intake:   { title: "Intake",      subtitle: "Water, coffee & more",       icon: "🥤" },
  food:     { title: "Food",        subtitle: "Meals, snapped & analyzed",  icon: "🍽️" },
  caffeine: { title: "Caffeine",    subtitle: "Intake and its half-life",   icon: "☕" },
  meds:     { title: "Medications", subtitle: "Meds & supplements",         icon: "💊" },
}

export default function IntakePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // The tab is part of the address, so refreshing or pressing back keeps you
  // where you were instead of silently returning to Intake.
  const tabParam = searchParams.get("tab")
  const activeTab: Tab = tabParam === "meds" || tabParam === "caffeine" || tabParam === "food" ? tabParam : "intake"

  const setActiveTab = useCallback((tab: Tab) => {
    router.replace(tab === "intake" ? "/dashboard/intake" : `/dashboard/intake?tab=${tab}`, { scroll: false })
  }, [router])

  const [logs, setLogs] = useState<IntakeLog[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)
  const [date, setDate] = useState(() => localDateStr())
  const [weekData, setWeekData] = useState<WeekDay[]>([])
  const [waterGoal, setWaterGoal] = useState(2000)
  const [caffeineMg, setCaffeineMg] = useState<number | null>(null)
  const [lateCoffeeMg, setLateCoffeeMg] = useState<number | null>(null)
  const isToday = date === localDateStr()

  // Today's caffeine total (auto-fed from these drinks) shown on the coffee
  // card. Returns the full state so addEntry can check the bedtime projection.
  const loadCaffeine = useCallback(async () => {
    try {
      const res = await fetch("/api/caffeine")
      if (!res.ok) return null
      const d = await res.json()
      if (typeof d?.totalMg === "number") setCaffeineMg(d.totalMg)
      return d as { totalMg: number; activeMg?: number; halfLifeH?: number }
    } catch { return null }
  }, [])
  useEffect(() => { loadCaffeine() }, [loadCaffeine])

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

  // Oura drinks are mirrored into IntakeLog by the sync, so this one request
  // already carries them. Reading the raw Oura tags here as a *second* source
  // counted every ring-logged drink twice — 300 ml of water showed as 600 —
  // and listed it twice, using a second, English-only tag classifier that
  // disagreed with the shared one.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/intake?date=${date}`)
      if (res.ok) setLogs(await res.json())
    } catch { /* keep whatever is on screen */ }
    finally { setLoading(false) }
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

  async function addEntry(type: string, amountMl: number, note?: string) {
    if ("vibrate" in navigator) navigator.vibrate(20)
    setAdding(`${type}-${amountMl}-${note ?? ""}`)
    await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, amountMl, ...(note ? { note } : {}) }),
    })
    setAdding(null)
    load()
    const caf = await loadCaffeine()
    // Gentle heads-up after a caffeinated drink: how much will still be
    // circulating at 23:00? Informational only — the drink is already logged.
    if (caf?.activeMg && estimateCaffeine(type, note ?? "", amountMl)) {
      const atBed = decayed(caf.activeMg, hoursToBedtime(), caf.halfLifeH ?? 5)
      setLateCoffeeMg(atBed > 50 ? atBed : null)
    }
  }

  // Custom entry: any type, any ml, optional strength (13° / 5.5%) for alcohol
  const [showCustom, setShowCustom]         = useState(false)
  const [customType, setCustomType]         = useState<string>("water")
  const [customMl, setCustomMl]             = useState("")
  const [customStrength, setCustomStrength] = useState("")

  async function addCustom() {
    const ml = parseInt(customMl)
    if (!Number.isFinite(ml) || ml <= 0) return
    const strength = STRENGTH_TYPES.has(customType) ? customStrength.trim() : ""
    await addEntry(customType, ml, strength || undefined)
    setCustomMl("")
    setCustomStrength("")
  }

  async function deleteEntry(id: string) {
    await fetch("/api/intake", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    load()
    loadCaffeine()
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

  const waterTotal     = totals.water ?? 0
  const sparklingTotal = totals.sparkling ?? 0
  const coffeeTotal    = totals.coffee ?? 0
  const teaTotal       = totals.tea ?? 0
  const matchaTotal    = totals.matcha ?? 0
  const alcoholTotal   = totals.alcohol ?? 0
  const beerTotal      = totals.beer ?? 0
  const wineTotal      = totals.wine ?? 0
  const spiritsTotal   = totals.spirits ?? 0

  const cardCount = 2
    + (sparklingTotal > 0 ? 1 : 0) + (teaTotal > 0 ? 1 : 0) + (matchaTotal > 0 ? 1 : 0)
    + (beerTotal > 0 ? 1 : 0) + (wineTotal > 0 ? 1 : 0) + (spiritsTotal > 0 ? 1 : 0) + (alcoholTotal > 0 ? 1 : 0)

  const dateLabel = isToday ? "Today" : format(new Date(date + "T12:00:00"), "EEE, MMM d")

  return (
    <div className="space-y-5 max-w-2xl">
      {/* header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span aria-hidden>{TAB_META[activeTab].icon}</span> {TAB_META[activeTab].title}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{TAB_META[activeTab].subtitle}</p>
        </div>
        {(activeTab === "intake" || activeTab === "food") && (
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

      {/* Tab bar — four tabs now, so let it scroll rather than clip at 390px */}
      <div className="flex border-b border-border overflow-x-auto scrollbar-thin">
        {([
          { key: "intake", label: "Intake", emoji: "🥤" },
          { key: "food", label: "Food", emoji: "🍽️" },
          { key: "caffeine", label: "Caffeine", emoji: "☕" },
          { key: "meds", label: "Medications", emoji: "💊" },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm transition-colors whitespace-nowrap shrink-0",
              activeTab === t.key
                ? "text-foreground border-b-2 border-primary font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="mr-1">{t.emoji}</span>{t.label}
          </button>
        ))}
      </div>

      {activeTab === "meds" ? <MedicationsPage /> : activeTab === "caffeine" ? <CaffeinePage /> : activeTab === "food" ? <FoodTab date={date} isToday={isToday} /> : (<>

      {/* gentle late-caffeine heads-up */}
      {lateCoffeeMg != null && (
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
          <span className="text-base shrink-0">🌙</span>
          <p className="flex-1 text-xs text-amber-400">
            Heads-up: ≈{lateCoffeeMg} mg of caffeine will still be active at 23:00 — it might affect your sleep.
          </p>
          <button onClick={() => setLateCoffeeMg(null)} aria-label="Dismiss"
            className="p-1 rounded-md text-amber-400/60 hover:text-amber-400 transition-colors shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* summary cards */}
      {/* Column count must be a literal class: Tailwind only ships classes it
          can see in the source, so the old built-up `sm:grid-cols-${n}` left
          5- and 6-column layouts with no CSS at all. */}
      <div className={cn("grid gap-3 grid-cols-2", SUMMARY_COLS[cardCount])}>
        <SummaryCard label="Water" value={waterTotal} goal={waterGoal} unit="ml" color="text-blue-400" barColor="bg-blue-500" emoji="💧" />
        <SummaryCard label="Coffee" value={coffeeTotal} goal={400} unit="ml" color="text-amber-500" barColor="bg-amber-600" emoji="☕"
          sub={isToday && caffeineMg != null && caffeineMg > 0 ? `≈${caffeineMg} mg caffeine` : undefined} />
        {sparklingTotal > 0 && <SummaryCard label="Sparkling" value={sparklingTotal} unit="ml" color="text-cyan-400" barColor="bg-cyan-500" emoji="🫧" />}
        {teaTotal > 0 && <SummaryCard label="Tea" value={teaTotal} unit="ml" color="text-green-500" barColor="bg-green-600" emoji="🍵" />}
        {matchaTotal > 0 && <SummaryCard label="Matcha" value={matchaTotal} unit="ml" color="text-emerald-400" barColor="bg-emerald-500" emoji="🍃" />}
        {beerTotal > 0 && <SummaryCard label="Beer" value={beerTotal} unit="ml" color="text-yellow-400" barColor="bg-yellow-500" emoji="🍺" />}
        {wineTotal > 0 && <SummaryCard label="Wine" value={wineTotal} unit="ml" color="text-rose-400" barColor="bg-rose-700" emoji="🍷" />}
        {spiritsTotal > 0 && <SummaryCard label="Spirits" value={spiritsTotal} unit="ml" color="text-purple-400" barColor="bg-purple-500" emoji="🥃" />}
        {alcoholTotal > 0 && <SummaryCard label="Alcohol" value={alcoholTotal} unit="ml" color="text-yellow-500" barColor="bg-yellow-600" emoji="🍾" />}
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
        <div className="space-y-3">
          {QUICK_GROUPS.map(group => (
            <div key={group.title}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{group.title}</p>
              <div className="flex flex-wrap gap-2">
                {group.items.map(q => {
                  const key = `${q.type}-${q.amount}-${q.note ?? ""}`
                  const isAdding = adding === key
                  return (
                    <button key={key} onClick={() => addEntry(q.type, q.amount, q.note)} disabled={!!adding}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-card hover:bg-secondary transition-colors text-sm disabled:opacity-50">
                      <span>{q.icon}</span>
                      <span>{isAdding ? "…" : q.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* custom amount */}
          <div>
            <button onClick={() => setShowCustom(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors">
              <Plus className={cn("h-3.5 w-3.5 transition-transform", showCustom && "rotate-45")} />
              Custom amount
            </button>
            {showCustom && (
              <Card>
                <CardContent className="pt-4 pb-4 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {CUSTOM_TYPES.map(t => (
                      <button key={t} onClick={() => setCustomType(t)}
                        className={cn(
                          "flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs transition-colors",
                          customType === t
                            ? "border-primary bg-primary/10 text-foreground font-medium"
                            : "border-border text-muted-foreground hover:text-foreground"
                        )}>
                        <span>{CUSTOM_EMOJI[t]}</span>
                        {TYPE_META[t]?.label ?? "Other"}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <input type="number" inputMode="numeric" min={1} max={5000} value={customMl}
                        onChange={e => setCustomMl(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addCustom()}
                        placeholder="ml"
                        className="w-24 rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary" />
                      <span className="text-xs text-muted-foreground">ml</span>
                    </div>
                    {STRENGTH_TYPES.has(customType) && (
                      <input value={customStrength}
                        onChange={e => setCustomStrength(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addCustom()}
                        placeholder="strength, e.g. 13° or 5.5%"
                        className="w-44 rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary" />
                    )}
                    <div className="flex gap-1.5">
                      {[100, 200, 330, 500].map(ml => (
                        <button key={ml} onClick={() => setCustomMl(String(ml))}
                          className="px-2 py-1 rounded-md border text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                          {ml}
                        </button>
                      ))}
                    </div>
                    <Button size="sm" onClick={addCustom}
                      disabled={!!adding || !customMl || parseInt(customMl) <= 0}>
                      Add {CUSTOM_EMOJI[customType]}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* log timeline */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {logs.length} {logs.length === 1 ? "entry" : "entries"}
        </p>
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 rounded-xl border bg-card animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
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
                  {/* Entries mirrored from Oura can't be deleted here — the next
                      sync would simply put them back. Fix them in the Oura app. */}
                  {log.id.startsWith("oura_") ? (
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">Oura</span>
                  ) : (
                    <button onClick={() => deleteEntry(log.id)}
                      aria-label={`Delete ${TYPE_META[log.type]?.label ?? "entry"} entry`}
                      className="text-muted-foreground/60 hover:text-destructive transition-colors p-1 shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
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

function SummaryCard({ label, value, goal, unit, color, barColor, emoji, sub }: {
  label: string; value: number; goal?: number; unit: string; color: string; barColor: string; emoji: string; sub?: string
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
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
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
