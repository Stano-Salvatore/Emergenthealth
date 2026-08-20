"use client"

import { useEffect, useState } from "react"
import { Sparkles, RefreshCw } from "lucide-react"

type BriefingState =
  | { status: "loading" }
  | { status: "loaded"; briefing: string; generatedAt: string }
  | { status: "empty" }

async function loadBriefing(force: boolean): Promise<BriefingState> {
  try {
    const res = await fetch(force ? "/api/briefing?force=1" : "/api/briefing")
    if (!res.ok) return { status: "empty" }
    const data = await res.json() as { briefing?: string; generatedAt?: string }
    if (!data.briefing) return { status: "empty" }
    return {
      status: "loaded",
      briefing: data.briefing,
      generatedAt: data.generatedAt ?? new Date().toISOString(),
    }
  } catch {
    return { status: "empty" }
  }
}

export function DailyBriefing() {
  const [state, setState] = useState<BriefingState>({ status: "loading" })
  const [refreshing, setRefreshing] = useState(false)

  // Every state update lands after an await, and `cancelled` drops the answer
  // if the component goes away first — the load lives in the effect rather
  // than in a callback the effect invokes, so nothing renders twice on mount.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next = await loadBriefing(false)
      if (!cancelled) setState(next)
    })()
    return () => { cancelled = true }
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    setState({ status: "loading" })
    setState(await loadBriefing(true))
    setRefreshing(false)
  }

  if (state.status === "loading") {
    return (
      <div className="bg-primary/5 border border-primary/10 rounded-xl px-4 py-3">
        <div className="animate-pulse h-12 rounded-lg bg-muted" />
      </div>
    )
  }

  if (state.status === "empty") return null

  const { briefing } = state

  return (
    <div className="bg-primary/5 border border-primary/10 rounded-xl px-4 py-3">
      <div className="flex items-start gap-2.5">
        <Sparkles className="h-3.5 w-3.5 text-primary/60 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground italic leading-relaxed">{briefing}</p>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">Updated today</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors shrink-0 p-0.5 disabled:opacity-50"
          title="Refresh briefing"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  )
}
