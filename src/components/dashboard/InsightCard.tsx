"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { RefreshCw } from "lucide-react"

type InsightState =
  | { status: "loading" }
  | { status: "loaded"; bullets: string[]; generatedAt: string }
  | { status: "empty" }

export function InsightCard() {
  const [state, setState] = useState<InsightState>({ status: "loading" })

  const fetchInsight = useCallback(async (method: "GET" | "POST" = "GET") => {
    setState({ status: "loading" })
    try {
      const res = await fetch("/api/insight", { method })
      if (!res.ok) { setState({ status: "empty" }); return }
      const data = await res.json()
      if (!data.bullets || data.bullets.length === 0) { setState({ status: "empty" }); return }
      setState({ status: "loaded", bullets: data.bullets, generatedAt: data.generatedAt })
    } catch {
      setState({ status: "empty" })
    }
  }, [])

  useEffect(() => { fetchInsight("GET") }, [fetchInsight])

  function regenerate() { fetchInsight("POST") }

  if (state.status === "empty") return null

  if (state.status === "loading") {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-3 pb-3">
          <div className="flex items-start gap-2">
            <span className="text-sm shrink-0">✨</span>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-2.5 bg-secondary/60 rounded animate-pulse" style={{ width: "60px" }} />
              <div className="space-y-1.5">
                <div className="h-3 bg-secondary/60 rounded animate-pulse" style={{ width: "85%" }} />
                <div className="h-3 bg-secondary/60 rounded animate-pulse" style={{ width: "70%" }} />
                <div className="h-3 bg-secondary/60 rounded animate-pulse" style={{ width: "78%" }} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const { bullets } = state

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="pt-3 pb-3">
        <div className="flex items-start gap-2">
          <span className="text-sm shrink-0">✨</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary/60 mb-1.5">This week</p>
            <div className="space-y-1">
              {bullets.map((b, i) => (
                <p key={i} className="text-xs text-muted-foreground leading-relaxed">{b}</p>
              ))}
            </div>
          </div>
          <button
            onClick={regenerate}
            className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors shrink-0 p-0.5"
            title="Regenerate"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
