"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Plus, Trash2, RefreshCw, ChevronDown, ChevronUp } from "lucide-react"
import { format, parseISO, subDays } from "date-fns"
import {
  ResponsiveContainer, ComposedChart, Area, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts"
import { cn } from "@/lib/utils"

interface Metric {
  id: string
  name: string
  unit: string | null
  type: "number" | "boolean" | "scale"
  color: string
  emoji: string
  minVal: number | null
  maxVal: number | null
}
interface LogEntry { date: string; value: number; note: string | null }

const EMOJI_PICKS = ["📊","😴","⚡","🧠","💪","🍺","☕","💊","🧘","❤️","😣","🔥","💧","🌙","🎯","😤","🤒"]
const COLOR_PICKS = ["#6366f1","#10b981","#f59e0b","#ef4444","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316"]

const TODAY = format(new Date(), "yyyy-MM-dd")

function sparkData(logs: LogEntry[], days = 14) {
  const result: { date: string; value: number | null }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = format(subDays(new Date(), i), "yyyy-MM-dd")
    const entry = logs.find(l => l.date === d)
    result.push({ date: d, value: entry?.value ?? null })
  }
  return result
}

function Sparkline({ logs, color, type }: { logs: LogEntry[]; color: string; type: string }) {
  const data = sparkData(logs, 14).filter(d => d.value != null)
  if (!data.length) return <p className="text-xs text-muted-foreground/50 mt-1">No data yet</p>
  const vals = data.map(d => d.value!)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  return (
    <ResponsiveContainer width="100%" height={40}>
      {type === "boolean"
        ? <ComposedChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <Bar dataKey="value" fill={color} opacity={0.7} radius={[2,2,0,0]} />
          </ComposedChart>
        : <ComposedChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis domain={[Math.max(0, min - 1), max + 1]} hide />
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5}
              fill={`url(#sg-${color.replace("#","")})`} dot={false} connectNulls />
          </ComposedChart>
      }
    </ResponsiveContainer>
  )
}

