"use client"

// What moved over the last thirty days, and the question that follows.
//
// `drift.ts` has asked this since it was written, and until now it asked in
// exactly one place: a push notification on the 1st of the month. Twelve
// questions a year, none of them visible on any screen. The comparison itself
// is the app's most careful one — every shift is block-permutation tested at
// the same bar a correlation card clears, and the candidate causes are drawn
// only from what the user logged — so burying it was the waste.
//
// Rolling windows, not calendar months: see the route for why.
//
// The question is the point of the card, not its sign-off. It goes to chat,
// where Emergy can write the answer back onto the days it describes, and the
// engine's onset family picks it up from there.

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { TrendingUp, TrendingDown, ArrowRight } from "lucide-react"
import { fmtDrift, type DriftReport } from "@/lib/drift"

type DriftResponse = DriftReport & { question: string }

/**
 * How many candidates fit before the row becomes a wall.
 *
 * The rest are counted rather than dropped: a factor the user can see was
 * found and cannot see named is worse than one more chip.
 */
const FACTOR_CHIPS = 6

/** "13 Aug" — enough to place the window, short enough for a subtitle. */
function dayLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00Z")
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
}

export function DriftCard() {
  const [data, setData] = useState<DriftResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/insights/drift")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d && !d.error) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Nothing moved, or not enough data to say — and in both cases the card is
  // absent rather than present and empty. "No measurable change" is the honest
  // answer and often the reassuring one, but it is not worth a card every time
  // someone opens this page.
  if (!data || data.shifts.length === 0) return null

  const { shifts, factors, question, recent, prior } = data
  const better = shifts.filter(s => s.verdict === "better")
  const worse = shifts.filter(s => s.verdict === "worse")
  // Worse first: it is the half someone came to this page to find.
  const ordered = [...worse, ...better, ...shifts.filter(s => s.verdict === "changed")]

  return (
    <Card className="rounded-2xl border border-border bg-card">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Last 30 days vs the 30 before
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            {dayLabel(recent.from)}–{dayLabel(recent.to)} against {dayLabel(prior.from)}–{dayLabel(prior.to)}
          </p>
        </div>

        <div className="space-y-1.5">
          {ordered.map(s => {
            const up = s.delta > 0
            const good = s.verdict === "better"
            const Icon = up ? TrendingUp : TrendingDown
            return (
              <div key={s.key} className="flex items-baseline justify-between gap-3 py-1 border-b border-border/40 last:border-0">
                <span className="flex items-center gap-1.5 text-sm min-w-0">
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${good ? "text-emerald-400" : "text-amber-400"}`} aria-hidden />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="text-xs shrink-0 text-right">
                  <span className={good ? "text-emerald-400" : "text-amber-400"}>{fmtDrift(s.recentMean, s.unit)}</span>
                  <span className="text-muted-foreground"> from {fmtDrift(s.priorMean, s.unit)}</span>
                </span>
              </div>
            )
          })}
        </div>

        {/* Candidates, never causes. These are things that also moved between
            the two windows, drawn from the user's own logs — which is why they
            are worth showing and why the engine's cards, not this one, are
            where a factor earns a claim. */}
        {factors.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Changed alongside
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {factors.slice(0, FACTOR_CHIPS).map(f => (
                <span key={f.label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-secondary/60 text-muted-foreground border border-border">
                  {f.unit === "ml/day" ? "water" : f.label.toLowerCase()}
                  <span className="text-foreground/70">{f.recent}</span>
                  <span className="text-muted-foreground/60">from {f.prior}</span>
                </span>
              ))}
              {factors.length > FACTOR_CHIPS && (
                <span className="text-[11px] text-muted-foreground/70 self-center">
                  and {factors.length - FACTOR_CHIPS} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* The question, and somewhere to put the answer. A question with no
            reply path is the failure this card was built to end, so it is a
            link rather than a full stop. */}
        <Link
          href="/dashboard/chat"
          className="flex items-start gap-2 pt-1 text-xs text-foreground/80 hover:text-foreground transition-colors"
        >
          <span className="flex-1 leading-snug">{question}</span>
          <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          Tell Emergy and he&apos;ll note it on the days it covers, so the patterns below can use it.
        </p>
      </CardContent>
    </Card>
  )
}
