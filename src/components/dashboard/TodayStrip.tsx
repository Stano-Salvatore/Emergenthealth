"use client"

import { useEffect, useState } from "react"

// Weather code → emoji (same mapping as TodayCard / API)
function weatherEmoji(code: number): string {
  if (code <= 2) return "☀️"
  if (code === 3) return "⛅"
  if (code <= 48) return "🌫️"
  if (code <= 67) return "🌧️"
  if (code <= 77) return "❄️"
  if (code <= 82) return "🌦️"
  return "⛈️"
}

interface TodayData {
  calendar: { id: string; title: string; start: string; end: string }[]
  sleep: { hours: number | null; sleepScore: number | null; readiness: number | null; adequate: boolean | null }
  weather: { current: { temp: number; code: number } } | null
  outfit: string
}

// A condensed, single-row "today" summary meant to live INSIDE the hero card —
// the full standalone TodayCard was merged in here (sleep · readiness · next
// event · outfit) so the top of the dashboard is one card instead of three
// near-identical ones.
export function TodayStrip() {
  const [data, setData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/today")
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="h-9 rounded-xl bg-background/40 animate-pulse" />
  }
  if (!data) return null

  const sleepColor =
    data.sleep.adequate === true ? "text-green-400"
    : data.sleep.adequate === false && (data.sleep.hours ?? 0) >= 6 ? "text-yellow-400"
    : "text-red-400"
  const readinessColor =
    data.sleep.readiness == null ? "text-muted-foreground"
    : data.sleep.readiness >= 85 ? "text-green-400"
    : data.sleep.readiness >= 70 ? "text-yellow-400"
    : "text-red-400"

  // Next upcoming event (first timed event still ahead, else first all-day)
  const nextEvent = data.calendar[0]

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-background/50 backdrop-blur border border-border/50 px-4 py-2.5">
      {/* Sleep */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm leading-none">😴</span>
        {data.sleep.hours != null ? (
          <span className={`text-sm font-bold tabular-nums ${sleepColor}`}>
            {data.sleep.hours.toFixed(1)}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">h</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>

      {/* Readiness */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm leading-none">🎯</span>
        {data.sleep.readiness != null ? (
          <span className={`text-sm font-bold tabular-nums ${readinessColor}`}>
            {data.sleep.readiness}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">/100</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>

      {/* Weather */}
      {data.weather && (
        <div className="flex items-center gap-1.5">
          <span className="text-sm leading-none">{weatherEmoji(data.weather.current.code)}</span>
          <span className="text-sm font-medium tabular-nums">{data.weather.current.temp}°</span>
        </div>
      )}

      {/* Next event */}
      {nextEvent && (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm leading-none">📅</span>
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
            {nextEvent.start.includes("T") ? nextEvent.start.slice(11, 16) : "All day"}
          </span>
          <span className="text-xs truncate">{nextEvent.title}</span>
        </div>
      )}

      {/* Outfit — pushed to its own line on narrow widths */}
      {data.outfit && (
        <div className="flex items-center gap-1.5 w-full sm:w-auto min-w-0">
          <span className="text-sm leading-none">👗</span>
          <span className="text-xs text-muted-foreground truncate">{data.outfit}</span>
        </div>
      )}
    </div>
  )
}
