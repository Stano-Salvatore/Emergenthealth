"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sparkles, RefreshCw } from "lucide-react"

export function WeekReviewAI() {
  const [narrative, setNarrative] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/week-review", { method: "POST" })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? "Failed to generate")
      } else {
        const d = await res.json()
        setNarrative(d.narrative)
        setGeneratedAt(d.generatedAt)
      }
    } catch {
      setError("Network error. Please try again.")
    }
    setLoading(false)
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          AI Weekly Review
        </CardTitle>
      </CardHeader>
      <CardContent>
        {narrative ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{narrative}</p>
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              {generatedAt && (
                <p className="text-[10px] text-muted-foreground">
                  Generated {new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1.5 text-muted-foreground"
                onClick={generate}
                disabled={loading}
              >
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Get a personalized AI summary of your week — sleep patterns, habit streaks, energy trends, and actionable insights.
            </p>
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2 w-full">{error}</p>
            )}
            <Button
              size="sm"
              className="gap-2"
              onClick={generate}
              disabled={loading}
            >
              {loading ? (
                <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Generating…</>
              ) : (
                <><Sparkles className="h-3.5 w-3.5" />Generate AI Summary</>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
