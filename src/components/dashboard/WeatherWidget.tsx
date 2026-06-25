"use client"

import { useEffect, useState } from "react"

const WMO: Record<number, { label: string; emoji: string }> = {
  0: { label: "Clear sky", emoji: "☀️" },
  1: { label: "Mainly clear", emoji: "🌤️" },
  2: { label: "Partly cloudy", emoji: "⛅" },
  3: { label: "Overcast", emoji: "☁️" },
  45: { label: "Fog", emoji: "🌫️" },
  48: { label: "Icy fog", emoji: "🌫️" },
  51: { label: "Light drizzle", emoji: "🌦️" },
  53: { label: "Drizzle", emoji: "🌦️" },
  55: { label: "Heavy drizzle", emoji: "🌧️" },
  61: { label: "Slight rain", emoji: "🌧️" },
  63: { label: "Rain", emoji: "🌧️" },
  65: { label: "Heavy rain", emoji: "🌧️" },
  71: { label: "Light snow", emoji: "🌨️" },
  73: { label: "Snow", emoji: "❄️" },
  75: { label: "Heavy snow", emoji: "❄️" },
  77: { label: "Snow grains", emoji: "❄️" },
  80: { label: "Showers", emoji: "🌦️" },
  81: { label: "Showers", emoji: "🌧️" },
  82: { label: "Violent showers", emoji: "⛈️" },
  85: { label: "Snow showers", emoji: "🌨️" },
  86: { label: "Heavy snow showers", emoji: "❄️" },
  95: { label: "Thunderstorm", emoji: "⛈️" },
  96: { label: "Thunderstorm + hail", emoji: "⛈️" },
  99: { label: "Thunderstorm + hail", emoji: "⛈️" },
}

function getCondition(code: number) {
  return WMO[code] ?? { label: "Unknown", emoji: "🌡️" }
}

interface Weather {
  temp: number
  code: number
  forecast: { code: number; max: number; min: number }[]
}

const DAY_LABELS = ["Tomorrow", "Day 2", "Day 3"]

export function WeatherWidget() {
  const [weather, setWeather] = useState<Weather | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!navigator.geolocation) { setLoading(false); return }
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const url = new URL("https://api.open-meteo.com/v1/forecast")
          url.searchParams.set("latitude", String(coords.latitude))
          url.searchParams.set("longitude", String(coords.longitude))
          url.searchParams.set("current_weather", "true")
          url.searchParams.set("daily", "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max")
          url.searchParams.set("timezone", "auto")
          url.searchParams.set("forecast_days", "4")

          const res = await fetch(url)
          const data = await res.json()
          const cw = data.current_weather
          setWeather({
            temp: Math.round(cw.temperature),
            code: cw.weathercode,
            forecast: [1, 2, 3].map((i) => ({
              code: data.daily.weathercode[i],
              max: Math.round(data.daily.temperature_2m_max[i]),
              min: Math.round(data.daily.temperature_2m_min[i]),
            })),
          })
          const _tw = new Date(); const today = [_tw.getFullYear(), String(_tw.getMonth()+1).padStart(2,"0"), String(_tw.getDate()).padStart(2,"0")].join("-")
          fetch("/api/weather", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              date: today,
              tempMaxC: data.daily.temperature_2m_max[0],
              tempMinC: data.daily.temperature_2m_min[0],
              precipMm: data.daily.precipitation_sum[0],
              uvIndex: data.daily.uv_index_max[0],
              weatherCode: data.daily.weathercode[0],
              lat: coords.latitude,
              lon: coords.longitude,
            }),
          })
        } catch { /* silent */ }
        setLoading(false)
      },
      () => setLoading(false)
    )
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-5 flex-wrap animate-pulse">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-secondary" />
          <div className="space-y-1.5">
            <div className="h-6 w-16 bg-secondary rounded" />
            <div className="h-3 w-20 bg-secondary rounded" />
          </div>
        </div>
        <div className="flex gap-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-16 h-16 rounded-xl bg-secondary" />
          ))}
        </div>
      </div>
    )
  }

  if (!weather) return null

  const current = getCondition(weather.code)

  return (
    <div className="flex items-center gap-5 flex-wrap">
      {/* Current */}
      <div className="flex items-center gap-2.5">
        <span className="text-4xl leading-none">{current.emoji}</span>
        <div>
          <p className="text-2xl font-bold leading-tight">{weather.temp}°C</p>
          <p className="text-xs text-muted-foreground">{current.label}</p>
        </div>
      </div>
      {/* Forecast */}
      <div className="flex gap-2">
        {weather.forecast.map((day, i) => {
          const cond = getCondition(day.code)
          return (
            <div
              key={i}
              className="flex flex-col items-center gap-0.5 rounded-xl bg-secondary/50 border border-border/50 px-3 py-2 min-w-[56px]"
            >
              <p className="text-[10px] text-muted-foreground font-medium">{DAY_LABELS[i]}</p>
              <p className="text-lg leading-none">{cond.emoji}</p>
              <p className="text-xs font-semibold">{day.max}°</p>
              <p className="text-[10px] text-muted-foreground">{day.min}°</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
