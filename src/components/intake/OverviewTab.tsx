"use client"

// Overview — the "all of them" tab: water, caffeine, nutrition and vitamins
// for today in one glance, with targets personalized from height & weight.

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, Ruler } from "lucide-react"
import { computeTargets } from "@/lib/targets"
import { todayLocalISO } from "@/lib/local-date"

interface Micronutrient { name: string; amount: number; unit: string; dailyPct: number }
interface FoodLogLite {
  calories: number; proteinG: number | null; carbsG: number | null; fatG: number | null
  sugarG: number | null; micros: Micronutrient[] | null
}
interface Goals { waterMl?: number; weightKg?: number | null; heightCm?: number | null; birthYear?: number | null; sex?: "male" | "female" | null; [k: string]: unknown }

export function OverviewTab({ onGoTo }: { onGoTo: (tab: string) => void }) {
  const [loading, setLoading] = useState(true)
  const [waterMl, setWaterMl] = useState(0)
  const [caffeine, setCaffeine] = useState<{ totalMg: number; activeMg?: number } | null>(null)
  const [food, setFood] = useState<FoodLogLite[]>([])
  const [supplements, setSupplements] = useState<string[]>([])
  const [goals, setGoals] = useState<Goals>({})
  const [latestWeight, setLatestWeight] = useState<number | null>(null)

  // personalize form
  const [showPersonalize, setShowPersonalize] = useState(false)
  const [heightIn, setHeightIn] = useState("")
  const [weightIn, setWeightIn] = useState("")
  const [birthYearIn, setBirthYearIn] = useState("")
  const [sexIn, setSexIn] = useState<"" | "male" | "female">("")
  const [savingProfile, setSavingProfile] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const today = todayLocalISO()
    try {
      const [intakeRes, cafRes, foodRes, goalsRes, weightRes] = await Promise.all([
        fetch(`/api/intake?date=${today}`),
        fetch("/api/caffeine"),
        fetch(`/api/food?date=${today}`),
        fetch("/api/goals"),
        fetch("/api/weight?days=90"),
      ])
      if (intakeRes.ok) {
        const logs: { type: string; amountMl: number }[] = await intakeRes.json()
        setWaterMl(logs.filter(l => l.type === "water" || l.type === "sparkling").reduce((s, l) => s + l.amountMl, 0))
      }
      if (cafRes.ok) setCaffeine(await cafRes.json())
      if (foodRes.ok) {
        const d = await foodRes.json()
        setFood(d.logs ?? [])
        setSupplements(d.supplements ?? [])
      }
      if (goalsRes.ok) setGoals(await goalsRes.json())
      if (weightRes.ok) {
        const rows: { weight: number }[] = await weightRes.json()
        if (rows.length > 0) setLatestWeight(rows[rows.length - 1].weight)
      }
    } catch { /* keep whatever is on screen */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const weightKg = latestWeight ?? (typeof goals.weightKg === "number" ? goals.weightKg : null)
  const heightCm = typeof goals.heightCm === "number" ? goals.heightCm : null
  const birthYear = typeof goals.birthYear === "number" ? goals.birthYear : null
  const sex = goals.sex === "male" || goals.sex === "female" ? goals.sex : null
  const t = computeTargets({ weightKg, heightCm, birthYear, sex })
  // an explicit check-in / goals water target wins over the formula
  const waterGoal = typeof goals.waterMl === "number" && goals.waterMl > 0 ? Math.max(goals.waterMl, t.personalized ? t.waterMl : 0) : t.waterMl

  const totals = food.reduce(
    (a, f) => ({
      calories: a.calories + f.calories,
      proteinG: a.proteinG + (f.proteinG ?? 0),
      sugarG: a.sugarG + (f.sugarG ?? 0),
    }),
    { calories: 0, proteinG: 0, sugarG: 0 },
  )

  const microTotals = new Map<string, { name: string; dailyPct: number }>()
  for (const f of food) {
    for (const m of f.micros ?? []) {
      const key = m.name.toLowerCase()
      const acc = microTotals.get(key)
      if (acc) acc.dailyPct += m.dailyPct
      else microTotals.set(key, { name: m.name, dailyPct: m.dailyPct })
    }
  }
  const topMicros = [...microTotals.values()].sort((a, b) => b.dailyPct - a.dailyPct).slice(0, 6)

  async function savePersonalize() {
    const h = parseFloat(heightIn)
    const w = parseFloat(weightIn)
    setSavingProfile(true)
    try {
      const next = { ...goals }
      if (Number.isFinite(h) && h > 0) next.heightCm = h
      if (Number.isFinite(w) && w > 0) next.weightKg = w
      const by = parseInt(birthYearIn)
      if (Number.isFinite(by) && by >= 1900 && by <= new Date().getFullYear() - 10) next.birthYear = by
      if (sexIn) next.sex = sexIn
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
      if (res.ok) {
        setGoals(next)
        setShowPersonalize(false)
      }
    } finally { setSavingProfile(false) }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-xl border bg-card animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* water */}
      <GoalRow
        emoji="💧" label="Water" onClick={() => onGoTo("intake")}
        value={waterMl} goal={waterGoal}
        display={`${waterMl >= 1000 ? `${(waterMl / 1000).toFixed(1)}L` : `${waterMl}ml`} of ${waterGoal >= 1000 ? `${waterGoal / 1000}L` : `${waterGoal}ml`}`}
        color="bg-blue-500" overIsBad={false}
      />

      {/* caffeine */}
      <GoalRow
        emoji="☕" label="Caffeine" onClick={() => onGoTo("caffeine")}
        value={caffeine?.totalMg ?? 0} goal={t.caffeineMaxMg}
        display={`${caffeine?.totalMg ?? 0} of max ${t.caffeineMaxMg} mg${caffeine?.activeMg ? ` · ≈${caffeine.activeMg} mg active now` : ""}`}
        color="bg-amber-500" overIsBad
      />

      {/* calories & protein */}
      <GoalRow
        emoji="🔥" label="Calories" onClick={() => onGoTo("food")}
        value={totals.calories} goal={t.calories}
        display={`≈${totals.calories} of ≈${t.calories} kcal${t.personalized ? "" : " (default)"}`}
        color="bg-orange-500" overIsBad={false}
      />
      <GoalRow
        emoji="🥩" label="Protein" onClick={() => onGoTo("food")}
        value={Math.round(totals.proteinG)} goal={t.proteinG}
        display={`≈${Math.round(totals.proteinG)} of ${t.proteinG} g`}
        color="bg-rose-500" overIsBad={false}
      />
      {totals.sugarG > 0 && (
        <GoalRow
          emoji="🍬" label="Sugar" onClick={() => onGoTo("food")}
          value={Math.round(totals.sugarG)} goal={t.sugarMaxG}
          display={`≈${Math.round(totals.sugarG)} of max ${t.sugarMaxG} g`}
          color="bg-pink-500" overIsBad
        />
      )}

      {/* vitamins & supplements */}
      {(topMicros.length > 0 || supplements.length > 0) && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Vitamins &amp; supplements today</p>
            <div className="flex flex-wrap gap-1.5">
              {topMicros.map(m => (
                <span key={m.name} className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-400">
                  {m.name} ≈{Math.round(m.dailyPct)}%
                </span>
              ))}
              {supplements.map(s => (
                <span key={s} title="Logged via Oura"
                  className="px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-400">
                  💊 {s}
                </span>
              ))}
            </div>
            {topMicros.length === 0 && supplements.length === 0 ? null : (
              <button onClick={() => onGoTo("food")} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-2">
                From today&apos;s meals and Oura tags →
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* personalize */}
      <div className="rounded-xl border border-border/60 bg-secondary/20 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {t.personalized
              ? <>Targets scaled to your {weightKg} kg{heightCm ? ` · ${heightCm} cm (BMI ${t.bmi})` : ""} — water 35 ml/kg, caffeine 5.7 mg/kg (max 400), protein 1.2 g/kg, ≈{t.calories} kcal {t.calorieBasis === "bmr" ? "maintenance (Mifflin-St Jeor × light activity)" : "rough maintenance — add birth year & sex for a real BMR"}.</>
              : <>Standard targets. Add your height &amp; weight and they scale to your body.</>}
          </p>
          <Button size="sm" variant="ghost" className="gap-1.5 shrink-0 h-7 text-xs" onClick={() => {
            setHeightIn(heightCm ? String(heightCm) : "")
            setWeightIn(weightKg ? String(weightKg) : "")
            setBirthYearIn(birthYear ? String(birthYear) : "")
            setSexIn(sex ?? "")
            setShowPersonalize(v => !v)
          }}>
            <Ruler className="h-3.5 w-3.5" /> {t.personalized ? "Edit" : "Personalize"}
          </Button>
        </div>
        {showPersonalize && (
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <input type="number" inputMode="decimal" placeholder="height cm" value={heightIn}
              onChange={e => setHeightIn(e.target.value)}
              className="w-24 rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary" />
            <input type="number" inputMode="decimal" placeholder="weight kg" value={weightIn}
              onChange={e => setWeightIn(e.target.value)}
              className="w-24 rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary" />
            <input type="number" inputMode="numeric" placeholder="birth year" value={birthYearIn}
              onChange={e => setBirthYearIn(e.target.value)}
              className="w-24 rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary" />
            <div className="flex rounded-lg border overflow-hidden">
              {(["male", "female"] as const).map(s => (
                <button key={s} onClick={() => setSexIn(v => v === s ? "" : s)}
                  className={`px-3 py-1.5 text-xs transition-colors ${sexIn === s ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
                  {s === "male" ? "♂ male" : "♀ female"}
                </button>
              ))}
            </div>
            <Button size="sm" className="h-7 text-xs" onClick={savePersonalize} disabled={savingProfile}>
              {savingProfile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
            {latestWeight != null && (
              <span className="text-[10px] text-muted-foreground">weight auto-syncs from your scale/ring ({latestWeight} kg)</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function GoalRow({ emoji, label, value, goal, display, color, overIsBad, onClick }: {
  emoji: string; label: string; value: number; goal: number; display: string
  color: string; overIsBad: boolean; onClick: () => void
}) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0
  const over = value > goal
  const barColor = over ? (overIsBad ? "bg-red-500" : "bg-green-500") : pct >= 100 ? "bg-green-500" : color
  return (
    <button onClick={onClick} className="w-full text-left rounded-xl border bg-card hover:bg-secondary/30 transition-colors px-4 py-3">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-sm font-medium"><span className="mr-1.5">{emoji}</span>{label}</span>
        <span className="text-xs text-muted-foreground">{display}</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </button>
  )
}
