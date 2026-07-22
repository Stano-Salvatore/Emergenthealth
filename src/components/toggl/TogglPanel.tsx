"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Timer, X, Play, Square, ChevronDown, Clock, Trash2, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

interface TogglEntry {
  id: number
  description: string | null
  start: string
  stop: string | null
  duration: number
  project_id: number | null
  workspace_id: number
  tags: string[]
}

interface TogglProject {
  id: number
  name: string
  color: string
}

interface TogglState {
  connected: boolean
  current: TogglEntry | null
  entries: TogglEntry[]
  projects: TogglProject[]
  totalSecondsToday: number
  workspaceId: number | null
  error?: string
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function elapsed(startIso: string): number {
  return Math.floor((Date.now() - new Date(startIso).getTime()) / 1000)
}

export function TogglPanel() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<TogglState | null>(null)
  const [tick, setTick] = useState(0)
  const [desc, setDesc] = useState("")
  const [projectId, setProjectId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [tokenInput, setTokenInput] = useState("")
  const [savingToken, setSavingToken] = useState(false)
  const [tokenError, setTokenError] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/toggl/state")
      const data = await res.json()
      setState(data)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadState()
    pollRef.current = setInterval(loadState, 30_000)
    tickRef.current = setInterval(() => setTick(t => t + 1), 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [loadState])

  async function handleStart() {
    setLoading(true)
    try {
      await fetch("/api/toggl/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc, projectId }),
      })
      setDesc("")
      setProjectId(null)
      await loadState()
    } finally {
      setLoading(false)
    }
  }

  async function handleStop() {
    if (!state?.current) return
    setLoading(true)
    try {
      await fetch("/api/toggl/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timerId: state.current.id }),
      })
      await loadState()
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveToken() {
    setSavingToken(true)
    setTokenError("")
    try {
      const res = await fetch("/api/toggl/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiToken: tokenInput }),
      })
      const data = await res.json()
      if (!res.ok) { setTokenError(data.error ?? "Invalid token"); return }
      setTokenInput("")
      await loadState()
    } finally {
      setSavingToken(false)
    }
  }

  async function handleDisconnect() {
    await fetch("/api/toggl/token", { method: "DELETE" })
    setState(null)
    await loadState()
  }

  const isRunning = !!state?.current
  const runningSeconds = state?.current ? elapsed(state.current.start) + tick * 0 : 0
  const liveSeconds = state?.current ? elapsed(state.current.start) : 0
  const totalToday = (state?.totalSecondsToday ?? 0) + (isRunning ? liveSeconds : 0)

  const projectColor = (id: number | null) =>
    state?.projects.find(p => p.id === id)?.color ?? "#6366f1"

