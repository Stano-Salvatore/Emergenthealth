"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { NUTRIENT_CAVEAT } from "@/lib/nutrients"

interface LabCheck {
  marker: string
  value: number
  unit: string
  date: string
  status: "in-range" | "below" | "above" | "unknown"
}

interface Gap {
  nutrient: string
  avgPerDay: number
  unit: "mg" | "ug"
  pctOfNrv: number
  daysSeen: number
  foods: string
  lab: LabCheck | null
}

interface Report {
  coverage:
    | { ok: true; daysLogged: number; windowDays: number; avgCalories: number }
    | { ok: false; reason: string; daysLogged: number; windowDays: number; avgCalories: number }
  gaps: Gap[]
  windowDays: number
}

const unitLabel = (u: "mg" | "ug") => (u === "ug" ? "µg" : "mg")

/**
 * What the blood test says, which is the only thing here that measures
 * anything. A logged shortfall with a normal lab result behind it is a
 * non-event; the same shortfall with nothing ever measured is worth raising.
 */
function LabLine({ lab, nutrient }: { lab: LabCheck | null; nutrient: string }) {
  if (!lab) {
    return (
      <p className="text-[11px] text-amber-400/80">
        No {nutrient} result on file — a blood test is what would actually measure this.
      </p>
    )
  }
  const when = new Date(lab.date).toLocaleDateString([], { month: "short", year: "numeric" })
  if (lab.status === "in-range") {
    return (
      <p className="text-[11px] text-emerald-400/80">
        Your {when} blood test put {lab.marker} at {lab.value} {lab.unit} — inside the range printed on that report.
      </p>
    )
  }
  if (lab.status === "below") {
    return (
      <p className="text-[11px] text-red-400/90">
        Your {when} blood test put {lab.marker} at {lab.value} {lab.unit} — below the range on that report. Worth raising with your doctor.
      </p>
    )
  }
  return (
    <p className="text-[11px] text-muted-foreground">
      Last measured {when}: {lab.marker} {lab.value} {lab.unit}.
    </p>
  )
}

export function NutrientGapsCard() {
  const [report, setReport] = useState<Report | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch("/api/nutrients/gaps")
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setReport)
      .catch(() => setFailed(true))
  }, [])

  if (failed || !report) return null

  const { coverage, gaps, windowDays } = report

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          🥗 Running low?
          <span className="text-xs text-muted-foreground font-normal">last {windowDays} days</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!coverage.ok ? (
          // Not an empty state — an explanation. A gap report built on partial
          // logging invents deficiencies, so it says why it won't rather than
          // showing numbers it doesn't believe.
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{coverage.reason}</p>
            <p className="text-[11px] text-muted-foreground/70">
              Logged {coverage.daysLogged}/{coverage.windowDays} days
              {coverage.avgCalories > 0 && `, averaging ${coverage.avgCalories} kcal on those days`}.
            </p>
          </div>
        ) : gaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing consistently under the reference values across {coverage.daysLogged} logged days. That
            only covers nutrients your meals were analysed for, not everything you ate.
          </p>
        ) : (
          <div className="space-y-3">
            {gaps.map(g => (
              <div key={g.nutrient} className="rounded-lg border border-border/50 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-medium">{g.nutrient}</span>
                  <Badge variant="secondary" className="text-[10px] font-semibold px-1.5 text-amber-400">
                    {g.pctOfNrv}% of reference
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  ≈{g.avgPerDay} {unitLabel(g.unit)}/day across the window, from {g.daysSeen} days with a reading.
                </p>
                {g.foods && (
                  <p className="text-[11px] text-muted-foreground/80">Rich sources: {g.foods}.</p>
                )}
                <LabLine lab={g.lab} nutrient={g.nutrient} />
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/70 leading-snug border-t border-border/40 pt-2">
          {NUTRIENT_CAVEAT} Nothing here is a reason to start a supplement on your own — several interact
          with prescription medication, so that conversation belongs with your doctor or pharmacist.
        </p>
      </CardContent>
    </Card>
  )
}