function LogChart({ logs, color, type, metric }: { logs: LogEntry[]; color: string; type: string; metric: Metric }) {
  const data = sparkData(logs, 30)
  const vals = data.filter(d => d.value != null).map(d => d.value!)
  const minY = vals.length ? Math.max(0, Math.min(...vals) - 1) : 0
  const maxY = vals.length ? Math.max(...vals) + 1 : 10
  return (
    <ResponsiveContainer width="100%" height={160}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id={`cg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1e1e2e" />
        <XAxis dataKey="date" hide />
        <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false}
          domain={type === "boolean" ? [0, 1] : [minY, maxY]} />
        <Tooltip
          formatter={(v) => [`${v}${metric.unit ? ` ${metric.unit}` : ""}`, metric.name]}
          contentStyle={{ background: "#13122b", border: `1px solid ${color}40`, borderRadius: 8, fontSize: 12 }}
          labelFormatter={l => { try { return format(parseISO(l as string), "EEE d MMM") } catch { return l as string } }}
        />
        {metric.minVal != null && <ReferenceLine y={metric.minVal} stroke={color} strokeDasharray="4 2" strokeOpacity={0.4} />}
        {metric.maxVal != null && <ReferenceLine y={metric.maxVal} stroke={color} strokeDasharray="4 2" strokeOpacity={0.4} />}
        {type === "boolean"
          ? <Bar dataKey="value" fill={color} opacity={0.7} radius={[3,3,0,0]} />
          : <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2}
              fill={`url(#cg-${color.replace("#","")})`} dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 4 }} connectNulls />
        }
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function MetricCard({
  metric, logs, onLog, onDelete,
}: {
  metric: Metric
  logs: LogEntry[]
  onLog: (metricId: string, value: number, date: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [inputVal, setInputVal] = useState("")
  const [logDate, setLogDate] = useState(TODAY)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const todayLog = logs.find(l => l.date === TODAY)
  const latest = [...logs].sort((a,b) => b.date.localeCompare(a.date))[0]
  const avg7 = (() => {
    const recent = logs.filter(l => l.date >= format(subDays(new Date(), 7), "yyyy-MM-dd"))
    return recent.length ? Math.round(recent.reduce((s,l) => s + l.value, 0) / recent.length * 10) / 10 : null
  })()

  async function doLog() {
    const v = metric.type === "boolean" ? (inputVal === "1" ? 1 : 0) : parseFloat(inputVal)
    if (isNaN(v)) return
    setSaving(true)
    await onLog(metric.id, v, logDate)
    setInputVal("")
    setSaving(false)
  }

  return (
    <Card className="border-border/50 overflow-hidden">
      <div className="h-0.5 w-full" style={{ background: metric.color }} />
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl leading-none">{metric.emoji}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight truncate">{metric.name}</p>
              {metric.unit && <p className="text-[10px] text-muted-foreground/60">{metric.unit}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {latest && (
              <span className="text-lg font-bold tabular-nums" style={{ color: metric.color }}>
                {metric.type === "boolean" ? (latest.value ? "✓" : "✗") : latest.value}
              </span>
            )}
            <button onClick={() => setExpanded(e => !e)} className="text-muted-foreground/50 hover:text-foreground p-1">
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <Sparkline logs={logs} color={metric.color} type={metric.type} />

        {avg7 != null && (
          <p className="text-[10px] text-muted-foreground/60 mt-1">7-day avg: {avg7}{metric.unit ? ` ${metric.unit}` : ""}</p>
        )}

        {/* Quick log */}
        <div className="flex items-center gap-1.5 mt-3">
          {metric.type === "boolean" ? (
            <>
              <button
                className={cn("flex-1 text-xs py-1.5 rounded-lg border transition-colors",
                  todayLog?.value === 1 ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-border hover:border-primary/30")}
                disabled={saving}
                onClick={async () => { setSaving(true); await onLog(metric.id, 1, TODAY); setSaving(false) }}>
                ✓ Yes
              </button>
              <button
                className={cn("flex-1 text-xs py-1.5 rounded-lg border transition-colors",
                  todayLog?.value === 0 ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-border hover:border-primary/30")}
                disabled={saving}
                onClick={async () => { setSaving(true); await onLog(metric.id, 0, TODAY); setSaving(false) }}>
                ✗ No
              </button>
            </>
          ) : metric.type === "scale" ? (
            <div className="flex gap-1 flex-wrap flex-1">
              {Array.from({ length: (metric.maxVal ?? 10) - (metric.minVal ?? 1) + 1 }, (_, i) => i + (metric.minVal ?? 1)).map(n => (
                <button key={n}
                  onClick={async () => { setSaving(true); await onLog(metric.id, n, TODAY); setSaving(false) }}
                  disabled={saving}
                  className={cn("w-7 h-7 rounded-md text-xs font-medium border transition-colors",
                    todayLog?.value === n
                      ? "border-transparent text-white"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                  style={todayLog?.value === n ? { background: metric.color } : {}}>
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                type="number"
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doLog()}
                placeholder={todayLog != null ? String(todayLog.value) : "Log…"}
                className="flex-1 h-8 px-2.5 text-sm rounded-lg border border-border bg-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40"
              />
              <button onClick={doLog} disabled={saving || !inputVal}
                className="h-8 px-3 text-xs rounded-lg bg-primary/10 text-primary border border-primary/25 hover:bg-primary/20 transition-colors disabled:opacity-40">
                {saving ? "…" : "Log"}
              </button>
            </>
          )}
        </div>

        {/* Expanded chart + history */}
        {expanded && (
          <div className="mt-4 pt-3 border-t border-border/30 space-y-3">
            <LogChart logs={logs} color={metric.color} type={metric.type} metric={metric} />
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {[...logs].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 20).map(l => (
                <div key={l.date} className="flex items-center justify-between text-xs py-1 border-b border-border/20 last:border-0">
                  <span className="text-muted-foreground">{format(parseISO(l.date), "EEE d MMM")}</span>
                  <span className="font-medium tabular-nums">
                    {metric.type === "boolean" ? (l.value ? "✓ Yes" : "✗ No") : `${l.value}${metric.unit ? ` ${metric.unit}` : ""}`}
                  </span>
                </div>
              ))}
            </div>
            <button onClick={() => onDelete(metric.id)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-red-400 transition-colors mt-1">
              <Trash2 className="h-3 w-3" /> Delete metric
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const TYPES = [
  { id: "number", label: "Number", desc: "Free-form number (e.g. 7.4h, 3 cups)" },
  { id: "scale",  label: "Scale",  desc: "Rating 1–5 or 1–10" },
  { id: "boolean",label: "Yes/No", desc: "Did it happen today?" },
]

export default function CustomMetricsPage() {
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: "", unit: "", type: "number" as "number" | "boolean" | "scale",
    color: "#6366f1", emoji: "📊", minVal: "1", maxVal: "10",
  })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/custom-metrics")
      const data = await res.json()
      setMetrics(data.metrics ?? [])
      setLogs(data.logsByMetric ?? {})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createMetric() {
    if (!form.name.trim()) return
    setSaving(true)
    await fetch("/api/custom-metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        unit: form.unit.trim() || null,
        type: form.type,
        color: form.color,
        emoji: form.emoji,
        minVal: form.type === "scale" ? Number(form.minVal) : null,
        maxVal: form.type === "scale" ? Number(form.maxVal) : null,
      }),
    })
    setForm({ name: "", unit: "", type: "number", color: "#6366f1", emoji: "📊", minVal: "1", maxVal: "10" })
    setShowForm(false)
    setSaving(false)
    load()
  }

  async function logValue(metricId: string, value: number, date: string) {
    await fetch("/api/custom-metrics/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metricId, value, date }),
    })
    setLogs(prev => {
      const existing = (prev[metricId] ?? []).filter(l => l.date !== date)
      return { ...prev, [metricId]: [...existing, { date, value, note: null }] }
    })
  }

  async function deleteMetric(id: string) {
    await fetch("/api/custom-metrics", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    load()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-2xl">📐</span> Custom Trackers
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track anything — energy, headaches, alcohol, meditation. Logs feed into the Insights correlations engine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} disabled={loading}
            className="flex items-center gap-1.5 h-8 px-3 text-sm rounded-lg bg-secondary/80 border border-border hover:bg-accent transition-colors disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={() => setShowForm(s => !s)}
            className="flex items-center gap-1.5 h-8 px-3 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            <Plus className="h-3.5 w-3.5" /> New tracker
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="border-primary/25 bg-primary/3">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">New tracker</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Name + emoji */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="space-y-1 flex-1 min-w-0">
                <label className="text-xs text-muted-foreground">Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Energy level, Headache, Alcohol units"
                  className="w-full h-9 px-3 text-sm rounded-lg border border-border bg-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
              <div className="space-y-1 w-full sm:w-28">
                <label className="text-xs text-muted-foreground">Unit (optional)</label>
                <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="e.g. cups, mg"
                  className="w-full h-9 px-3 text-sm rounded-lg border border-border bg-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
            </div>

            {/* Type */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Type</label>
              <div className="flex flex-col sm:flex-row gap-2">
                {TYPES.map(t => (
                  <button key={t.id} onClick={() => setForm(f => ({ ...f, type: t.id as typeof f.type }))}
                    className={cn("flex-1 text-left px-3 py-2 rounded-lg border text-xs transition-colors",
                      form.type === t.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/30")}>
                    <p className="font-medium">{t.label}</p>
                    <p className="opacity-60 mt-0.5">{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Scale range */}
            {form.type === "scale" && (
              <div className="flex gap-3">
                <div className="space-y-1 flex-1 sm:flex-none sm:w-24">
                  <label className="text-xs text-muted-foreground">Min</label>
                  <input type="number" value={form.minVal} onChange={e => setForm(f => ({ ...f, minVal: e.target.value }))}
                    className="w-full h-9 px-3 text-sm rounded-lg border border-border bg-secondary/50 focus:outline-none" />
                </div>
                <div className="space-y-1 flex-1 sm:flex-none sm:w-24">
                  <label className="text-xs text-muted-foreground">Max</label>
                  <input type="number" value={form.maxVal} onChange={e => setForm(f => ({ ...f, maxVal: e.target.value }))}
                    className="w-full h-9 px-3 text-sm rounded-lg border border-border bg-secondary/50 focus:outline-none" />
                </div>
              </div>
            )}

            {/* Emoji */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Emoji</label>
              <div className="flex gap-1.5 flex-wrap">
                {EMOJI_PICKS.map(e => (
                  <button key={e} onClick={() => setForm(f => ({ ...f, emoji: e }))}
                    className={cn("w-9 h-9 text-lg rounded-lg border transition-colors",
                      form.emoji === e ? "border-primary bg-primary/10" : "border-border hover:border-primary/30")}>
                    {e}
                  </button>
                ))}
                <input value={form.emoji.length > 2 ? "" : form.emoji} onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))}
                  placeholder="✏️" maxLength={2}
                  className="w-9 h-9 text-center text-lg rounded-lg border border-border bg-secondary/50 focus:outline-none" />
              </div>
            </div>

            {/* Color */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Color</label>
              <div className="flex gap-1.5 flex-wrap items-center">
                {COLOR_PICKS.map(c => (
                  <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                    className={cn("w-7 h-7 rounded-full border-2 transition-all",
                      form.color === c ? "border-white scale-110" : "border-transparent")}
                    style={{ background: c }} />
                ))}
                <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="w-7 h-7 rounded-full border-0 cursor-pointer bg-transparent" />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={createMetric} disabled={saving || !form.name.trim()}
                className="flex-1 h-9 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                {saving ? "Creating…" : "Create tracker"}
              </button>
              <button onClick={() => setShowForm(false)}
                className="px-4 h-9 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && !metrics.length && (
        <p className="text-center text-muted-foreground text-sm py-10">Loading…</p>
      )}

      {/* Empty state */}
      {!loading && metrics.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="pt-10 pb-10 text-center space-y-3">
            <p className="text-4xl">📐</p>
            <p className="text-sm font-medium">No trackers yet</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Create your first custom tracker — energy level, headache intensity, alcohol units, meditation, anything you want to correlate with your health data.
            </p>
            <button onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="h-3.5 w-3.5" /> Create first tracker
            </button>
          </CardContent>
        </Card>
      )}

      {/* Metrics grid */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {metrics.map(m => (
            <MetricCard key={m.id} metric={m} logs={logs[m.id] ?? []}
              onLog={logValue} onDelete={deleteMetric} />
          ))}
        </div>
      )}

      {/* Insights note */}
      {metrics.length > 0 && (
        <p className="text-xs text-muted-foreground/50 text-center pt-2">
          Custom trackers with 7+ entries automatically appear in the{" "}
          <a href="/dashboard/stats" className="underline underline-offset-2 hover:text-muted-foreground">Insights</a> correlations engine.
        </p>
      )}
    </div>
  )
}
