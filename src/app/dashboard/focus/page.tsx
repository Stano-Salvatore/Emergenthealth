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

const WORK_DURATIONS = [25, 50]
const BREAK_DURATIONS = [5, 10, 15]
const POMODOROS_BEFORE_LONG_BREAK = 4

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

/** Play a gentle two-tone bell using the Web Audio API. */
function playDoneSound() {
  try {
    const ctx = new AudioContext()
    const tones = [880, 1108]
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = "sine"
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.35)
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.35 + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.35 + 0.7)
      osc.start(ctx.currentTime + i * 0.35)
      osc.stop(ctx.currentTime + i * 0.35 + 0.7)
    })
    // Close context after sounds finish
    setTimeout(() => ctx.close(), 2000)
  } catch {
    // Audio API not supported — silently skip
  }
}

export default function FocusPage() {
  const [mode, setMode] = useState<Mode>("focus")
  const [workMin, setWorkMin] = useState(25)
  const [breakMin, setBreakMin] = useState(5)
  const [phase, setPhase] = useState<Phase>("idle")
  const [remaining, setRemaining] = useState(25 * 60)
  const [total, setTotal] = useState(25 * 60)
  const [label, setLabel] = useState("")
  const [sessions, setSessions] = useState<FocusSession[]>([])
  const [pomodoroCount, setPomodoroCount] = useState(0)
  const startedAtRef = useRef<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Track whether we auto-transitioned so we can show the banner
  const [justCompletedMode, setJustCompletedMode] = useState<Mode | null>(null)

  const preset = PRESETS.find(p => p.mode === mode)!

  function getSessionMin() {
    if (mode === "focus") return workMin
    if (mode === "short_break" || mode === "long_break") return breakMin
    return preset.min
  }

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/focus?days=7")
    if (res.ok) setSessions(await res.json())
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  // Update document title while running
  useEffect(() => {
    if (phase === "running") {
      document.title = `${formatTime(remaining)} · Focus`
    } else {
      document.title = "Focus · Emergenthealth"
    }
    return () => { document.title = "Emergenthealth" }
  }, [remaining, phase])

  // Auto-handle session completion: log focus, switch to break
  const handleSessionComplete = useCallback(async (completedMode: Mode, durationMin: number, startedAt: Date, sessionLabel: string) => {
    playDoneSound()

    if (completedMode === "focus") {
      // Log the completed focus session
      await fetch("/api/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationMin,
          type: "focus",
          label: sessionLabel || null,
          startedAt: startedAt.toISOString(),
        }),
      })
      const newCount = pomodoroCount + 1
      setPomodoroCount(newCount)
      await loadSessions()

      // Decide which break to take
      const nextBreak: Mode = newCount % POMODOROS_BEFORE_LONG_BREAK === 0 ? "long_break" : "short_break"
      setJustCompletedMode("focus")
      setMode(nextBreak)
      const bMin = nextBreak === "long_break" ? Math.max(breakMin, 15) : breakMin
      setRemaining(bMin * 60)
      setTotal(bMin * 60)
      setPhase("idle")
      startedAtRef.current = null
    } else {
      // Break finished — switch back to focus
      setJustCompletedMode(completedMode)
      setMode("focus")
      setRemaining(workMin * 60)
      setTotal(workMin * 60)
      setPhase("idle")
      startedAtRef.current = null
    }
  }, [pomodoroCount, breakMin, workMin, loadSessions])

  // Tick handler using ref to avoid stale closure
  const handleSessionCompleteRef = useRef(handleSessionComplete)
  useEffect(() => { handleSessionCompleteRef.current = handleSessionComplete }, [handleSessionComplete])

  function start() {
    const secs = getSessionMin() * 60
    setTotal(secs)
    setRemaining(secs)
    setPhase("running")
    setJustCompletedMode(null)
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

  // When phase becomes "done", trigger auto-completion
  useEffect(() => {
    if (phase !== "done") return
    if (!startedAtRef.current) return
    const capturedMode = mode
    const capturedLabel = label
    const capturedStart = startedAtRef.current
    const elapsed = Math.round((Date.now() - capturedStart.getTime()) / 60000)
    const durationMin = Math.max(1, elapsed)
    handleSessionCompleteRef.current(capturedMode, durationMin, capturedStart, capturedLabel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

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
    setJustCompletedMode(null)
    setRemaining(getSessionMin() * 60)
    setTotal(getSessionMin() * 60)
    startedAtRef.current = null
  }

  async function logAndReset() {
    if (!startedAtRef.current) { reset(); return }
    const elapsed = Math.round((Date.now() - startedAtRef.current.getTime()) / 60000)
    const durationMin = Math.max(1, elapsed)
    if (mode === "focus") {
      await fetch("/api/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMin, type: mode, label: label || null, startedAt: startedAtRef.current.toISOString() }),
      })
      setPomodoroCount(c => c + 1)
      await loadSessions()
    }
    reset()
  }

  function selectMode(m: Mode) {
    if (phase !== "idle") return
    setMode(m)
    setJustCompletedMode(null)
    if (m === "focus") {
      setRemaining(workMin * 60)
      setTotal(workMin * 60)
    } else {
      setRemaining(breakMin * 60)
      setTotal(breakMin * 60)
    }
  }

  function setWorkDuration(min: number) {
    if (phase !== "idle") return
    setWorkMin(min)
    if (mode === "focus") {
      setRemaining(min * 60)
      setTotal(min * 60)
    }
  }

  function setBreakDuration(min: number) {
    if (phase !== "idle") return
    setBreakMin(min)
    if (mode !== "focus") {
      setRemaining(min * 60)
      setTotal(min * 60)
    }
  }

  const pct = total > 0 ? ((total - remaining) / total) * 100 : 0
  const circumference = 2 * Math.PI * 90

  const isBreakMode = mode === "short_break" || mode === "long_break"
  const ringColor = phase === "running" || phase === "done"
    ? isBreakMode ? "hsl(var(--chart-2, 142 71% 45%))" : "hsl(var(--primary))"
    : "hsl(var(--border))"

  // Stats
  const _now = new Date()
  const todayStr = [_now.getFullYear(), String(_now.getMonth()+1).padStart(2,"0"), String(_now.getDate()).padStart(2,"0")].join("-")
  const todaySessions = sessions.filter(s => s.endedAt.startsWith(todayStr))
  const todayFocusSessions = todaySessions.filter(s => s.type === "focus")
  const todayFocusMin = todayFocusSessions.reduce((a, s) => a + s.durationMin, 0)
  const weekFocusMin = sessions.filter(s => s.type === "focus").reduce((a, s) => a + s.durationMin, 0)

  // Pomodoro dots: how many until long break
  const dotsUntilLong = POMODOROS_BEFORE_LONG_BREAK - (pomodoroCount % POMODOROS_BEFORE_LONG_BREAK)
  const isLongBreakNext = dotsUntilLong === POMODOROS_BEFORE_LONG_BREAK && pomodoroCount > 0

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Timer className="h-6 w-6 text-primary" /> Focus Timer
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">Pomodoro technique · track deep work</p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <StatCard label="Today's focus" value={`${todayFocusMin}m`} icon="🧠" />
        <StatCard label="Sessions today" value={String(todayFocusSessions.length)} icon="🍅" />
        <StatCard label="Week total" value={weekFocusMin >= 60 ? `${(weekFocusMin/60).toFixed(1)}h` : `${weekFocusMin}m`} icon="📈" />
      </div>

      {/* Auto-switch banner */}
      {justCompletedMode && phase === "idle" && (
        <div className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl border ${
          justCompletedMode === "focus"
            ? "bg-green-500/10 border-green-500/30 text-green-400"
            : "bg-primary/10 border-primary/30 text-primary"
        }`}>
          <span>{justCompletedMode === "focus" ? "🎉" : "✅"}</span>
          <span>
            {justCompletedMode === "focus"
              ? `Great work! Time for a ${isLongBreakNext ? "long break" : "short break"}.`
              : "Break over — ready for another focus session?"}
          </span>
        </div>
      )}

      {/* Timer card */}
      <Card>
        <CardContent className="pt-6 pb-6 space-y-5">
          {/* Mode selector */}
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

          {/* Duration configurator — only visible when idle */}
          {phase === "idle" && (
            <div className="space-y-2 px-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-20 shrink-0">Work</span>
                <div className="flex gap-1.5">
                  {WORK_DURATIONS.map(min => (
                    <button key={min} onClick={() => setWorkDuration(min)}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-all ${
                        workMin === min ? "border-primary/50 bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground hover:bg-secondary"
                      }`}>
                      {min}m
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-20 shrink-0">Break</span>
                <div className="flex gap-1.5">
                  {BREAK_DURATIONS.map(min => (
                    <button key={min} onClick={() => setBreakDuration(min)}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-all ${
                        breakMin === min ? "border-green-500/50 bg-green-500/10 text-green-400 font-medium" : "border-border text-muted-foreground hover:bg-secondary"
                      }`}>
                      {min}m
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Circular timer */}
          <div className="flex justify-center">
            <div className="relative">
              <svg width="200" height="200" className="-rotate-90">
                <circle cx="100" cy="100" r="90" fill="none" stroke="hsl(var(--secondary))" strokeWidth="8" />
                <circle cx="100" cy="100" r="90" fill="none"
                  stroke={ringColor}
                  strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference - (circumference * pct) / 100}
                  className="transition-all duration-1000" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                <span className="text-4xl font-black tabular-nums tracking-tight">
                  {formatTime(remaining)}
                </span>
                <span className={`text-xs font-medium ${preset.color}`}>{preset.label}</span>
                {/* Pomodoro tomato count */}
                <div className="flex items-center gap-1 mt-2">
                  {[...Array(POMODOROS_BEFORE_LONG_BREAK)].map((_, i) => {
                    const filled = i < (pomodoroCount % POMODOROS_BEFORE_LONG_BREAK) || (isLongBreakNext && i < POMODOROS_BEFORE_LONG_BREAK)
                    return (
                      <span key={i} className={`text-sm leading-none transition-all ${filled ? "opacity-100" : "opacity-25"}`}>
                        🍅
                      </span>
                    )
                  })}
                </div>
                {pomodoroCount > 0 && (
                  <span className="text-[10px] text-muted-foreground mt-0.5">
                    {isLongBreakNext ? "Long break earned!" : `${dotsUntilLong} until long break`}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Label input — only when idle */}
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

          {/* Controls */}
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
                <Button variant="outline" onClick={logAndReset} className="gap-2">
                  <Check className="h-4 w-4" /> Log it
                </Button>
                <Button variant="ghost" onClick={reset} size="icon">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Session history */}
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
