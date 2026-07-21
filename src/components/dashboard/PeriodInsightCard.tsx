"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RefreshCw, ChevronRight } from "lucide-react"
import { useInsightsPrefs, sliceCorrelations, InsightRowsControl, PinButton, DEFAULT_COUNTS } from "./insightsControls"

type Period = "week" | "month" | "overall"

const PERIOD_META: Record<Period, { label: string; emoji: string }> = {
  week:    { label: "Last 7 Days",  emoji: "📈" },
  month:   { label: "Last 30 Days", emoji: "📊" },
  overall: { label: "Overall",      emoji: "🌐" },
}

type InsightData = { bullets: string[]; generatedAt: string; error?: string } | null

type CorrelationItem = { id: string; emoji: string; finding: string; delta: number; confident?: boolean }

type LocationPattern = {
  locationKey: string; label: string; emoji: string; n: number; delta: number | null; confidence: string
}

const CONFIDENCE_COLORS: Record<string, string> = {
  insufficient: "text-muted-foreground/30",
  low: "text-yellow-500/70",
  moderate: "text-blue-400/80",
  good: "text-green-400",
}

function SkeletonRows({ count }: { count: number }) {
  const widths = [85, 70, 78, 65, 80]
  return (
    <div className="space-y-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-3 bg-secondary/50 rounded animate-pulse" style={{ width: `${widths[i % widths.length]}%` }} />
      ))}
    </div>
  )
}

// Standalone version of InsightsPanel's stacked period section — one period
// per independently draggable/resizable grid widget, instead of all periods
// bundled into a single card.
export function PeriodInsightCard({ period }: { period: Period }) {
  const [insight, setInsight] = useState<InsightData>(null)
  const [correlations, setCorrelations] = useState<CorrelationItem[]>([])
  const [locationPatterns, setLocationPatterns] = useState<LocationPattern[]>([])
  const [loaded, setLoaded] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const { counts, pinned, togglePin } = useInsightsPrefs()

  const load = useCallback(async () => {
    const fetchLoc = period === "month" || period === "overall"
    const [insightRes, corrRes, locRes] = await Promise.allSettled([
      fetch(`/api/insight?period=${period}`).then(r => r.json()),
      fetch(`/api/insights/correlations?period=${period}`).then(r => r.json()),
      fetchLoc
        ? fetch("/api/location-correlations?metric=hrv").then(r => r.json())
        : Promise.resolve([]),
    ])
    setInsight(insightRes.status === "fulfilled" ? insightRes.value : null)
    setCorrelations(corrRes.status === "fulfilled" ? (corrRes.value.insights ?? []) : [])
    setLocationPatterns(locRes.status === "fulfilled" && Array.isArray(locRes.value) ? locRes.value : [])
    setLoaded(true)
  }, [period])

  useEffect(() => { load() }, [load])

  async function regenerate() {
    setRegenerating(true)
    try {
      const res = await fetch(`/api/insight?period=${period}`, { method: "POST" })
      setInsight(await res.json())
    } catch {
      // ignore
    } finally {
      setRegenerating(false)
    }
  }

  const meta = PERIOD_META[period]
  const bullets = insight?.bullets ?? []
  const hasInsight = bullets.length > 0
  const hasCorr = correlations.length > 0
  const count = counts[period] ?? DEFAULT_COUNTS[period]
  const visibleCorr = sliceCorrelations<CorrelationItem>(correlations, count, pinned)
  const showLocation = period === "month" || period === "overall"
  const locWithData = locationPatterns.filter(l => l.n >= 6 && l.delta != null)

  return (
    <Card className="h-full overflow-auto">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5">{meta.emoji} {meta.label}</span>
          {loaded && (
            <button
              onClick={regenerate}
              disabled={regenerating}
              className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors p-0.5 disabled:cursor-not-allowed"
              title="Regenerate"
            >
              <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
            </button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!loaded ? (
          <SkeletonRows count={4} />
        ) : !hasInsight && !hasCorr ? (
          <p className="text-xs text-muted-foreground py-2">
            Not enough data for this period yet — keep logging!
          </p>
        ) : (
          <>
            {hasInsight && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/60 mb-1.5">✨ AI insights</p>
                <div className="space-y-1">
                  {bullets.map((b, i) => (
                    <p key={i} className="text-xs text-muted-foreground leading-relaxed">{b}</p>
                  ))}
                </div>
              </div>
            )}

            {hasCorr && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    📊 patterns <span className="text-muted-foreground/50">({visibleCorr.length}/{correlations.length})</span>
                  </p>
                  <Link href="/dashboard/insights" className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-0.5 transition-colors">
                    Full view <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
                <InsightRowsControl period={period} label="Show" className="mb-2.5" />
                <div className="space-y-1.5">
                  {visibleCorr.map(item => (
                    <div key={item.id} className="flex items-start gap-2">
                      <PinButton pinned={pinned.has(item.id)} onClick={() => togglePin(item.id)} />
                      <span className="text-sm shrink-0 leading-relaxed">{item.emoji}</span>
                      <p className="text-xs text-muted-foreground flex-1 min-w-0 leading-relaxed">{item.finding}</p>
                      {item.confident === false && (
                        <span className="text-[9px] font-semibold shrink-0 text-muted-foreground/40 uppercase tracking-wide mt-0.5">early</span>
                      )}
                      <span className={`text-[10px] font-bold shrink-0 tabular-nums mt-0.5 ${item.delta > 0 ? "text-green-400" : "text-red-400"}`}>
                        {item.delta > 0 ? "+" : ""}{item.delta.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showLocation && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">🗺️ by location (HRV)</p>
                  <Link href="/dashboard/location-insights" className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-0.5 transition-colors">
                    Full view <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
                {locWithData.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/50">
                    Import your Google Timeline in Settings to see location patterns.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {locWithData.map(loc => (
                      <div key={loc.locationKey} className="flex items-center gap-2">
                        <span className="text-sm shrink-0">{loc.emoji}</span>
                        <p className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{loc.label}</p>
                        <span className={`text-[10px] shrink-0 tabular-nums ${CONFIDENCE_COLORS[loc.confidence]}`}>
                          n={loc.n}
                        </span>
                        {loc.delta != null && (
                          <span className={`text-[10px] font-bold shrink-0 tabular-nums ${loc.delta > 0 ? "text-green-400" : "text-red-400"}`}>
                            {loc.delta > 0 ? "+" : ""}{loc.delta.toFixed(1)}ms
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
