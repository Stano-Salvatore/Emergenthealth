"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sparkles, RefreshCw } from "lucide-react"

// Emergy's weekly review. The Sunday-evening cron writes the canonical one
// (and pushes + emails it); this card shows it instantly and offers a
// regenerate for mid-week curiosity. Same generator either way.

interface WeeklyReview {
  weekOf: string
  generatedAt: string
  narrative: string
}

export function WeekReviewAI() {
  const [review, setReview] = useState<WeeklyReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/week-review")
      .then(r => r.json())
      .then(d => { if (d.review) setReview(d.review) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch("/api/week-review", { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error ?? "Failed to generate")
      } else if (d.review) {
        setReview(d.review)
      }
    } catch {
      setError("Network error. Please try again.")
    }
    setGenerating(false)
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          Your week, by Emergy
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-3.5 bg-primary/10 rounded animate-pulse" style={{ width: `${75 + i * 8}%` }} />
            ))}
          </div>
        ) : review ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{review.narrative}</p>
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <p className="text-[10px] text-muted-foreground">
                Week of {review.weekOf} · {new Date(review.generatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1.5 text-muted-foreground"
                onClick={generate}
                disabled={generating}
              >
                <RefreshCw className={`h-3 w-3 ${generating ? "animate-spin" : ""}`} />
                Regenerate
              </Button>
            </div>
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2 w-full">{error}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Every Sunday evening Emergy writes up your week — what actually happened, how it compares, and one thing for next week. It lands here, plus a notification and an email.
            </p>
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2 w-full">{error}</p>
            )}
            <Button size="sm" className="gap-2" onClick={generate} disabled={generating}>
              {generating ? (
                <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Writing…</>
              ) : (
                <><Sparkles className="h-3.5 w-3.5" />Write it now</>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
