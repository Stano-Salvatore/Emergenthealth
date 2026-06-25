"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Timer, UtensilsCrossed, CheckCircle2, XCircle } from "lucide-react"
import { format } from "date-fns"

interface ActiveFast {
  startedAt: string
  targetH: number
}

interface FastRecord {
  startedAt: string
  endedAt: string
  targetH: number
  durationH: number
  completed: boolean
}

const TARGET_OPTIONS = [12, 14, 16, 18, 20, 24]

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600).toString().padStart(2, "0")
  const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0")
  const s = (totalSec % 60).toString().padStart(2, "0")
  return `${h}:${m}:${s}`
}

function formatDuration(h: number): string {
  const hours = Math.floor(h)
  const mins = Math.round((h - hours) * 60)
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

function getLongestStreak(history: FastRecord[]): number {
  if (history.length === 0) return 0
  // Get unique dates with at least one fast
  const dates = new Set(history.map(r => r.startedAt.split("T")[0]))
  const sorted = [...dates].sort()
  let streak = 1
  let best = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diff = (curr.getTime() - prev.getTime()) / 86400000
    if (diff <= 1) {
      streak++
      best = Math.max(best, streak)
    } else {
      streak = 1
    }
  }
  return best
}

export default function FastingPage() {
  const [active, setActive] = useState<ActiveFast | null>(null)
  const [history, setHistory] = useState<FastRecord[]>([])
  const [selectedTarget, setSelectedTarget] = useState(16)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async () => {
    const res = await fetch("/api/fasting")
    if (res.ok) {
      const data = await res.json() as { active: ActiveFast | null; history: FastRecord[] }
      setActive(data.active)
      setHistory(data.history)
      if (data.active) {
        setElapsed(Date.now() - new Date(data.active.startedAt).getTime())
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Live timer
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (active) {
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - new Date(active.startedAt).getTime())
      }, 1000)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [active])

  async function handleStart() {
    setBusy(true)
    const res = await fetch("/api/fasting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", targetH: selectedTarget }),
    })
    if (res.ok) {
      await loadData()
    }
    setBusy(false)
  }

  async function handleStop() {
    setBusy(true)
    const res = await fetch("/api/fasting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    })
    if (res.ok) {
      setActive(null)
      setElapsed(0)
      await loadData()
    }
    setBusy(false)
  }

  async function handleCancel() {
    setBusy(true)
    await fetch("/api/fasting", { method: "DELETE" })
    setActive(null)
    setElapsed(0)
    setBusy(false)
  }

  // Progress calculation
  const targetMs = active ? active.targetH * 3600000 : selectedTarget * 3600000
  const pct = active ? Math.min((elapsed / targetMs) * 100, 100) : 0
  const circumference = 2 * Math.PI * 90
  const ringColor = pct >= 100
    ? "hsl(var(--primary))"
    : pct >= 80
    ? "hsl(45 93% 47%)"
    : "hsl(217 91% 60%)"

  // Stats
  const completed = history.filter(r => r.completed)
  const avgDuration = history.length > 0
    ? history.reduce((a, r) => a + r.durationH, 0) / history.length
    : 0
  const completionRate = history.length > 0
    ? Math.round((completed.length / history.length) * 100)
    : 0
  const longestStreak = getLongestStreak(history)

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
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <UtensilsCrossed className="h-6 w-6 text-primary" />
          Fasting
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">Track your intermittent fasting windows</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Avg duration" value={history.length > 0 ? formatDuration(avgDuration) : "—"} icon="⏱️" />
        <StatCard label="Completion rate" value={history.length > 0 ? `${completionRate}%` : "—"} icon="✅" />
        <StatCard label="Longest streak" value={longestStreak > 0 ? `${longestStreak}d` : "—"} icon="🔥" />
      </div>

      {/* Main timer card */}
      <Card className="rounded-2xl border border-border bg-card">
        <CardContent className="pt-6 pb-6 space-y-6">
          {/* Target selector — only when not fasting */}
          {!active && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">
                Fasting target
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {TARGET_OPTIONS.map(h => (
                  <button
                    key={h}
                    onClick={() => setSelectedTarget(h)}
                    className={`px-4 py-1.5 rounded-full text-sm border transition-all font-medium ${
                      selectedTarget === h
                        ? "bg-primary/15 border-primary/50 text-primary"
                        : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ring + timer */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <svg width="200" height="200" className="-rotate-90">
                <circle
                  cx="100" cy="100" r="90"
                  fill="none" stroke="hsl(var(--secondary))" strokeWidth="8"
                />
                <circle
                  cx="100" cy="100" r="90"
                  fill="none"
                  stroke={active ? ringColor : "hsl(var(--border))"}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference - (circumference * pct) / 100}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                {active ? (
                  <>
                    <span className="text-4xl font-black tabular-nums tracking-tight">
                      {formatElapsed(elapsed)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Target: {active.targetH}h
                    </span>
                    {pct >= 100 && (
                      <span className="text-xs text-primary font-semibold">Goal reached! 🎉</span>
                    )}
                  </>
                ) : (
                  <>
                    <Timer className="h-8 w-8 text-muted-foreground/40" />
                    <span className="text-sm text-muted-foreground">Ready to fast</span>
                  </>
                )}
              </div>
            </div>

            {/* Progress label */}
            {active && (
              <p className="text-xs text-muted-foreground">
                {pct >= 100
                  ? `${formatDuration(elapsed / 3600000)} fasted — target complete`
                  : `${formatDuration(elapsed / 3600000)} / ${active.targetH}h (${Math.round(pct)}%)`
                }
              </p>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-3">
            {!active && (
              <Button onClick={handleStart} disabled={busy} className="gap-2 px-8">
                <Timer className="h-4 w-4" />
                Start Fast
              </Button>
            )}
            {active && (
              <>
                <Button onClick={handleStop} disabled={busy} className="gap-2 px-6">
                  <CheckCircle2 className="h-4 w-4" />
                  End Fast
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                  disabled={busy}
                  className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* History table */}
      {history.length > 0 && (
        <Card className="rounded-2xl border border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Recent fasts
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1.5">
            {history.slice(0, 10).map((r, i) => {
              const hit = r.completed
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/50 bg-secondary/20 text-sm"
                >
                  <span className={hit ? "text-primary" : "text-destructive"}>
                    {hit
                      ? <CheckCircle2 className="h-4 w-4" />
                      : <XCircle className="h-4 w-4" />
                    }
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {format(new Date(r.startedAt), "EEE dd MMM")}
                  </span>
                  <span className="flex-1" />
                  <Badge variant="secondary" className="text-xs shrink-0">
                    Target {r.targetH}h
                  </Badge>
                  <span className={`text-xs font-semibold shrink-0 ${hit ? "text-primary" : "text-amber-400"}`}>
                    {formatDuration(r.durationH)}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <Card className="rounded-2xl border border-border bg-card">
      <CardContent className="pt-3 pb-3 text-center">
        <p className="text-xl mb-0.5">{icon}</p>
        <p className="text-lg font-black">{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}
