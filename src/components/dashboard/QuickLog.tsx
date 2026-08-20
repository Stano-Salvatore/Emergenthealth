"use client"

import { useState } from "react"
import { Droplets, Smile, Scale } from "lucide-react"

const MOOD_EMOJIS = ["😴", "😕", "😐", "🙂", "😄"]
const WATER_PRESETS = [250, 500, 1000]

export function QuickLog({ todayWaterMl, todayMood, latestWeight, waterGoalMl = 2000 }: {
  todayWaterMl: number
  todayMood: number | null
  latestWeight?: number | null
  waterGoalMl?: number
}) {
  const [waterMl, setWaterMl] = useState(todayWaterMl)
  const [mood, setMood] = useState<number | null>(todayMood)
  const [addingWater, setAddingWater] = useState<number | null>(null)
  const [addingMood, setAddingMood] = useState(false)
  const [weightInput, setWeightInput] = useState(latestWeight ? String(latestWeight) : "")
  const [weightSaved, setWeightSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Each write updates the UI only after the server accepted it. The old
  // handlers assumed success: a 500 still filled the water bar, and a network
  // error left the buttons disabled until reload.
  async function addWater(ml: number) {
    setAddingWater(ml)
    setError(null)
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "water", amountMl: ml }),
      })
      if (!res.ok) throw new Error()
      setWaterMl(w => w + ml)
    } catch {
      setError("Couldn't log water — try again.")
    } finally {
      setAddingWater(null)
    }
  }

  async function logMood(value: number) {
    setAddingMood(true)
    setError(null)
    try {
      const res = await fetch("/api/mood", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood: value }),
      })
      if (!res.ok) throw new Error()
      setMood(value)
    } catch {
      setError("Couldn't log mood — try again.")
    } finally {
      setAddingMood(false)
    }
  }

  async function logWeight(e: React.FormEvent) {
    e.preventDefault()
    const kg = parseFloat(weightInput)
    if (!kg || isNaN(kg)) return
    setError(null)
    try {
      const res = await fetch("/api/weight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weight: kg }),
      })
      if (!res.ok) throw new Error()
      setWeightSaved(true)
      setTimeout(() => setWeightSaved(false), 2000)
    } catch {
      setError("Couldn't log weight — try again.")
    }
  }

  const waterPct = Math.min(100, (waterMl / waterGoalMl) * 100)
  const waterDisplay = waterMl >= 1000 ? `${(waterMl/1000).toFixed(1)}L` : `${waterMl}ml`
  const goalDisplay = waterGoalMl % 1000 === 0 ? `${waterGoalMl / 1000}L` : `${(waterGoalMl / 1000).toFixed(1)}L`

  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quick log</p>
      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-1.5 mb-3">{error}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* water */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Droplets className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xs text-muted-foreground">Water</span>
            </div>
            <span className={`text-xs font-semibold ${waterMl >= waterGoalMl ? "text-green-400" : "text-blue-400"}`}>
              {waterDisplay} / {goalDisplay}
            </span>
          </div>
          <div className="h-1 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${waterPct}%` }} />
          </div>
          <div className="flex gap-1.5">
            {WATER_PRESETS.map(ml => (
              <button key={ml} onClick={() => addWater(ml)} disabled={addingWater !== null}
                className="flex-1 text-[10px] py-1.5 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50">
                {addingWater === ml ? "✓" : `+${ml}ml`}
              </button>
            ))}
          </div>
        </div>

        {/* mood */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Smile className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs text-muted-foreground">
              Mood {mood ? `· ${["Awful","Bad","OK","Good","Great"][mood-1]}` : "today"}
            </span>
          </div>
          <div className="flex gap-1 mt-1">
            {MOOD_EMOJIS.map((emoji, i) => {
              const val = i + 1
              return (
                <button key={val} onClick={() => logMood(val)} disabled={addingMood}
                  className={`flex-1 text-base py-0.5 rounded transition-all ${
                    mood === val ? "bg-primary/20 ring-1 ring-primary scale-110" : "hover:bg-secondary"
                  }`}>
                  {emoji}
                </button>
              )
            })}
          </div>
        </div>

        {/* weight */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Scale className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">Weight (kg)</span>
          </div>
          <form onSubmit={logWeight} className="flex gap-1.5 mt-1">
            <input
              type="number" step="0.1" min="30" max="300"
              placeholder={latestWeight ? String(latestWeight) : "kg"}
              value={weightInput}
              onChange={e => setWeightInput(e.target.value)}
              className="flex-1 bg-secondary rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 min-w-0"
            />
            <button type="submit"
              className="px-3 py-1.5 rounded bg-primary/15 text-primary text-xs hover:bg-primary/25 transition-colors shrink-0">
              {weightSaved ? "✓" : "Log"}
            </button>
          </form>
        </div>

      </div>
    </div>
  )
}
