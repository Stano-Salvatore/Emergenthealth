"use client"

import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { generatedLabel } from "@/lib/generated-label"
import { EmergyAvatar } from "@/components/emergy/EmergyAvatar"
import { useEmergyState } from "@/lib/emergy-store"

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

/**
 * The daily briefing, spoken by Emergy.
 *
 * This is the one briefing component — the dashboard and the Brief page both
 * render it, so the brief can never look or behave differently between them.
 * It reads as a chat bubble from the mascot rather than an anonymous italic
 * quote, because that is what it is: the same voice that answers in the chat,
 * getting the first word of the day in. His face carries his current mood.
 */
export function DailyBriefing() {
  const [state, setState] = useState<BriefingState>({ status: "loading" })
  const [refreshing, setRefreshing] = useState(false)
  const mood = useEmergyState()

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
      <div className="flex items-end gap-2.5">
        <div className="h-11 w-11 rounded-full bg-secondary/60 animate-pulse shrink-0 mb-0.5" />
        <div className="flex-1 rounded-2xl rounded-bl-md border border-primary/15 bg-primary/5 px-4 py-3">
          <div className="animate-pulse space-y-2">
            <div className="h-3 rounded bg-secondary/80 w-11/12" />
            <div className="h-3 rounded bg-secondary/80 w-3/4" />
          </div>
        </div>
      </div>
    )
  }

  if (state.status === "empty") return null

  const { briefing, generatedAt } = state

  return (
    <div className="flex items-end gap-2.5">
      <div className="shrink-0 mb-0.5">
        <EmergyAvatar mood={mood} fit="icon" size={44} />
      </div>
      {/* The flattened corner nearest the avatar is what makes it a speech
          bubble rather than another card. */}
      <div className="flex-1 min-w-0 rounded-2xl rounded-bl-md border border-primary/20 bg-primary/5 px-4 py-3">
        <p className="text-sm leading-relaxed text-foreground/90">{briefing}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground/60">
            Emergy · {generatedLabel(generatedAt)}
          </p>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors shrink-0 p-1 -m-1 disabled:opacity-50"
            title="Refresh briefing"
            aria-label="Refresh briefing"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
    </div>
  )
}
