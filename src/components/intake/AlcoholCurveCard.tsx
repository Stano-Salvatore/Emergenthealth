"use client"

// The alcohol counterpart to the caffeine decay card, and deliberately not a
// copy of it.
//
// Caffeine halves — a fixed fraction goes per hour, so its chart bends and its
// number never quite reaches zero. Alcohol does not: the enzymes that clear it
// saturate almost immediately, so elimination runs at a near-constant grams per
// hour whatever you drank. That makes this chart a straight ramp with a real
// finishing time on it, which is the more useful of the two — "clear by 08:26"
// is a fact you can plan around in a way that "below 30 mg eventually" is not.
//
// The straight line is the point, not a missing feature. `alcoholAtHour` is
// where it is enforced, and there is a test that fails if someone reaches for
// `Math.pow(0.5, …)` here because the card above does.

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { alcoholAtHour, alcoholHoursToClear, standardDrinks } from "@/lib/body-load"

/** The window both this chart and the caffeine one above are drawn on. */
const WINDOW_H = 12

export function AlcoholCurveCard({ gramsLeft, clearanceGPerH, bedH, bedLabel }: {
  gramsLeft: number
  clearanceGPerH: number
  /** Hours from now until their usual bedtime. */
  bedH: number
  bedLabel: string
}) {

  const [renderedAt] = useState(() => Date.now())
  if (gramsLeft <= 0 || clearanceGPerH <= 0) return null

  const hoursToClear = alcoholHoursToClear(gramsLeft, clearanceGPerH)
  // Frozen at first render, like the caffeine card: a finishing time that
  // ticks while you read it is a clock, not an estimate — and reading the
  // clock during render is impure besides.
  const clearAt = new Date(renderedAt + hoursToClear * 3_600_000)
    .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

  const atBed = alcoholAtHour(gramsLeft, clearanceGPerH, bedH)
  const clearsBeforeBed = atBed <= 0

  // Two points would do for a straight line, but sampling it the way the
  // caffeine curve is sampled keeps the floor honest: the ramp stops at the
  // axis instead of continuing into negative grams.
  const at = (h: number) => `${(h / WINDOW_H) * 100},${32 - (alcoholAtHour(gramsLeft, clearanceGPerH, h) / gramsLeft) * 28 - 2}`
  const sample = (from: number, to: number) =>
    Array.from({ length: 25 }, (_, i) => at(from + (i / 24) * (to - from))).join(" ")

  // Split at the moment it lands. Drawn as one line, the flat tail is the same
  // weight as the ramp and reads as "holding steady" rather than "nothing
  // left" — the opposite of what it means.
  const rampPoints = sample(0, Math.min(hoursToClear, WINDOW_H))
  const zeroPoints = hoursToClear < WINDOW_H ? sample(hoursToClear, WINDOW_H) : null

  const bedX = Math.min(100, (bedH / WINDOW_H) * 100)
  const clearX = Math.min(100, (hoursToClear / WINDOW_H) * 100)

  return (
    <Card className="rounded-2xl border border-border bg-card">
      <CardContent className="pt-4 pb-4">
        {/* Numbers above, chart across the full width below.
            The caffeine card puts its curve beside the text, and this one
            copied that until it was rendered at 390px: the longest line on the
            left squeezed the chart to about 76px, which is a sparkline, not
            something you can find a bedtime on. Alcohol has more to show —
            a marker for bedtime and the point where it lands on zero — so it
            gets the whole card width to show it in. */}
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground">Alcohol in your system now</p>
            <p className="text-2xl font-black mt-0.5">
              {Math.round(gramsLeft)} <span className="text-sm font-semibold text-muted-foreground">g</span>
              <span className="text-sm font-semibold text-muted-foreground ml-2">
                · {standardDrinks(gramsLeft)} drinks
              </span>
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            clear around <span className="text-foreground/80 font-semibold">{clearAt}</span>
          </p>
        </div>

        <p className={`text-xs mt-1.5 ${clearsBeforeBed ? "text-muted-foreground" : "text-amber-400"}`}>
          {clearsBeforeBed
            ? `Gone before ${bedLabel}`
            : `≈${Math.round(atBed)} g still there at ${bedLabel}`}
          <span className="text-muted-foreground/70 font-normal">
            {" "}· clearing {clearanceGPerH.toFixed(1)} g an hour
          </span>
        </p>

        <div className="mt-3">
          <svg viewBox="0 0 100 32" className="w-full h-16" preserveAspectRatio="none">
            {zeroPoints && (
              <polyline points={zeroPoints} fill="none" stroke="currentColor"
                className="text-violet-400/25" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            )}
            <polyline points={rampPoints} fill="none" stroke="currentColor"
              className="text-violet-400" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            {bedH <= WINDOW_H && (
              <line x1={bedX} y1="0" x2={bedX} y2="32" stroke="currentColor"
                className="text-muted-foreground/40" strokeWidth="1" strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke" />
            )}
            {/* Where it actually reaches zero — the thing caffeine cannot show. */}
            {hoursToClear <= WINDOW_H && (
              <circle cx={clearX} cy="30" r="2" fill="currentColor" className="text-violet-400" />
            )}
          </svg>
          <div className="relative h-3 text-[9px] text-muted-foreground/60">
            <span className="absolute left-0">now</span>
            {bedH <= WINDOW_H && (
              <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${bedX}%` }}>
                🌙 {bedLabel}
              </span>
            )}
            <span className="absolute right-0">+{WINDOW_H}h</span>
          </div>
        </div>

        {/* The counterpart to the caffeine card's half-life footnote. Someone
            reading the two charts together deserves to know why one bends and
            one does not. */}
        <p className="text-[10px] text-muted-foreground/70 mt-2 pt-2 border-t border-border/50">
          ⏱️ A straight line, not a curve: alcohol leaves at a roughly fixed rate rather than
          halving, so it has a real finishing time. Estimated from your weight — one body against
          a population average.
        </p>
      </CardContent>
    </Card>
  )
}
