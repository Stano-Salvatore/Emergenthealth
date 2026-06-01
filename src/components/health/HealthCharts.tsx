"use client"

import { useState, useEffect } from "react"
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
  ComposedChart, Area, Cell,
} from "recharts"

// ── Theme-aware helpers ────────────────────────────────────────────────────────

function readCSSVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function isLight() {
  return document.documentElement.classList.contains("light")
}

function getGrid() {
  if (typeof document === "undefined") return "rgba(255,255,255,0.05)"
  return isLight() ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.05)"
}

function getAxisFill() {
  if (typeof document === "undefined") return "#9ca3af"
  return readCSSVar("--muted-foreground") || (isLight() ? "#6b7280" : "#9ca3af")
}

/** Resolves --primary to its current hex value and re-resolves on theme/accent change. */
function usePrimaryColor() {
  const [color, setColor] = useState(() => {
    if (typeof document === "undefined") return "#6366f1"
    return readCSSVar("--primary") || "#6366f1"
  })

  useEffect(() => {
    const update = () => setColor(readCSSVar("--primary") || "#6366f1")
    update()
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-accent", "data-theme", "class"],
    })
    return () => obs.disconnect()
  }, [])

  return color
}

// ── Tooltip ────────────────────────────────────────────────────────────────────

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "6px 10px", fontSize: 11 }}>
      <p style={{ fontWeight: 600, marginBottom: 2 }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? p.fill }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  )
}

// ── Data types ─────────────────────────────────────────────────────────────────

export interface ChartDay {
  date: string
  sleepH: number | null
  deepMin: number | null
  remMin: number | null
  lightMin: number | null
  awakeMin: number | null
  steps: number | null
  restingHR: number | null
  weight: number | null
  activeMin: number | null
  calories: number | null
  readiness: number | null
  hrv: number | null
  spo2: number | null
  distanceKm: number | null
  breathingRate: number | null
  activityScore: number | null
  stressHigh: number | null
  recoveryHigh: number | null
  sedentaryMin: number | null
  mood: number | null
}

// ── Charts ─────────────────────────────────────────────────────────────────────

