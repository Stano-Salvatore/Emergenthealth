"use client"

import { useEffect, useState } from "react"
import { Timer } from "lucide-react"
import Link from "next/link"

interface TogglState {
  connected: boolean
  current: { start: string; description: string | null } | null
  totalSecondsToday: number
}

function fmt(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function TogglTile() {
  const [state, setState] = useState<TogglState | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    fetch("/api/toggl/state").then(r => r.json()).then(setState).catch(() => {})
    const poll = setInterval(() => {
      fetch("/api/toggl/state").then(r => r.json()).then(setState).catch(() => {})
    }, 30_000)
    const ticker = setInterval(() => setTick(t => t + 1), 1000)
    return () => { clearInterval(poll); clearInterval(ticker) }
  }, [])

  if (!state?.connected) return null

  const liveSeconds = state.current
    ? Math.floor((Date.now() - new Date(state.current.start).getTime()) / 1000)
    : 0
  const totalSeconds = state.totalSecondsToday + (state.current ? liveSeconds : 0)
  const isRunning = !!state.current

  return (
    <Link href="#" onClick={e => e.preventDefault()}>
      <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-all cursor-pointer hover:border-primary/30 hover:shadow-sm ${isRunning ? "border-red-500/30 bg-red-500/5" : ""}`}
        style={!isRunning ? { background: "linear-gradient(135deg, rgba(99,102,241,0.06) 0%, var(--card) 60%)" } : {}}>
        <div className="relative">
          {isRunning && (
            <span className="absolute inset-0 rounded-full bg-red-400 opacity-40 animate-ping" />
          )}
          <Timer className={`h-4 w-4 relative ${isRunning ? "text-red-400" : "text-indigo-400"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-muted-foreground tracking-wide">
            {isRunning ? "Toggl · tracking" : "Toggl today"}
          </p>
          <p className={`text-lg font-bold tabular-nums ${isRunning ? "text-red-400" : ""}`} suppressHydrationWarning>
            {fmt(totalSeconds)}
          </p>
          {isRunning && state.current?.description && (
            <p className="text-[10px] text-muted-foreground truncate">{state.current.description}</p>
          )}
        </div>
      </div>
    </Link>
  )
}