  const projectName = (id: number | null) =>
    state?.projects.find(p => p.id === id)?.name ?? null

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full shadow-lg flex items-center justify-center transition-all duration-200",
          isRunning
            ? "bg-red-500 hover:bg-red-600 shadow-red-500/40"
            : "bg-primary hover:bg-primary/90 shadow-primary/40",
          "shadow-xl"
        )}
        title="Toggl Timer"
      >
        {isRunning ? (
          <div className="relative flex items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60 animate-ping" />
            <Timer className="h-5 w-5 text-white relative" />
          </div>
        ) : (
          <Timer className="h-5 w-5 text-white" />
        )}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-in panel */}
      <div
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        className={cn(
          "fixed top-0 right-0 z-50 h-screen w-80 flex flex-col border-l border-border shadow-2xl transition-transform duration-300 ease-out",
          "bg-card",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-[#e01b00]/20 flex items-center justify-center">
              <Timer className="h-3.5 w-3.5 text-[#e01b00]" />
            </div>
            <span className="font-semibold text-sm">Toggl Track</span>
          </div>
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Not connected */}
          {state && !state.connected && (
            <div className="p-4 space-y-4">
              <div className="text-center py-4 space-y-2">
                <Clock className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-sm font-medium">Connect Toggl Track</p>
                <p className="text-xs text-muted-foreground">
                  Paste your API token from{" "}
                  <a href="https://track.toggl.com/profile" target="_blank" rel="noopener noreferrer"
                    className="text-primary inline-flex items-center gap-0.5">
                    toggl.com/profile
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>
              <div className="space-y-2">
                <input
                  type="password"
                  placeholder="API token"
                  value={tokenInput}
                  onChange={e => setTokenInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSaveToken()}
                  className="w-full h-9 px-3 text-sm rounded-lg border border-border bg-secondary/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                {tokenError && <p className="text-xs text-red-400">{tokenError}</p>}
                <button
                  onClick={handleSaveToken}
                  disabled={savingToken || !tokenInput.trim()}
                  className="w-full h-9 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {savingToken ? "Connecting…" : "Connect"}
                </button>
              </div>
            </div>
          )}

          {state?.connected && (
            <div className="p-4 space-y-4">
              {/* Current timer */}
              <div className={cn(
                "rounded-xl p-4 border transition-colors",
                isRunning ? "border-red-500/30 bg-red-500/5" : "border-border bg-secondary/30"
              )}>
                {isRunning && state.current ? (
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug truncate">
                          {state.current.description || "(no description)"}
                        </p>
                        {state.current.project_id && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: projectColor(state.current.project_id) }} />
                            <span className="text-xs text-muted-foreground">{projectName(state.current.project_id)}</span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={handleStop}
                        disabled={loading}
                        className="shrink-0 h-8 w-8 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 flex items-center justify-center transition-colors"
                      >
                        <Square className="h-3.5 w-3.5 fill-current" />
                      </button>
                    </div>
                    <div className="text-2xl font-mono font-bold tabular-nums text-red-400">
                      {fmt(liveSeconds)}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-1">No timer running</p>
                )}
              </div>

              {/* Start new timer */}
              {!isRunning && (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="What are you working on?"
                    value={desc}
                    onChange={e => setDesc(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleStart()}
                    className="w-full h-9 px-3 text-sm rounded-lg border border-border bg-secondary/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {state.projects.length > 0 && (
                    <div className="relative">
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <select
                        value={projectId ?? ""}
                        onChange={e => setProjectId(e.target.value ? Number(e.target.value) : null)}
                        className="w-full h-9 pl-3 pr-8 text-sm rounded-lg border border-border bg-secondary/50 text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                      >
                        <option value="">No project</option>
                        {state.projects.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    onClick={handleStart}
                    disabled={loading}
                    className="w-full h-9 flex items-center justify-center gap-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Start Timer
                  </button>
                </div>
              )}

              {/* Today total */}
              <div className="flex items-center justify-between py-2 border-t border-border/60">
                <span className="text-xs text-muted-foreground">Today total</span>
                <span className="text-sm font-bold font-mono tabular-nums">{fmt(totalToday)}</span>
              </div>

              {/* Today's entries */}
              {state.entries.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">
                    Today
                  </p>
                  {state.entries
                    .filter(e => e.duration > 0)
                    .slice(0, 10)
                    .map(entry => (
                      <div key={entry.id} className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
                        {entry.project_id && (
                          <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: projectColor(entry.project_id) }} />
                        )}
                        <span className="flex-1 text-xs truncate text-muted-foreground">
                          {entry.description || "(no description)"}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground/70 shrink-0">
                          {fmt(entry.duration)}
                        </span>
                      </div>
                    ))}
                </div>
              )}

              {/* Disconnect */}
              <button
                onClick={handleDisconnect}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground/50 hover:text-red-400 transition-colors py-1"
              >
                <Trash2 className="h-3 w-3" />
                Disconnect Toggl
              </button>
            </div>
          )}

          {!state && (
            <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
              Loading…
            </div>
          )}
        </div>
      </div>
    </>
  )
}