export function SleepChart({ data }: { data: ChartDay[] }) {
  const primary = usePrimaryColor()
  const primaryDim = primary + "55"
  const d = [...data].reverse()
  const hasStages = d.some(r => r.deepMin != null || r.remMin != null)
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground font-medium mb-2">Duration (hours) — dashed = 7h goal</p>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={d} barSize={10} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={getGrid()} />
            <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={axis} axisLine={false} tickLine={false} unit="h" domain={[0, 10]} />
            <Tooltip content={<Tip />} />
            <ReferenceLine y={7} stroke={primary} strokeDasharray="4 2" strokeOpacity={0.6} />
            <Bar dataKey="sleepH" name="Sleep" radius={[3, 3, 0, 0]}>
              {d.map((row, i) => (
                <Cell key={i} fill={row.sleepH != null && row.sleepH >= 7 ? primary : primaryDim} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {hasStages && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">Sleep stages (minutes)</p>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={d} barSize={10} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={getGrid()} />
              <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={axis} axisLine={false} tickLine={false} />
              <Tooltip content={<Tip />} />
              <Bar dataKey="deepMin" name="Deep" stackId="s" fill="#4338ca" radius={0} />
              <Bar dataKey="remMin" name="REM" stackId="s" fill="#818cf8" radius={0} />
              <Bar dataKey="lightMin" name="Light" stackId="s" fill="#c7d2fe" radius={0} />
              <Bar dataKey="awakeMin" name="Awake" stackId="s" fill="#f87171" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export function StepsChart({ data, goal = 8000 }: { data: ChartDay[]; goal?: number }) {
  const d = [...data].reverse().filter(r => r.steps != null)
  if (!d.length) return null
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Steps — dashed = {goal.toLocaleString()} goal</p>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={d} barSize={10} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={getGrid()} />
          <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${v / 1000}k` : String(v)} />
          <Tooltip content={<Tip />} />
          <ReferenceLine y={goal} stroke="#22c55e" strokeDasharray="4 2" strokeOpacity={0.6} />
          <Bar dataKey="steps" name="Steps" radius={[3, 3, 0, 0]}>
            {d.map((row, i) => (
              <Cell key={i} fill={row.steps != null && row.steps >= goal ? "#22c55e" : "#22c55e55"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ActivityChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.activeMin != null || r.calories != null)
  if (!d.length) return null
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Active minutes & calories burned</p>
      <ResponsiveContainer width="100%" height={130}>
        <ComposedChart data={d} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
          <CartesianGrid stroke={getGrid()} />
          <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis yAxisId="min" tick={axis} axisLine={false} tickLine={false} />
          <YAxis yAxisId="cal" orientation="right" tick={axis} axisLine={false} tickLine={false} />
          <Tooltip content={<Tip />} />
          <Bar yAxisId="min" dataKey="activeMin" name="Active min" fill="#f59e0b" fillOpacity={0.8} barSize={10} radius={[3, 3, 0, 0]} />
          <Line yAxisId="cal" type="monotone" dataKey="calories" name="Calories" stroke="#fb923c" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function HRChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.restingHR != null)
  if (!d.length) return null
  const vals = d.map(r => r.restingHR!).filter(Boolean)
  const min = Math.min(...vals) - 5
  const max = Math.max(...vals) + 5
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Resting heart rate (bpm)</p>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={d} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={getGrid()} />
          <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} domain={[min, max]} />
          <Tooltip content={<Tip />} />
          <Line type="monotone" dataKey="restingHR" name="HR" stroke="#ef4444" strokeWidth={2} dot={{ r: 2, fill: "#ef4444" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function WeightChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.weight != null)
  if (!d.length) return null
  const vals = d.map(r => r.weight!).filter(Boolean)
  const min = Math.min(...vals) - 1
  const max = Math.max(...vals) + 1
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Weight (kg)</p>
      <ResponsiveContainer width="100%" height={130}>
        <ComposedChart data={d} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
          <defs>
            <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={getGrid()} />
          <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} domain={[min, max]} />
          <Tooltip content={<Tip />} />
          <Area type="monotone" dataKey="weight" name="Weight" fill="url(#wGrad)" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2, fill: "#3b82f6" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ReadinessChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.readiness != null)
  if (!d.length) return null
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Readiness score (0–100)</p>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={d} barSize={10} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={getGrid()} />
          <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} domain={[0, 100]} />
          <Tooltip content={<Tip />} />
          <ReferenceLine y={70} stroke="#10b981" strokeDasharray="4 2" strokeOpacity={0.5} />
          <Bar dataKey="readiness" name="Readiness" radius={[3, 3, 0, 0]}>
            {d.map((row, i) => (
              <Cell key={i} fill={
                row.readiness != null && row.readiness >= 85 ? "#10b981" :
                row.readiness != null && row.readiness >= 70 ? "#10b98188" :
                "#ef444488"
              } />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function HRVChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.hrv != null)
  if (!d.length) return null
  const vals = d.map(r => r.hrv!).filter(Boolean)
  const min = Math.max(0, Math.min(...vals) - 5)
  const max = Math.max(...vals) + 5
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">HRV — heart rate variability (ms)</p>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={d} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={getGrid()} />
          <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} domain={[min, max]} />
          <Tooltip content={<Tip />} />
          <Line type="monotone" dataKey="hrv" name="HRV (ms)" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 2, fill: "#8b5cf6" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function SpO2Chart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.spo2 != null)
  if (!d.length) return null
  const vals = d.map(r => r.spo2!).filter(Boolean)
  const min = Math.max(90, Math.min(...vals) - 1)
  const max = Math.min(100, Math.max(...vals) + 0.5)
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Blood oxygen SpO₂ (%)</p>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={d} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={getGrid()} />
          <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} domain={[min, max]} tickFormatter={v => `${v}%`} />
          <Tooltip content={<Tip />} />
          <ReferenceLine y={95} stroke="#06b6d4" strokeDasharray="4 2" strokeOpacity={0.5} />
          <Line type="monotone" dataKey="spo2" name="SpO₂" stroke="#06b6d4" strokeWidth={2} dot={{ r: 2, fill: "#06b6d4" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ActivityScoreChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.activityScore != null)
  if (!d.length) return null
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Activity score (0–100)</p>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={d} barSize={10} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={getGrid()} />
          <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} domain={[0, 100]} />
          <Tooltip content={<Tip />} />
          <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="4 2" strokeOpacity={0.5} />
          <Bar dataKey="activityScore" name="Activity score" radius={[3, 3, 0, 0]}>
            {d.map((row, i) => (
              <Cell key={i} fill={
                row.activityScore != null && row.activityScore >= 85 ? "#f59e0b" :
                row.activityScore != null && row.activityScore >= 70 ? "#f59e0b88" :
                "#ef444488"
              } />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function StressRecoveryChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.stressHigh != null || r.recoveryHigh != null)
  if (!d.length) return null
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Stress vs recovery (minutes)</p>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={d} barSize={10} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={getGrid()} />
          <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} />
          <Tooltip content={<Tip />} />
          <Bar dataKey="stressHigh" name="High stress" fill="#ef4444" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
          <Bar dataKey="recoveryHigh" name="Recovery" fill="#10b981" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function MoodChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.mood != null)
  if (!d.length) return null
  const MOOD_LABELS: Record<number, string> = { 1: "Awful", 2: "Bad", 3: "OK", 4: "Good", 5: "Great" }
  const MOOD_COLORS: Record<number, string> = { 1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#22c55e", 5: "#10b981" }
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Mood (1–5)</p>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={d} barSize={10} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={getGrid()} />
          <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} domain={[0, 5]} tickFormatter={v => MOOD_LABELS[v as number] ?? ""} />
          <Tooltip content={<Tip />} formatter={(v: any) => [MOOD_LABELS[v as number] ?? v, "Mood"]} />
          <Bar dataKey="mood" name="Mood" radius={[3, 3, 0, 0]}>
            {d.map((row, i) => (
              <Cell key={i} fill={MOOD_COLORS[row.mood!] ?? "#6366f1"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function BreathingRateChart({ data }: { data: ChartDay[] }) {
  const d = [...data].reverse().filter(r => r.breathingRate != null)
  if (!d.length) return null
  const vals = d.map(r => r.breathingRate!).filter(Boolean)
  const min = Math.max(0, Math.min(...vals) - 1)
  const max = Math.max(...vals) + 1
  const axis = { fill: getAxisFill(), fontSize: 10 }
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">Breathing rate during sleep (breaths/min)</p>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={d} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={getGrid()} />
          <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} axisLine={false} tickLine={false} domain={[min, max]} />
          <Tooltip content={<Tip />} />
          <Line type="monotone" dataKey="breathingRate" name="Breaths/min" stroke="#14b8a6" strokeWidth={2} dot={{ r: 2, fill: "#14b8a6" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
