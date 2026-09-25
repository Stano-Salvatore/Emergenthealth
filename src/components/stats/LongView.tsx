"use client"

// The long view: this quarter against the last, twelve months of averages,
// and the lab markers that moved. Every quarter shift shown here survived
// the drift engine's permutation test — an empty list after a judged run is
// "same as last quarter", which is a real answer and is said as one.

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, TrendingDown } from "lucide-react"
import { fmtDrift } from "@/lib/drift"

interface Shift {
  label: string; unit: string
  recentMean: number; priorMean: number
  recentN: number; priorN: number
  verdict: "better" | "worse" | "changed"
}
interface MonthAvg { month: string; sleepH: number | null; steps: number | null; days: number }
interface LabTrend {
  marker: string; unit: string
  latest: { value: number; date: string }
  previous: { value: number; date: string } | null
  status: string; changePct: number | null; direction: "up" | "down" | "flat" | null
}
interface LongViewData {
  quarter: { judged: number; shifts: Shift[] } | null
  months: MonthAvg[]
  labs: LabTrend[]
  markerCount: number
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const monthName = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? m

function Bars({ months, pick, format }: {
  months: MonthAvg[]
  pick: (m: MonthAvg) => number | null
  format: (v: number) => string
}) {
  const values = months.map(pick)
  const known = values.filter((v): v is number => v != null)
  if (known.length === 0) return null
  const max = Math.max(...known)
  return (
    <div className="flex items-end gap-1 h-16">
      {months.map((m, i) => {
        const v = values[i]
        return (
          <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
            <div className="w-full flex-1 flex items-end">
              {v != null
                ? <div className="w-full rounded-sm bg-primary/60" style={{ height: `${Math.max(6, (v / max) * 100)}%` }} title={`${monthName(m.month)}: ${format(v)}`} />
                : <div className="w-full h-1 rounded-sm bg-secondary" title={`${monthName(m.month)}: no data`} />}
            </div>
            <span className="text-[9px] text-muted-foreground">{monthName(m.month)[0]}</span>
          </div>
        )
      })}
    </div>
  )
}

export function LongView() {
  const [data, setData] = useState<LongViewData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch("/api/longview")
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true))
  }, [])

  if (failed) return null
  if (!data) return (
    <Card><CardContent className="py-6"><div className="h-16 rounded bg-secondary/60 animate-pulse" /></CardContent></Card>
  )

  const q = data.quarter
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">The long view</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">This quarter vs last</p>
          {!q || q.judged === 0 ? (
            <p className="text-sm text-muted-foreground">Not enough data yet — a quarter comparison needs at least 10 days of a metric on each side.</p>
          ) : q.shifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {q.judged} metrics had enough data and none shifted past the tests. Same as last quarter — a real answer.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {q.shifts.map(s => (
                <li key={s.label} className="text-sm flex items-center gap-2">
                  {s.verdict === "worse"
                    ? <TrendingDown className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    : <TrendingUp className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                  <span>
                    {s.label} <span className="font-semibold tabular-nums">{fmtDrift(s.recentMean, s.unit)}</span>
                    <span className="text-muted-foreground"> vs {fmtDrift(s.priorMean, s.unit)} last quarter ({s.recentN} vs {s.priorN} days)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {data.months.length >= 3 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Sleep, monthly average</p>
              <Bars months={data.months} pick={m => m.sleepH} format={v => `${v}h`} />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Steps, monthly average</p>
              <Bars months={data.months} pick={m => m.steps} format={v => v.toLocaleString()} />
            </div>
          </div>
        )}

        {data.labs.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Blood work that moved</p>
            <ul className="space-y-1">
              {data.labs.map(l => (
                <li key={l.marker} className="text-sm">
                  {l.marker}: <span className="font-semibold tabular-nums">{l.latest.value} {l.unit}</span>
                  {l.previous && (
                    <span className="text-muted-foreground"> vs {l.previous.value} on {l.previous.date}
                      {l.changePct != null ? ` (${l.changePct > 0 ? "+" : ""}${l.changePct}%)` : ""}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Quarter shifts survived the same permutation test the drift card uses. No synthetic health age — trends against your own history, nothing more.
        </p>
      </CardContent>
    </Card>
  )
}
