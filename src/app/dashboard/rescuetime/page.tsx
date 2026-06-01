"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface RescuetimeLog {
  id: string
  date: string
  productivityScore: number | null
  totalActiveH: number | null
  productiveH: number | null
  neutralH: number | null
  distractingH: number | null
  topCategory: string | null
}

interface RescuetimeData {
  hasKey: boolean
  logs: RescuetimeLog[]
}

function scoreColor(s: number | null) {
  if (s == null) return "text-muted-foreground"
  if (s >= 80) return "text-green-400"
  if (s >= 60) return "text-yellow-400"
  return "text-red-400"
}

function scoreLabel(s: number | null) {
  if (s == null) return "—"
  if (s >= 85) return "Excellent"
  if (s >= 70) return "Good"
  if (s >= 55) return "Fair"
  return "Low"
}

function fmtH(h: number | null) {
  if (h == null) return "—"
  return `${h.toFixed(1)}h`
}

export default function RescueTimePage() {
  const [data, setData] = useState<RescuetimeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [apiKey, setApiKey] = useState("")
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState("")
  const [error, setError] = useState(false)

  function load() {
    setLoading(true)
    setError(false)
    fetch("/api/rescuetime")
      .then(r => r.json())
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function saveKey() {
    if (!apiKey.trim()) return
    setSaving(true)
    const res = await fetch("/api/rescuetime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_key", apiKey }),
    })
    setSaving(false)
    if (res.ok) { setMsg("Connected!"); load() }
    else setMsg("Failed to save key")
  }

  async function sync() {
    setSyncing(true)
    setMsg("")
    const res = await fetch("/api/rescuetime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync" }),
    })
    setSyncing(false)
    const d = await res.json().catch(() => ({}))
    setMsg(res.ok ? `Synced ${d.inserted ?? 0} days` : d.error ?? "Sync failed")
    if (res.ok) load()
  }

  async function disconnect() {
    await fetch("/api/rescuetime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_key" }),
    })
    load()
  }

  if (loading) return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-32 rounded-2xl bg-muted animate-pulse" />)}
    </div>
  )

  if (error) return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="rounded-2xl border border-border bg-card p-10 text-center space-y-3">
        <p className="text-muted-foreground text-sm">Couldn&apos;t load RescueTime data</p>
        <button onClick={load} className="text-sm text-primary underline">Retry</button>
      </div>
    </div>
  )

  if (!data?.hasKey) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded-2xl border border-border bg-card p-10 text-center space-y-4">
          <div className="text-5xl">⏱️</div>
          <h1 className="text-xl font-bold">Connect RescueTime</h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Track your productivity score, focused work hours, and distraction patterns. Get your API key from{" "}
            <span className="text-primary">rescuetime.com/anapi/manage</span>.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 max-w-sm mx-auto mt-2">
            <input
              type="text"
              placeholder="RescueTime API key"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              className="flex-1 rounded-xl border border-border bg-secondary/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <Button onClick={saveKey} disabled={saving || !apiKey.trim()} size="sm">
              {saving ? "Saving…" : "Connect"}
            </Button>
          </div>
          {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        </div>
      </div>
    )
  }

  const logs = data.logs ?? []
  const avgScore = logs.filter(l => l.productivityScore != null).length > 0
    ? Math.round(logs.filter(l => l.productivityScore != null).reduce((s, l) => s + (l.productivityScore ?? 0), 0) / logs.filter(l => l.productivityScore != null).length)
    : null
  const totalProductiveH = logs.reduce((s, l) => s + (l.productiveH ?? 0), 0)
  const totalDistractingH = logs.reduce((s, l) => s + (l.distractingH ?? 0), 0)
  const topCategories: Record<string, number> = {}
  for (const l of logs) {
    if (l.topCategory) topCategories[l.topCategory] = (topCategories[l.topCategory] ?? 0) + 1
  }
  const topCatList = Object.entries(topCategories).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const maxScore = Math.max(...logs.map(l => l.productivityScore ?? 0), 1)
  const recent14 = logs.slice(0, 14).reverse()

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">⏱️ RescueTime</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Productivity analytics — last 30 days</p>
        </div>
        <div className="flex gap-2 items-center">
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          <Button onClick={sync} disabled={syncing} size="sm" variant="outline">
            {syncing ? "Syncing…" : "↻ Sync"}
          </Button>
          <Button onClick={disconnect} size="sm" variant="ghost" className="text-destructive">
            Disconnect
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Avg Score",       value: avgScore != null ? `${avgScore}%` : "—",    color: scoreColor(avgScore), sub: scoreLabel(avgScore) },
          { label: "Productive Time", value: `${totalProductiveH.toFixed(0)}h`,           color: "text-green-400",     sub: `${logs.length} days` },
          { label: "Distracted Time", value: `${totalDistractingH.toFixed(0)}h`,          color: "text-red-400",       sub: "last 30 days" },
          { label: "Days Tracked",    value: `${logs.length}`,                            color: "text-foreground",    sub: "of 30 days" },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Score chart — last 14 days */}
      {recent14.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Productivity Score (last 14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-28">
              {recent14.map(l => {
                const s = l.productivityScore ?? 0
                const pct = (s / 100) * 100
                const color = s >= 80 ? "bg-green-500" : s >= 60 ? "bg-yellow-500" : "bg-red-500"
                return (
                  <div key={l.date} className="flex-1 flex flex-col items-center gap-1" title={`${l.date}: ${s}%`}>
                    <div className="w-full rounded-t-sm transition-all" style={{ height: `${pct}%`, minHeight: 2 }}>
                      <div className={`w-full h-full rounded-t-sm ${color} opacity-80`} />
                    </div>
                    <span className="text-[9px] text-muted-foreground">{l.date.slice(5)}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Time breakdown — last 14 days stacked bars */}
      {recent14.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily Time Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24">
              {recent14.map(l => {
                const total = (l.productiveH ?? 0) + (l.neutralH ?? 0) + (l.distractingH ?? 0)
                const maxH = 10
                const scale = Math.min(1, total / maxH)
                const pPct = total > 0 ? ((l.productiveH ?? 0) / total) * 100 : 0
                const nPct = total > 0 ? ((l.neutralH ?? 0) / total) * 100 : 0
                const dPct = total > 0 ? ((l.distractingH ?? 0) / total) * 100 : 0
                return (
                  <div key={l.date} className="flex-1 flex flex-col items-center gap-1" title={`${l.date}: ${total.toFixed(1)}h`}>
                    <div className="w-full flex flex-col-reverse rounded-t-sm overflow-hidden" style={{ height: `${scale * 100}%`, minHeight: 2 }}>
                      <div className="bg-green-500/70" style={{ height: `${pPct}%` }} />
                      <div className="bg-slate-500/50" style={{ height: `${nPct}%` }} />
                      <div className="bg-red-500/70" style={{ height: `${dPct}%` }} />
                    </div>
                    <span className="text-[9px] text-muted-foreground">{l.date.slice(5)}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full bg-green-500" />Productive</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full bg-slate-500" />Neutral</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full bg-red-500" />Distracting</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top categories + Recent history */}
      <div className="grid sm:grid-cols-2 gap-6">
        {topCatList.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Top Categories</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topCatList.map(([cat, days]) => (
                  <div key={cat} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-sm mb-0.5">
                        <span className="truncate font-medium">{cat}</span>
                        <span className="text-muted-foreground text-xs shrink-0">{days}d</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full bg-primary/60" style={{ width: `${(days / (logs.length || 1)) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {logs.slice(0, 10).map(l => (
                <div key={l.id} className="flex items-center px-4 py-2.5 gap-3 text-sm">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{l.date.slice(5)}</span>
                  <span className={`font-semibold w-10 shrink-0 ${scoreColor(l.productivityScore)}`}>
                    {l.productivityScore != null ? `${l.productivityScore}%` : "—"}
                  </span>
                  <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
                    <span className="text-green-400">{fmtH(l.productiveH)} prod</span>
                    <span className="text-red-400">{fmtH(l.distractingH)} dist</span>
                  </div>
                </div>
              ))}
              {logs.length === 0 && (
                <p className="px-4 py-6 text-sm text-muted-foreground text-center">No data yet — click Sync</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
