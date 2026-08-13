"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { ChevronDown } from "lucide-react"
import { scoreGrade } from "@/lib/daily-score"

// A single number is only worth showing if you can take it apart. This one
// opens all the way down to "Deep sleep: 41m, usually 70m" — every level says
// what it was and what it usually is, so the score is never something the app
// knows and the user doesn't.

interface Part { label: string; score: number | null; value: string | null; baseline: string | null }
interface Component { key: string; label: string; emoji: string; weight: number; score: number | null; parts: Part[] }
interface ScorePayload {
  score: number | null
  components: Component[]
  coverage: number
  basis: number
  driver: { label: string; emoji: string; score: number; direction: "up" | "down" } | null
  reason?: string
  date: string
}

function barColor(score: number): string {
  if (score >= 60) return "bg-emerald-400"
  if (score >= 41) return "bg-sky-400"
  if (score >= 26) return "bg-amber-400"
  return "bg-rose-400"
}

function Bar({ score }: { score: number }) {
  return (
    <div className="relative h-1.5 w-full rounded-full bg-secondary overflow-hidden">
      <div className={cn("h-full rounded-full", barColor(score))} style={{ width: `${score}%` }} />
      {/* The midpoint is "typical for you" — the bar means nothing without it */}
      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
    </div>
  )
}

export function DailyScoreCard() {
  const [data, setData] = useState<ScorePayload | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/daily-score")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d && !d.error) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!data) return null

  if (data.score === null) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Today vs your usual</span> — {data.reason ?? "not enough to say yet"}.
          </p>
        </CardContent>
      </Card>
    )
  }

  const grade = scoreGrade(data.score)
  const scored = data.components.filter(c => c.score !== null)

  return (
    <Card>
      <CardContent className="py-3 space-y-3">
        <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 text-left">
          <div className="flex items-baseline gap-1.5">
            <span className={cn("text-3xl font-black leading-none tabular-nums", grade.color)}>{data.score}</span>
            <span className="text-[10px] text-muted-foreground">/100</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn("text-xs font-semibold", grade.color)}>{grade.emoji} {grade.label}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {data.driver
                ? `${data.driver.emoji} ${data.driver.label} ${data.driver.direction === "up" ? "carried" : "dragged"} it`
                : "Nothing stood out either way"}
              {" · "}50 is a typical day for you
            </p>
          </div>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>

        <div className="space-y-2">
          {scored.map(c => (
            <div key={c.key}>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-24 shrink-0 truncate">{c.emoji} {c.label}</span>
                <div className="flex-1"><Bar score={c.score!} /></div>
                <span className="w-7 shrink-0 text-right tabular-nums text-muted-foreground">{c.score}</span>
              </div>
              {open && (
                <div className="mt-1 ml-6 space-y-0.5">
                  {c.parts.map(p => (
                    <p key={p.label} className="text-[10px] text-muted-foreground">
                      {p.label}: <span className="text-foreground">{p.value}</span>
                      {p.baseline != null
                        ? <> · usually {p.baseline}{p.score != null && ` (${p.score})`}</>
                        : <> · no baseline yet</>}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {open && (
          <p className="text-[10px] text-muted-foreground/70 leading-snug">
            Scored against your own median over the last {data.basis} days, not a population norm — 50 means
            an ordinary day for you and each step of 15 is one robust deviation. Anything that didn&apos;t
            sync is left out rather than counted as zero
            {data.coverage < 1 && `; ${Math.round(data.coverage * 100)}% of the usual inputs were available today`}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
