"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { ChevronDown, TrendingUp, TrendingDown, Minus } from "lucide-react"

// What moved between draws, and what was going on in between.
//
// The wording is deliberately co-occurrence, never cause: one person with no
// control group can't establish that a supplement moved a marker, and the
// honest version of that sentence is the useful one anyway — it's what you
// take to the appointment.

interface Habit {
  name: string
  daysTaken: number
  coverage: number
  cadenceLabel: string
  newSince: boolean
}

interface Trend {
  marker: string
  unit: string
  latest: { value: number; date: string }
  previous: { value: number; date: string } | null
  status: "in-range" | "below" | "above" | "unknown"
  changePct: number | null
  direction: "up" | "down" | "flat" | null
  significant: boolean | null
  rcvPct: number | null
  crossed: "into range" | "out of range" | null
  intervalDays: number | null
  taken: Habit[]
  summary: string
  converted: { from: string; to: string; previousAs: number } | null
  unitMismatch: boolean
}

const STATUS_STYLE: Record<Trend["status"], string> = {
  "above": "text-rose-400",
  "below": "text-amber-400",
  "in-range": "text-emerald-400",
  "unknown": "text-muted-foreground",
}

function DirectionIcon({ d }: { d: Trend["direction"] }) {
  if (d === "up") return <TrendingUp className="h-3.5 w-3.5" />
  if (d === "down") return <TrendingDown className="h-3.5 w-3.5" />
  if (d === "flat") return <Minus className="h-3.5 w-3.5" />
  return null
}

export function LabTrendsCard() {
  const [data, setData] = useState<{ trends: Trend[]; notable: Trend[] } | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/labs/trends")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d && !d.error) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!data || data.trends.length === 0) return null

  const shown = showAll ? data.trends : (data.notable.length > 0 ? data.notable : data.trends.slice(0, 3))
  const hidden = data.trends.length - shown.length

  return (
    <Card className="border-sky-500/20 bg-sky-500/5">
      <CardContent className="pt-3 pb-3 space-y-2.5">
        <div>
          <p className="text-xs font-semibold">🔬 What changed since last time</p>
          <p className="text-[11px] text-muted-foreground">
            {data.notable.length > 0 && !showAll
              ? `${data.notable.length} marker${data.notable.length === 1 ? "" : "s"} outside the range your report printed, or newly crossed it`
              : `${data.trends.length} marker${data.trends.length === 1 ? "" : "s"} on file`}
          </p>
        </div>

        <div className="space-y-1.5">
          {shown.map(t => (
            <div key={t.marker} className="rounded-lg border border-border/60 bg-card/60 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <span className={cn("mt-0.5 shrink-0", STATUS_STYLE[t.status])}>
                  <DirectionIcon d={t.direction} />
                </span>
                <p className="text-[11px] leading-snug flex-1">{t.summary}</p>
              </div>
              {t.taken.length > 0 && (
                <div className="mt-1.5 ml-5 flex flex-wrap gap-1">
                  {t.taken.map(h => (
                    <span
                      key={h.name}
                      className={cn(
                        "rounded-md border px-1.5 py-0.5 text-[10px]",
                        h.newSince
                          ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                          : "border-border bg-secondary/40 text-muted-foreground",
                      )}
                    >
                      {h.newSince && "new · "}{h.name} · {h.cadenceLabel}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {hidden > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="h-3 w-3" /> Show the other {hidden}
          </button>
        )}

        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          Two facts side by side, not a cause: one person without a control group can&apos;t show
          that a supplement moved a marker. Reference ranges are the ones printed on your own
          reports. Whether a change counts is judged against how much that marker naturally
          varies between draws — a published population estimate, not yours. Take anything here
          to the doctor who ordered the test.
        </p>
      </CardContent>
    </Card>
  )
}
