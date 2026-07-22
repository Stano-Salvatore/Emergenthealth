"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Star } from "lucide-react"
import { useInsightsPrefs } from "./insightsControls"

type CorrelationItem = { id: string; emoji: string; finding: string; delta: number; confident?: boolean }

const PERIODS: { key: "week" | "month" | "overall"; label: string }[] = [
  { key: "overall", label: "Overall" },
  { key: "month",   label: "30d" },
  { key: "week",    label: "7d" },
]

// All the correlations the user has pinned (⭐), gathered across every period
// into one place — so the pin-&-watch feature has a home. Pulls the widest
// window that still contains each pinned pattern for its current value.
export function WatchedPatterns() {
  const { pinned, togglePin } = useInsightsPrefs()
  const [byId, setById] = useState<Map<string, CorrelationItem & { periodLabel: string }>>(new Map())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.allSettled(
      PERIODS.map(p => fetch(`/api/insights/correlations?period=${p.key}`).then(r => r.json())),
    ).then(results => {
      if (cancelled) return
      const map = new Map<string, CorrelationItem & { periodLabel: string }>()
      // Iterate widest → narrowest; first hit (widest window) wins per id.
      results.forEach((res, i) => {
        if (res.status !== "fulfilled") return
        const items: CorrelationItem[] = res.value?.insights ?? []
        for (const it of items) {
          if (!map.has(it.id)) map.set(it.id, { ...it, periodLabel: PERIODS[i].label })
        }
      })
      setById(map)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  // Nothing pinned yet — show a gentle hint instead of an empty card.
  if (pinned.size === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-4 pb-4">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Star className="h-4 w-4 text-amber-400" /> Watched patterns
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Tap the ⭐ on any pattern to watch it. You&apos;ll get a notification when a watched pattern
            flips direction, becomes statistically solid, or shifts significantly.
          </p>
        </CardContent>
      </Card>
    )
  }

  const watched = [...pinned].map(id => byId.get(id)).filter(Boolean) as (CorrelationItem & { periodLabel: string })[]

  return (
    <Card className="border-amber-400/25 bg-amber-400/[0.03]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <Star className="h-4 w-4 text-amber-400 fill-current" /> Watched patterns
          <span className="text-xs text-muted-foreground font-normal">({pinned.size})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!loaded && watched.length === 0 ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          [...pinned].map(id => {
            const item = byId.get(id)
            return (
              <div key={id} className="flex items-start gap-2">
                <button
                  onClick={() => togglePin(id)}
                  className="shrink-0 mt-0.5 text-amber-400 hover:text-amber-300 transition-colors"
                  title="Stop watching"
                  aria-label="Stop watching"
                >
                  <Star className="h-3.5 w-3.5 fill-current" />
                </button>
                {item ? (
                  <>
                    <span className="text-sm shrink-0 leading-relaxed">{item.emoji}</span>
                    <p className="text-xs text-muted-foreground flex-1 min-w-0 leading-relaxed">{item.finding}</p>
                    <span className="text-[9px] text-muted-foreground/50 shrink-0 mt-1 uppercase tracking-wide">{item.periodLabel}</span>
                    <span className={`text-[10px] font-bold shrink-0 tabular-nums mt-0.5 ${item.delta > 0 ? "text-green-400" : "text-red-400"}`}>
                      {item.delta > 0 ? "+" : ""}{item.delta.toFixed(0)}%
                    </span>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground/50 flex-1 leading-relaxed">
                    {loaded ? "Not enough recent data for this pattern right now." : "Loading…"}
                  </p>
                )}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
