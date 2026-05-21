"use client"

import { useState } from "react"
import { Droplets, Timer, Smile } from "lucide-react"

const MOOD_EMOJIS = ["😴", "😕", "😐", "🙂", "😄"]
const WATER_PRESETS = [250, 500, 1000]

export function QuickLog({ todayWaterMl, todayFocusMin, todayMood }: {
  todayWaterMl: number
  todayFocusMin: number
  todayMood: number | null
}) {
  const [waterMl, setWaterMl] = useState(todayWaterMl)
  const [mood, setMood] = useState<number | null>(todayMood)
  const [addingWater, setAddingWater] = useState<number | null>(null)
  const [addingMood, setAddingMood] = useState(false)

  async function addWater(ml: number) {
    setAddingWater(ml)
    await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "water", amountMl: ml }),
    })
    setWaterMl(w => w + ml)
    setAddingWater(null)
  }

  async function logMood(value: number) {
    setAddingMood(true)
    await fetch("/api/mood", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mood: value }),
    })
    setMood(value)
    setAddingMood(false)
  }

  const waterPct = Math.min(100, (waterMl / 2000) * 100)
  const waterDisplay = waterMl >= 1000 ? `${(waterMl/1000).toFixed(1)}L` : `${waterMl}ml`

  return (
    <div className="rounded-xl border bg-card px-4 py-3 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick log</p>

      {/* water */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Droplets className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-xs text-muted-foreground">Water</span>
          </div>
          <span className={`text-xs font-semibold ${waterMl >= 2000 ? "text-green-400" : "text-blue-400"}`}>
            {waterDisplay}
          </span>
        </div>
        <div className="h-1 bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${waterPct}%` }} />
        </div>
        <div className="flex gap-1.5">
          {WATER_PRESETS.map(ml => (
            <button key={ml} onClick={() => addWater(ml)} disabled={addingWater !== null}
              className="flex-1 text-[10px] py-1 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50">
              {addingWater === ml ? "+" : `+${ml}ml`}
            </button>
          ))}
        </div>
      </div>

      {/* mood */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Smile className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs text-muted-foreground">Mood today</span>
        </div>
        <div className="flex gap-1">
          {MOOD_EMOJIS.map((emoji, i) => {
            const val = i + 1
            return (
              <button key={val} onClick={() => logMood(val)} disabled={addingMood}
                className={`flex-1 text-sm py-0.5 rounded transition-all ${
                  mood === val ? "bg-primary/20 ring-1 ring-primary scale-105" : "hover:bg-secondary"
                }`}>
                {emoji}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
