"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Scale, TrendingDown, TrendingUp, Minus, RefreshCw } from "lucide-react"
import { format, parseISO } from "date-fns"
import {
  ResponsiveContainer, ComposedChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts"
import { cn } from "@/lib/utils"

interface WeightEntry { date: string; weight: number }

const RANGES = [
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
]

function delta(current: number | null, prev: number | null) {
  if (current == null || prev == null) return null
  return Math.round((current - prev) * 10) / 10
}

function TrendBadge({ diff }: { diff: number | null }) {
  if (diff == null) return <span className="text-muted-foreground text-xs">—</span>
  if (Math.abs(diff) < 0.1) return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground"><Minus className="h-3 w-3" /> no change</span>
  )
  const down = diff < 0
  return (
    <span className={cn("flex items-center gap-1 text-xs font-medium", down ? "text-green-400" : "text-orange-400")}>
      {down ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
      {diff > 0 ? "+" : ""}{diff} kg
    </span>
  )
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: {value: number}[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold mb-1">{label}</p>
      <p className="text-blue-400">{payload[0].value.toFixed(1)} kg</p>
    </div>
  )
}

export default function WeightPage() {
  const [entries, setEntries] = useState<WeightEntry[]>([])
  const [range, setRange] = useState(90)
  const [loading, setLoading] = useState(true)
  const [inputWeight, setInputWeight] = useState("")
  const [inputDate, setInputDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const load = useCallback(async (days = range) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/weight?days=${days}`)
      const data = await res.json()
      setEntries(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { load() }, [load])

  function switchRange(days: number) {
    setRange(days)
    load(days)
  }

  async function logWeight() {
    const w = parseFloat(inputWeight)
    if (!w || w < 20 || w > 300) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch("/api/weight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weight: w, date: inputDate }),
      })
      if (res.ok) {
        setSaveMsg("Saved!")
        setInputWeight("")
        await load()
      } else {
        setSaveMsg("Error saving")
      }
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 2500)
    }
  }

  const latest     = entries.length ? entries[entries.length - 1].weight : null
  const weekAgo    = entries.findLast(e => e.date <= format(new Date(Date.now() - 7  * 864e5), "yyyy-MM-dd"))?.weight ?? null
  const monthAgo   = entries.findLast(e => e.date <= format(new Date(Date.now() - 30 * 864e5), "yyyy-MM-dd"))?.weight ?? null
  const allTime    = entries.length ? entries[0].weight : null

  const weekDiff  = delta(latest, weekAgo)
  const monthDiff = delta(latest, monthAgo)
  const totalDiff = delta(latest, allTime)

  const chartMin  = entries.length ? Math.min(...entries.map(e => e.weight)) - 1 : 50
  const chartMax  = entries.length ? Math.max(...entries.map(e => e.weight)) + 1 : 100

  const goalWeight: number | null = null // future: user-settable

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scale className="h-6 w-6 text-blue-400" /> Weight
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Body weight history from Oura sync &amp; manual entry</p>
        </div>
        <button onClick={() => load()} disabled={loading}
          className="flex items-center gap-1.5 h-8 px-3 text-sm rounded-lg bg-secondary/80 border border-border hover:bg-accent transition-colors disabled:opacity-50">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Current", value: latest != null ? `${latest.toFixed(1)} kg` : "—", sub: null },
          { label: "vs 7 days ago", value: latest != null ? `${latest.toFixed(1)} kg` : "—", sub: <TrendBadge diff={weekDiff} /> },
          { label: "vs 30 days ago", value: latest != null ? `${latest.toFixed(1)} kg` : "—", sub: <TrendBadge diff={monthDiff} /> },
          { label: `vs ${range}d ago`, value: latest != null ? `${latest.toFixed(1)} kg` : "—", sub: <TrendBadge diff={totalDiff} /> },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
              {i === 0
                ? <p className="text-2xl font-bold text-blue-400">{s.value}</p>
                : <>{s.sub}</>
              }
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart + range selector */}
      <Card>
        <CardHeader className="pb-2 pt-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Weight over time</CardTitle>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <button key={r.days} onClick={() => switchRange(r.days)}
                className={cn("px-2.5 py-1 rounded-md text-xs transition-colors",
                  range === r.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
                {r.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
              <Scale className="h-8 w-8 opacity-30" />
              <p>No weight data yet.</p>
              <p className="text-xs opacity-60">Log your first entry below, or sync from Oura if you track weight there.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={entries} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e1e2e" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false}
                  interval="preserveStartEnd"
                  tickFormatter={d => { try { return format(parseISO(d), "d MMM") } catch { return d } }} />
                <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} domain={[chartMin, chartMax]} />
                <Tooltip content={<CustomTooltip />} />
                {goalWeight != null && (
                  <ReferenceLine y={goalWeight} stroke="#10b981" strokeDasharray="4 2" strokeOpacity={0.6}
                    label={{ value: `Goal ${goalWeight}kg`, position: "right", fontSize: 10, fill: "#10b981" }} />
                )}
                <Area type="monotone" dataKey="weight" name="Weight"
                  fill="url(#weightGrad)" stroke="#3b82f6" strokeWidth={2}
                  dot={{ r: 2.5, fill: "#3b82f6", strokeWidth: 0 }}
                  activeDot={{ r: 4, fill: "#3b82f6" }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Log entry */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm">Log weight</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Weight (kg)</label>
              <input
                type="number"
                step="0.1"
                min="20"
                max="300"
                value={inputWeight}
                onChange={e => setInputWeight(e.target.value)}
                onKeyDown={e => e.key === "Enter" && logWeight()}
                placeholder="e.g. 75.4"
                className="h-9 w-32 px-3 text-sm rounded-lg border border-border bg-secondary/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Date</label>
              <input
                type="date"
                value={inputDate}
                onChange={e => setInputDate(e.target.value)}
                className="h-9 px-3 text-sm rounded-lg border border-border bg-secondary/50 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <button
              onClick={logWeight}
              disabled={saving || !inputWeight}
              className="h-9 px-4 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Log"}
            </button>
            {saveMsg && (
              <span className={cn("text-xs", saveMsg.includes("Error") ? "text-red-400" : "text-green-400")}>
                {saveMsg}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent entries table */}
      {entries.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">Recent entries</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {[...entries].reverse().slice(0, 15).map((e, i, arr) => {
                const prev = arr[i + 1]
                const diff = prev ? delta(e.weight, prev.weight) : null
                return (
                  <div key={e.date} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-sm text-muted-foreground">
                      {format(parseISO(e.date), "EEE, MMM d")}
                    </span>
                    <div className="flex items-center gap-3">
                      {diff != null && <TrendBadge diff={diff} />}
                      <span className="text-sm font-semibold tabular-nums w-16 text-right">{e.weight.toFixed(1)} kg</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
