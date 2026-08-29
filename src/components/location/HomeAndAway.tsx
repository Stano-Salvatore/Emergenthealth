"use client"

// The coarse view of a life: which days were spent at home, which were spent
// out, and which were spent somewhere else entirely — plus what the away
// nights did to sleep and the away days did to mood.
//
// This sits above the per-place correlations on purpose. "I was in Athens for
// five nights" is a far bigger input to how a week felt than which café was
// visited on the Tuesday, and it needs no saved places to work.

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type Presence = "home" | "local" | "away" | "unknown"

interface DayLocation {
  date: string
  presence: Presence
  slept: "home" | "away" | "unknown"
  points: number
  maxKmFromHome: number | null
}

interface Trip {
  start: string
  end: string
  nights: number
  gapDays: number
  lat: number
  lng: number
  maxKmFromHome: number
}

interface Side {
  n: number
  sleepHours: number | null
  readiness: number | null
  hrv: number | null
  mood: number | null
}

interface DaysResponse {
  timezone: string
  windowDays: number
  trackedDays: number
  home: { lat: number; lng: number; nights: number; share: number } | null
  days: DayLocation[]
  trips: Trip[]
  comparison: { nights: { away: Side; home: Side }; days: { away: Side; home: Side } }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "4–6 Aug", or "30 Jul – 2 Aug" when a trip crosses the month. */
function dateRange(startISO: string, endISO: string): string {
  const [, sm, sd] = startISO.split("-").map(Number)
  const [, em, ed] = endISO.split("-").map(Number)
  if (startISO === endISO) return `${sd} ${MONTHS[sm - 1]}`
  if (sm === em) return `${sd}–${ed} ${MONTHS[em - 1]}`
  return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}`
}

const CELL: Record<Presence, string> = {
  // One hue at three strengths — home, out, away — because these are places,
  // not statuses. The status palette is reserved for on/watch/off.
  home: "bg-primary/15",
  local: "bg-primary/45",
  away: "bg-primary",
  unknown: "bg-transparent border border-dashed border-border/60",
}

const PRESENCE_LABEL: Record<Presence, string> = {
  home: "home all day",
  local: "out locally",
  away: "away",
  unknown: "no fixes",
}

function DayStrip({ days }: { days: DayLocation[] }) {
  return (
    <div className="flex flex-wrap gap-[3px]">
      {days.map(d => (
        <span
          key={d.date}
          title={`${d.date} — ${PRESENCE_LABEL[d.presence]}${d.maxKmFromHome != null ? ` (max ${d.maxKmFromHome} km)` : ""}`}
          className={cn("h-2.5 w-2.5 rounded-[3px]", CELL[d.presence])}
        />
      ))}
    </div>
  )
}

function fmt(value: number | null, digits: number, unit: string): string {
  return value == null ? "—" : `${value.toFixed(digits)}${unit}`
}

function Row({
  label, away, home, digits, unit, higherIsBetter,
}: {
  label: string
  away: number | null
  home: number | null
  digits: number
  unit: string
  higherIsBetter: boolean
}) {
  const delta = away != null && home != null ? away - home : null
  const better = delta == null || delta === 0 ? null : (delta > 0) === higherIsBetter
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-2 tabular-nums">
        <span className="text-sm font-semibold">{fmt(away, digits, unit)}</span>
        <span className="text-xs text-muted-foreground">vs {fmt(home, digits, unit)}</span>
        {delta != null && (
          <span className={cn(
            "text-xs font-semibold",
            better === null ? "text-muted-foreground" : better ? "text-emerald-400" : "text-red-400",
          )}>
            {delta > 0 ? "+" : ""}{delta.toFixed(digits)}
          </span>
        )}
      </span>
    </div>
  )
}

export default function HomeAndAway({ days = 180 }: { days?: number }) {
  const [data, setData] = useState<DaysResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/location/days?days=${days}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as DaysResponse
        if (!cancelled) setData(json)
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    })()
    return () => { cancelled = true }
  }, [days])

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <span role="img">🧳</span>
          Home &amp; away
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your days.</p>
        ) : !data ? (
          <Skeleton className="h-24 w-full" />
        ) : data.home == null ? (
          <p className="text-sm text-muted-foreground">
            Nothing to compare yet. Home is worked out from where the nights are spent, so this
            fills in once location tracking has run through a few nights — no setup needed.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <DayStrip days={data.days} />
              <p className="text-xs text-muted-foreground">
                {data.trackedDays} of the last {data.windowDays} days have fixes. Darker is further
                from home; dashed is a day the phone recorded nothing, which is never counted as
                being in.
              </p>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                Trips
              </h3>
              {data.trips.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No nights away in this window.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {data.trips.slice().reverse().map(t => (
                    <li key={t.start} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">{dateRange(t.start, t.end)}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {t.nights} night{t.nights === 1 ? "" : "s"} · {Math.round(t.maxKmFromHome)} km
                        {t.gapDays > 0 && ` · ${t.gapDays} day${t.gapDays === 1 ? "" : "s"} unrecorded`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Nights away vs nights home
              </h3>
              <p className="text-xs text-muted-foreground mb-1.5 tabular-nums">
                {data.comparison.nights.away.n} away · {data.comparison.nights.home.n} home
              </p>
              <Row label="Sleep" away={data.comparison.nights.away.sleepHours} home={data.comparison.nights.home.sleepHours} digits={1} unit=" h" higherIsBetter />
              <Row label="Readiness" away={data.comparison.nights.away.readiness} home={data.comparison.nights.home.readiness} digits={0} unit="" higherIsBetter />
              <Row label="HRV" away={data.comparison.nights.away.hrv} home={data.comparison.nights.home.hrv} digits={0} unit=" ms" higherIsBetter />
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Days away vs days home
              </h3>
              <p className="text-xs text-muted-foreground mb-1.5 tabular-nums">
                {data.comparison.days.away.n} away · {data.comparison.days.home.n} home
              </p>
              <Row label="Mood" away={data.comparison.days.away.mood} home={data.comparison.days.home.mood} digits={1} unit="/5" higherIsBetter />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
