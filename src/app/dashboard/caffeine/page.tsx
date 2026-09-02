"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import { format } from "date-fns"

import { COMPOUNDS, COMPOUND_LABELS, LIMIT_MG, decayed, hoursToBedtime } from "@/lib/caffeine"
import { cutoffHoursBeforeBed } from "@/lib/caffeine-personal"

// Caffeine's own tab is gone: "In my body" hosts these pieces now, with its
// circulating list slotted between the status cards and the logging tools.
// The state lives in one hook so an add or delete updates every piece at once,
// wherever the host page chose to put them.

// Entries created automatically from intake drinks / Oura tags carry a
// deterministic id prefix; the log marks them so manual ones stand apart.
const isAutoEntry = (id: string) => id.startsWith("intake_") || id.startsWith("oura_caf_")

interface CaffeineLog {
  id: string
  compound: string
  caffeineMg: number
  servings: number
  loggedAt: string
}

interface PersonalHalfLife {
  halfLifeH: number
  nights: number
  usedDefault: boolean
  confidence: "none" | "low" | "medium" | "high"
  range: { low: number; high: number } | null
  summary: string
}

export interface CaffeineData {
  logs: CaffeineLog[]
  totalMg: number
  activeMg?: number
  halfLifeH?: number
  limitMg: number
  personal?: PersonalHalfLife
  /** Median bedtime from the ring, "HH:MM", when there are enough nights. */
  bedtime?: string | null
  bedtimeMin?: number | null
  /** "HH:MM" — when the last ordinary coffee should be to be clear by bedtime. */
  lastCoffeeBy?: string | null
}

/** Hours from now until a clock time given as minutes after midnight (tomorrow if it has passed). */
function hoursUntilClock(min: number): number {
  const now = new Date()
  let d = min - (now.getHours() * 60 + now.getMinutes())
  if (d < 0) d += 24 * 60
  return d / 60
}

function progressColor(mg: number): string {
  if (mg < 200) return "bg-green-500"
  if (mg <= 350) return "bg-amber-500"
  return "bg-red-500"
}

