"use client"
import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// Weather code → emoji (same mapping as API)
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
  weather: {
    current: { temp: number; code: number }
    hourly: { hour: string; temp: number; code: number; rainPct: number }[]
  } | null
  outfit: string
}

export function TodayCard() {
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
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Today</CardTitle></CardHeader>
        <CardContent>
          <div className="h-32 animate-pulse bg-muted rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  const sleepColor = data.sleep.adequate === true ? "text-green-400" : data.sleep.adequate === false && (data.sleep.hours ?? 0) >= 6 ? "text-yellow-400" : "text-red-400"
  const sleepLabel = data.sleep.adequate === true ? "Good" : data.sleep.hours != null && data.sleep.hours >= 6 ? "Okay" : "Short"
  const readinessColor = data.sleep.readiness == null ? "" : data.sleep.readiness >= 85 ? "text-green-400" : data.sleep.readiness >= 70 ? "text-yellow-400" : "text-red-400"
  const readinessLabel = data.sleep.readiness == null ? null : data.sleep.readiness >= 85 ? "Optimal" : data.sleep.readiness >= 70 ? "Good" : data.sleep.readiness >= 55 ? "Fair" : "Low"

  const displayEvents = data.calendar.slice(0, 4)
  const extraEvents = data.calendar.length - 4

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Today</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top row: Calendar + Sleep/Readiness */}
        <div className="grid grid-cols-2 gap-4">
          {/* Calendar */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">📅 Calendar</p>
            {displayEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events today ☀️</p>
            ) : (
              <div className="space-y-1.5">
                {displayEvents.map(e => (
                  <div key={e.id} className="flex items-start gap-1.5">
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {e.start.includes("T") ? e.start.slice(11, 16) : "All day"}
                    </span>
                    <span className="text-xs truncate">{e.title}</span>
                  </div>
                ))}
                {extraEvents > 0 && (
                  <p className="text-xs text-muted-foreground">+{extraEvents} more</p>
                )}
              </div>
            )}
          </div>

          {/* Sleep + Readiness */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">😴 Sleep</p>
              {data.sleep.hours != null ? (
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-2xl font-bold tabular-nums ${sleepColor}`}>
                    {data.sleep.hours.toFixed(1)}
                  </span>
                  <span className="text-xs text-muted-foreground">hrs</span>
                  <span className={`text-xs font-medium ${sleepColor} ml-1`}>{sleepLabel}</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No data</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">🎯 Readiness</p>
              {data.sleep.readiness != null ? (
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-2xl font-bold tabular-nums ${readinessColor}`}>
                    {data.sleep.readiness}
                  </span>
                  <span className="text-xs text-muted-foreground">/100</span>
                  <span className={`text-xs font-medium ${readinessColor} ml-1`}>{readinessLabel}</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No data</p>
              )}
            </div>
          </div>
        </div>

        {/* Weather */}
        {data.weather && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {weatherEmoji(data.weather.current.code)} Weather · {data.weather.current.temp}°C
            </p>
            <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
              {data.weather.hourly.map(h => (
                <div key={h.hour} className="flex flex-col items-center gap-0.5 shrink-0">
                  <span className="text-xs text-muted-foreground">{h.hour}</span>
                  <span className="text-base leading-none">{weatherEmoji(h.code)}</span>
                  <span className="text-xs font-medium">{h.temp}°</span>
                  {h.rainPct > 30 && (
                    <span className="text-xs text-blue-400">{h.rainPct}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outfit */}
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground mb-0.5">👗 What to wear</p>
          <p className="text-sm">{data.outfit}</p>
        </div>
      </CardContent>
    </Card>
  )
}
