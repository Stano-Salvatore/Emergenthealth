"use client"

import { useEffect, useState } from "react"
import { useClientValue } from "@/lib/use-client-value"
import { locationAlreadyGranted } from "@/lib/native/geolocation"

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

// A browser either has geolocation or it doesn't, and it never changes mid-
// session. Nothing here needs to render "loading" first and then find out.
//
// Test the VALUE, not the key. `"geolocation" in navigator` is true even where
// the value is undefined — an iframe with the geolocation permissions-policy
// off, for one — and the effect below bails on the value. Disagree about that
// and `loading` is stuck true with nothing left to resolve it: the skeleton
// pulses for the rest of the session.
function hasGeolocation(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.geolocation)
}

interface SavedCoords { lat: number; lon: number }

/** Settings → Weather location, if the user has set one. */
async function savedCoords(): Promise<SavedCoords | null> {
  try {
    const res = await fetch("/api/preferences/location")
    if (!res.ok) return null
    const data = await res.json()
    if (typeof data?.lat !== "number" || typeof data?.lon !== "number") return null
    if (!Number.isFinite(data.lat) || !Number.isFinite(data.lon)) return null
    return { lat: data.lat, lon: data.lon }
  } catch {
    return null
  }
}

export function WeatherWidget() {
  const [weather, setWeather] = useState<Weather | null>(null)
  const geolocation = useClientValue(hasGeolocation, true)
  const [locating, setLocating] = useState(true)
  const loading = geolocation && locating

  useEffect(() => {
    let settled = false
    const done = () => { if (!settled) { settled = true; setLocating(false) } }

    async function fetchFor(lat: number, lon: number): Promise<boolean> {
      try {
        const url = new URL("https://api.open-meteo.com/v1/forecast")
        url.searchParams.set("latitude", String(lat))
        url.searchParams.set("longitude", String(lon))
        url.searchParams.set("current_weather", "true")
        url.searchParams.set("daily", "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max")
        url.searchParams.set("timezone", "auto")
        url.searchParams.set("forecast_days", "4")

        const res = await fetch(url)
        const data = await res.json()
        const cw = data.current_weather
        if (!cw) return false
        setWeather({
          temp: Math.round(cw.temperature),
          code: cw.weathercode,
          forecast: [1, 2, 3].map((i) => ({
            code: data.daily.weathercode[i],
            max: Math.round(data.daily.temperature_2m_max[i]),
            min: Math.round(data.daily.temperature_2m_min[i]),
          })),
        })
        return true
      } catch {
        return false
      }
    }

    /** Keep the day's row, so the correlation engine has weather to work with. */
    function record(data: Record<string, unknown>) {
      fetch("/api/weather", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).catch(() => {})
    }

    void (async () => {
      // 1. The location the user actually chose, in Settings → Weather
      //    location. It needs no permission, it is the same position the
      //    nightly cron uses, and it is right for someone whose phone is
      //    somewhere they are not.
      const saved = await savedCoords()
      if (saved) {
        await fetchFor(saved.lat, saved.lon)
        done()
        return
      }

      // 2. No saved location. Ask the browser only if it has ALREADY been
      //    granted — never raise the dialog from here.
      //
      //    This used to call getCurrentPosition on mount, so opening the app
      //    raised a location prompt on the first screen, before anything had
      //    explained why, and with the greeting card pulsing grey for up to
      //    fifteen seconds while the person decided. On a Play review that is
      //    a permission request with no context attached; for everyone else it
      //    is being asked for their position by a clock.
      //
      //    Settings is where weather is turned on now, and the Brief says so
      //    when there is nothing to show.
      if (!navigator.geolocation) { done(); return }
      if ((await locationAlreadyGranted()) !== true) { done(); return }

      navigator.geolocation.getCurrentPosition(
        async ({ coords }) => {
          const ok = await fetchFor(coords.latitude, coords.longitude)
          if (ok) {
            try {
              const url = new URL("https://api.open-meteo.com/v1/forecast")
              url.searchParams.set("latitude", String(coords.latitude))
              url.searchParams.set("longitude", String(coords.longitude))
              url.searchParams.set("daily", "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max")
              url.searchParams.set("timezone", "auto")
              url.searchParams.set("forecast_days", "4")
              const d = await (await fetch(url)).json()
              const t = new Date()
              const today = [t.getFullYear(), String(t.getMonth() + 1).padStart(2, "0"), String(t.getDate()).padStart(2, "0")].join("-")
              record({
                date: today,
                tempMaxC: d.daily.temperature_2m_max[0],
                tempMinC: d.daily.temperature_2m_min[0],
                precipMm: d.daily.precipitation_sum[0],
                uvIndex: d.daily.uv_index_max[0],
                weatherCode: d.daily.weathercode[0],
                lat: coords.latitude,
                lon: coords.longitude,
              })
            } catch { /* the nightly cron is the other path to a row */ }
          }
          done()
        },
        done,
        // Covers a slow FIX. Permission is already granted by this point, so
        // the dialog case the old comment worried about cannot arise here.
        { timeout: 10_000, maximumAge: 10 * 60 * 1000 },
      )
    })()

    // The backstop. A skeleton with no path out of it is worse than no widget:
    // it reads as "still loading" for the rest of the session and leaves a grey
    // hole in the greeting card.
    const giveUp = setTimeout(done, 15_000)
    return () => clearTimeout(giveUp)
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
