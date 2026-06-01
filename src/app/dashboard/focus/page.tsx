"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"
import { Timer, Play, Pause, RotateCcw, Check, Brain, Coffee, Zap } from "lucide-react"

type Mode = "focus" | "short_break" | "long_break"
type Phase = "idle" | "running" | "paused" | "done"

const PRESETS: { mode: Mode; label: string; min: number; icon: React.ReactNode; color: string }[] = [
  { mode: "focus",       label: "Focus",       min: 25, icon: <Brain className="h-4 w-4" />,  color: "text-primary" },
  { mode: "short_break", label: "Short Break", min: 5,  icon: <Coffee className="h-4 w-4" />, color: "text-green-400" },
  { mode: "long_break",  label: "Long Break",  min: 15, icon: <Zap className="h-4 w-4" />,   color: "text-amber-400" },
]

interface FocusSession {
  id: string
  durationMin: number
  type: Mode
  label: string | null
  startedAt: string
  endedAt: string
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0")
  const s = (seconds % 60).toString().padStart(2, "0")
  return `${m}:${s}`
}

export default function FocusPage() {
  const [mode, setMode] = useState<Mode>("focus")
  const [customMin, setCustomMin] = useState<string>("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [remaining, setRemaining] = useState(25 * 60)
  const [total, setTotal] = useState(25 * 60)
  const [label, setLabel] = useState("")
  const [sessions, setSessions] = useState<FocusSession[]>([])
  const [pomodoroCount, setPomodoroCount] = useState(0)
  const startedAtRef = useRef<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const preset = PRESETS.find(p => p.mode === mode)!

  function getMins() {
    if (customMin && parseInt(customMin) > 0) return parseInt(customMin)
    return preset.min
  }

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/focus?days=7")
    if (res.ok) setSessions(await res.json())
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  // update document title
  useEffect(() => {
    if (phase === "running") {
      document.title = `${formatTime(remaining)} · Focus`
    } else {
      document.title = "Focus · Emergenthealth"
    }
    return () => { document.title = "Emergenthealth" }
  }, [remaining, phase])

  function start() {
    const secs = getMins() * 60
    setTotal(secs)
    setRemaining(secs)
    setPhase("running")
    startedAtRef.current = new Date()
    intervalRef.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          clearInterval(intervalRef.current!)
          setPhase("done")
          return 0
        }
        return r - 1
      })
    }, 1000)
  }

  function pause() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setPhase("paused")
  }

  function resume() {
    setPhase("running")
    intervalRef.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          clearInterval(intervalRef.current!)
          setPhase("done")
          return 0
        }
        return r - 1
      })
    }, 1000)
  }

  function reset() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setPhase("idle")
    setRemaining(getMins() * 60)
    startedAtRef.current = null
  }

  async function complete() {
    if (!startedAtRef.current) return
    const elapsed = Math.round((Date.now() - startedAtRef.current.getTime()) / 60000)
    const durationMin = Math.max(1, elapsed)
    await fetch("/api/focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationMin, type: mode, label: label || null, startedAt: startedAtRef.current.toISOString() }),
    })
    if (mode === "focus") setPomodoroCount(c => c + 1)
    reset()
    loadSessions()
  }

  function selectMode(m: Mode) {
    if (phase !== "idle") return
    setMode(m)
    const p = PRESETS.find(x => x.mode === m)!
    setRemaining(p.min * 60)
    setCustomMin("")
  }

  const pct = total > 0 ? ((total - remaining) / total) * 100 : 0
  const circumference = 2 * Math.PI * 90

  // stats
  const todayStr = new Date().toISOString().split("T")[0]
  const todaySessions = sessions.filter(s => s.endedAt.startsWith(todayStr))
  const todayFocusMin = todaySessions.filter(s => s.type === "focus").reduce((a, s) => a + s.durationMin, 0)
  const weekFocusMin = sessions.filter(s => s.type === "focus").reduce((a, s) => a + s.durationMin, 0)

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Timer className="h-6 w-6 text-primary" /> Focus Timer
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">Pomodoro technique · track deep work</p>
      </div>

      {/* stats strip */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <StatCard label="Today's focus" value={`${todayFocusMin}m`} icon="🧠" />
        <StatCard label="Sessions today" value={String(todaySessions.filter(s => s.type === "focus").length)} icon="✅" />
        <StatCard label="Week total" value={weekFocusMin >= 60 ? `${(weekFocusMin/60).toFixed(1)}h` : `${weekFocusMin}m`} icon="📈" />
      </div>

      {/* timer card */}
      <Card>
        <CardContent className="pt-6 pb-6 space-y-5">
          {/* mode selector */}
          <div className="flex gap-2 justify-center">
            {PRESETS.map(p => (
              <button key={p.mode} onClick={() => selectMode(p.mode)} disabled={phase !== "idle"}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all disabled:cursor-not-allowed ${
                  mode === p.mode ? `bg-primary/10 border-primary/40 ${p.color} font-medium` : "border-border text-muted-foreground hover:bg-secondary"
                }`}>
                {p.icon} {p.label}
              </button>
            ))}
          </div>

          {/* circular timer */}
          <div className="flex justify-center">
            <div className="relative">
              <svg width="200" height="200" className="-rotate-90">
                <circle cx="100" cy="100" r="90" fill="none" stroke="hsl(var(--secondary))" strokeWidth="8" />
                <circle cx="100" cy="100" r="90" fill="none"
                  stroke={phase === "running" || phase === "done" ? "hsl(var(--primary))" : "hsl(var(--border))"}
                  strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference - (circumference * pct) / 100}
                  className="transition-all duration-1000" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-black tabular-nums tracking-tight">
                  {formatTime(remaining)}
                </span>
                <span className="text-xs text-muted-foreground mt-1">{preset.label}</span>
                {pomodoroCount > 0 && (
                  <div className="flex gap-0.5 mt-2">
                    {[...Array(Math.min(pomodoroCount, 8))].map((_, i) => (
                      <div key={i} className="h-1.5 w-1.5 rounded-full bg-primary" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* label input */}
          {phase === "idle" && (
            <div className="px-4">
              <Input placeholder="What are you working on? (optional)"
                value={label} onChange={e => setLabel(e.target.value)}
                className="text-sm text-center border-dashed" />
            </div>
          )}
          {phase !== "idle" && label && (
            <p className="text-center text-sm text-muted-foreground">📌 {label}</p>
          )}

          {/* custom duration */}
          {phase === "idle" && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>Custom:</span>
              <Input type="number" min="1" max="120" placeholder="min"
                value={customMin} onChange={e => setCustomMin(e.target.value)}
                className="w-20 h-7 text-center text-sm" />
              <span>min</span>
            </div>
          )}

          {/* controls */}
          <div className="flex justify-center gap-3">
            {phase === "idle" && (
              <Button onClick={start} className="gap-2 px-8">
                <Play className="h-4 w-4" /> Start
              </Button>
            )}
            {phase === "running" && (
              <>
                <Button variant="outline" onClick={pause} className="gap-2">
                  <Pause className="h-4 w-4" /> Pause
                </Button>
                <Button variant="outline" onClick={reset} size="icon">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </>
            )}
            {phase === "paused" && (
              <>
                <Button onClick={resume} className="gap-2">
                  <Play className="h-4 w-4" /> Resume
                </Button>
                <Button variant="outline" onClick={complete} className="gap-2">
                  <Check className="h-4 w-4" /> Log it
                </Button>
                <Button variant="ghost" onClick={reset} size="icon">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </>
            )}
            {phase === "done" && (
              <div className="text-center space-y-3">
                <p className="text-green-400 font-semibold">Session complete! 🎉</p>
                <div className="flex gap-2 justify-center">
                  <Button onClick={complete} className="gap-2">
                    <Check className="h-4 w-4" /> Log & reset
                  </Button>
                  <Button variant="outline" onClick={reset}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* session history */}
      {sessions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recent sessions</p>
          <div className="space-y-1.5">
            {sessions.slice(0, 10).map(s => {
              const p = PRESETS.find(x => x.mode === s.type) ?? PRESETS[0]
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-card text-sm">
                  <span className={p.color}>{p.icon}</span>
                  <span className="flex-1 truncate text-muted-foreground">{s.label ?? p.label}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">{s.durationMin}m</Badge>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {format(new Date(s.endedAt), "EEE HH:mm")}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3 text-center">
        <p className="text-xl mb-0.5">{icon}</p>
        <p className="text-lg font-black">{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}
