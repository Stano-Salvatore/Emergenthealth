"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"

type Insight = {
  id: string
  emoji: string
  finding: string
  delta: number
}

export function DashboardCorrelations() {
  const [items, setItems] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/insights/correlations")
      .then(r => r.json())
      .then(d => setItems((d.insights ?? []).slice(0, 3)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (!loading && items.length === 0) return null

  return (
    <div className="rounded-xl border border-border/50 bg-background/50 backdrop-blur px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">📊 Top patterns</p>
        <Link href="/dashboard/insights" className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-0.5 transition-colors">
          See all <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      {loading ? (
        <div className="space-y-1.5">
          {[80, 60, 72].map((w, i) => (
            <div key={i} className="h-3 bg-secondary/40 rounded animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-2">
              <span className="text-sm shrink-0">{item.emoji}</span>
              <p className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{item.finding}</p>
              <span className={`text-[10px] font-bold shrink-0 tabular-nums ${item.delta > 0 ? "text-green-400" : "text-red-400"}`}>
                {item.delta > 0 ? "+" : ""}{item.delta.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
