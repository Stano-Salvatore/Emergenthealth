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
  hoursWithFixes: number
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

interface SourceSummary {
  points: number
  days: number
  strip: DayLocation[]
}

interface Agreement {
  bothDays: number
  agreeDays: number
  onlyA: number
  onlyB: number
  disagreements: { date: string; a: Presence; b: Presence }[]
}

interface DaysResponse {
  timezone: string
  windowDays: number
  trackedDays: number
  truncated: boolean
  home: { lat: number; lng: number; nights: number; share: number } | null
  days: DayLocation[]
  trips: Trip[]
  comparison: { nights: { away: Side; home: Side }; days: { away: Side; home: Side } }
  sources: { app: SourceSummary; timeline: SourceSummary; agreement: Agreement }
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
          title={[
            `${d.date} — ${PRESENCE_LABEL[d.presence]}`,
            d.maxKmFromHome != null ? `max ${d.maxKmFromHome} km` : null,
            d.points > 0 ? `${d.hoursWithFixes}/24 h covered` : null,
          ].filter(Boolean).join(" · ")}
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

/**
 * Two independent witnesses to the same weeks.
 *
 * Worth showing because agreement is the only cheap way to find out whether
 * background tracking actually ran. From inside the app, a week it slept
 * through looks exactly like a week spent at home — Google's copy is what
 * tells the two apart.
 */
function Sources({ sources }: { sources: { app: SourceSummary; timeline: SourceSummary; agreement: Agreement } }) {
  const { app, timeline, agreement } = sources
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Where the data comes from
      </h3>

      <div className="space-y-2.5">
        {[
          { label: "Emergenthealth", s: app },
          { label: "Google Timeline", s: timeline },
        ].map(({ label, s }) => (
          <div key={label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {s.days} day{s.days === 1 ? "" : "s"} · {s.points.toLocaleString()} fixes
              </span>
            </div>
            {s.strip.length > 0 && <DayStrip days={s.strip} />}
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-2.5">
        {timeline.points === 0 ? (
          <>No Timeline import yet. Importing one backfills everything above — home,
          trips and the comparisons — for as far back as the export goes.</>
        ) : agreement.bothDays === 0 ? (
          <>No day yet has fixes from both, so there is nothing to check one against
          the other.</>
        ) : (
          <>Both had fixes on {agreement.bothDays} day{agreement.bothDays === 1 ? "" : "s"} and
          agreed on {agreement.agreeDays}.
          {agreement.disagreements.length > 0 && (
            <> The odd ones out: {agreement.disagreements.slice(0, 5).map(d => d.date).join(", ")}
            {agreement.disagreements.length > 5 && ` and ${agreement.disagreements.length - 5} more`}.</>
          )}</>
        )}
      </p>
    </div>
  )
}

export default function HomeAndAway({ days = 180 }: { days?: number }) {
  const [data, setData] = useState<DaysResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Trip start date → place name, filled in after the card has rendered. */
  const [names, setNames] = useState<Record<string, string>>({})

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

  // Names arrive one at a time, after the dates and distances are already on
  // screen. Sequential on purpose: the geocoder asks for one request a second,
  // and every answer is cached server-side, so a trip is only ever looked up
  // once however many times this card is opened.
  useEffect(() => {
    if (!data || data.trips.length === 0) return
    let cancelled = false
    void (async () => {
      for (const trip of data.trips) {
        if (cancelled) return
        try {
          const res = await fetch(`/api/location/place-name?lat=${trip.lat}&lng=${trip.lng}`)
          if (!res.ok) continue
          const { label } = await res.json() as { label: string | null }
          if (cancelled) return
          if (label) setNames(prev => ({ ...prev, [trip.start]: label }))
        } catch {
          // A name is a nicety; the trip is still a trip without one.
        }
      }
    })()
    return () => { cancelled = true }
  }, [data])

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
            {data.home.nights < 5 && (
              <p className="text-xs rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-400">
                Home has only {data.home.nights} night{data.home.nights === 1 ? "" : "s"} behind it
                so far, and every number below is measured from it. Treat this as provisional
                until tracking has seen a few more.
              </p>
            )}

            <div className="space-y-2">
              <DayStrip days={data.days} />
              <p className="text-xs text-muted-foreground">
                {data.trackedDays} of the last {data.windowDays} days have fixes. Darker is further
                from home; dashed is a day with no fixes, which is never counted as being in.
                {data.truncated && " The oldest part of this window held more points than could be loaded, so its dashes mean unread rather than unrecorded."}
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
                    <li key={t.start} className="text-sm">
                      {/* Two lines rather than one: a place name is any length,
                          and letting it share a row with the dates and the
                          distance made both wrap unpredictably on a phone. */}
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium truncate">
                          {names[t.start] ?? dateRange(t.start, t.end)}
                        </span>
                        {names[t.start] && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {dateRange(t.start, t.end)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {t.nights} night{t.nights === 1 ? "" : "s"} · {Math.round(t.maxKmFromHome)} km
                        {t.gapDays > 0 && ` · ${t.gapDays} day${t.gapDays === 1 ? "" : "s"} unrecorded`}
                      </div>
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

            <Sources sources={data.sources} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