/** Today's caffeine — data, and the add/delete actions every piece shares. */
export function useCaffeine(onChanged?: () => void) {
  const [data, setData] = useState<CaffeineData>({ logs: [], totalMg: 0, limitMg: LIMIT_MG })
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const res = await fetch("/api/caffeine")
    if (res.ok) {
      const d = await res.json() as CaffeineData
      setData(d)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // loadData's setState calls all follow an await, so nothing cascades — the
    // rule just can't see through the useCallback boundary to know that.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [loadData])

  async function add(compound: string) {
    setAdding(compound)
    const res = await fetch("/api/caffeine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compound, servings: 1 }),
    })
    if (res.ok) {
      const d = await res.json() as CaffeineData
      setData(d)
      onChanged?.()
    }
    setAdding(null)
  }

  async function remove(id: string) {
    setDeleting(id)
    const res = await fetch(`/api/caffeine?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    if (res.ok) {
      await loadData()
      onChanged?.()
    }
    setDeleting(null)
  }

  return { data, loading, adding, deleting, add, remove }
}

function ActiveNowCard({ activeMg, halfLifeH, personal, bedtime, bedtimeMin, lastCoffeeBy }: {
  activeMg: number; halfLifeH: number; personal?: PersonalHalfLife
  bedtime?: string | null; bedtimeMin?: number | null; lastCoffeeBy?: string | null
}) {
  // Their own bedtime when the ring has seen enough nights; 23:00 until then.
  const bedH = bedtimeMin != null ? hoursUntilClock(bedtimeMin) : hoursToBedtime()
  const bedLabel = bedtime ?? "23:00"
  const atBed = decayed(activeMg, bedH, halfLifeH)
  // When today's load falls under a sleep-irrelevant 30 mg, at whichever
  // half-life applies to this user — the actionable half of the estimate.
  // "now" frozen at first render — a clearing time doesn't need to tick
  const [renderedAt] = useState(() => Date.now())
  const hoursToClear = cutoffHoursBeforeBed(activeMg, halfLifeH)
  const clearAt = hoursToClear > 0
    ? new Date(renderedAt + hoursToClear * 3_600_000)
        .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : null
  // decay curve over the next 12h, 30-min steps, in a 100×32 viewBox
  const points = Array.from({ length: 25 }, (_, i) => {
    const h = i * 0.5
    const mg = activeMg * Math.pow(0.5, h / halfLifeH)
    return `${(h / 12) * 100},${32 - (mg / activeMg) * 28 - 2}`
  }).join(" ")
  const bedX = Math.min(100, (bedH / 12) * 100)

  return (
    <Card className="rounded-2xl border border-border bg-card">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">In your system now</p>
            <p className="text-2xl font-black mt-0.5">
              {activeMg} <span className="text-sm font-semibold text-muted-foreground">mg</span>
            </p>
            <p className={`text-xs mt-1 ${atBed > 50 ? "text-amber-400" : "text-muted-foreground"}`}>
              ≈{atBed} mg at {bedLabel} {atBed > 50 ? "— may affect sleep" : "— sleep-safe"}
            </p>
            {clearAt && (
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                Below 30 mg around {clearAt}
              </p>
            )}
            {lastCoffeeBy && (
              <p className="text-[11px] font-semibold text-primary mt-1">
                ☕ Last coffee by {lastCoffeeBy}
                <span className="font-normal text-muted-foreground/70"> — to be clear by your usual {bedLabel}</span>
              </p>
            )}
          </div>
          <div className="flex-1 max-w-[220px] pt-1">
            <svg viewBox="0 0 100 32" className="w-full h-12" preserveAspectRatio="none">
              <polyline points={points} fill="none" stroke="currentColor"
                className="text-primary" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              {bedH <= 12 && (
                <line x1={bedX} y1="0" x2={bedX} y2="32" stroke="currentColor"
                  className="text-muted-foreground/40" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            <div className="flex justify-between text-[9px] text-muted-foreground/60">
              <span>now</span>
              {bedH <= 12 && <span>{bedLabel}</span>}
              <span>+12h</span>
            </div>
          </div>
        </div>

        {/* Whose half-life this curve is drawn with */}
        {personal && (
          <p className="text-[10px] text-muted-foreground/70 mt-2 pt-2 border-t border-border/50">
            {personal.usedDefault ? "⏱️ " : "🧬 "}
            {personal.usedDefault
              ? personal.summary
              : <>Your own caffeine half-life: <span className="text-primary font-semibold">{personal.summary}</span>
                  {personal.range && personal.range.low !== personal.range.high &&
                    <> Plausible range {personal.range.low}–{personal.range.high} h.</>}
                </>}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** The two status cards: what's active now (with decay curve) and today's total. */
export function CaffeineStatusCards({ data }: { data: CaffeineData }) {
  const pct = Math.min((data.totalMg / LIMIT_MG) * 100, 100)
  const barColor = progressColor(data.totalMg)

  return (
    <>
      {(data.activeMg ?? 0) > 0 && (
        <ActiveNowCard activeMg={data.activeMg!} halfLifeH={data.halfLifeH ?? 5} personal={data.personal}
          bedtime={data.bedtime} bedtimeMin={data.bedtimeMin} lastCoffeeBy={data.lastCoffeeBy} />
      )}

      <Card className="rounded-2xl border border-border bg-card">
        <CardContent className="pt-4 pb-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Today&apos;s intake</span>
            <span className="font-semibold text-foreground">{data.totalMg} / {LIMIT_MG} mg</span>
          </div>
          <div className="h-3 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground/60">
            <span>0</span>
            <span>200 mg</span>
            <span>350 mg</span>
            <span>{LIMIT_MG} mg</span>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

/** The logging tools: compound quick-add and today's caffeine log. */
export function CaffeineLogTools({ data, adding, deleting, onAdd, onDelete }: {
  data: CaffeineData
  adding: string | null
  deleting: string | null
  onAdd: (compound: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <>
      <Card className="rounded-2xl border border-border bg-card">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Caffeine quick add
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(COMPOUNDS).map(([key, info]) => (
              <Button
                key={key}
                variant="outline"
                size="sm"
                disabled={adding !== null}
                onClick={() => onAdd(key)}
                className={`flex flex-col h-auto py-3 gap-1 rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all ${
                  adding === key ? "opacity-60" : ""
                }`}
              >
                <span className="text-lg">{info.emoji}</span>
                <span className="text-xs font-medium leading-tight text-center">{info.label}</span>
                <span className="text-[10px] text-muted-foreground">{info.mg} mg</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border bg-card">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Today&apos;s caffeine log
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-4 space-y-1.5">
          {data.logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No caffeine logged today — use the buttons above to track your intake
            </p>
          ) : (
            data.logs.map(log => {
              const info = COMPOUND_LABELS[log.compound]
              return (
                <div
                  key={log.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/50 bg-secondary/20 text-sm"
                >
                  <span className="text-base shrink-0">{info?.emoji ?? "☕"}</span>
                  <span className="flex-1 font-medium">
                    {info?.label ?? log.compound}
                    {isAutoEntry(log.id) && (
                      <span className="ml-2 text-[9px] uppercase tracking-wider text-muted-foreground/60 border border-border/60 rounded px-1 py-0.5">
                        auto
                      </span>
                    )}
                  </span>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {log.caffeineMg} mg
                  </Badge>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {format(new Date(log.loggedAt), "HH:mm")}
                  </span>
                  <button
                    onClick={() => onDelete(log.id)}
                    disabled={deleting === log.id}
                    className="text-muted-foreground/50 hover:text-destructive transition-colors disabled:opacity-30 shrink-0"
                    aria-label="Delete entry"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </>
  )
}

// The standalone route. Unreachable in normal navigation — the proxy folds
// /dashboard/caffeine into the intake page's "In my body" tab — but kept
// working so nothing that renders it directly ever meets a broken page.
export default function CaffeinePage() {
  const caf = useCaffeine()

  if (caf.loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          ☕ Caffeine
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">Track your daily caffeine intake by compound</p>
      </div>

      <CaffeineStatusCards data={caf.data} />
      <CaffeineLogTools data={caf.data} adding={caf.adding} deleting={caf.deleting} onAdd={caf.add} onDelete={caf.remove} />

      <p className="text-xs text-muted-foreground/60 text-center px-4">
        Caffeine half-life is ~5h. Last coffee before 2pm avoids sleep disruption.
      </p>
    </div>
  )
}
