import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getWeatherCoords } from "@/lib/weather-location"

// Weather code → emoji
function weatherEmoji(code: number): string {
  if (code <= 2) return "☀️"
  if (code === 3) return "⛅"
  if (code <= 48) return "🌫️"
  if (code <= 67) return "🌧️"
  if (code <= 77) return "❄️"
  if (code <= 82) return "🌦️"
  return "⛈️"
}

function outfitFromWeather(temp: number, rainPct: number, code: number): string {
  let base: string
  if (temp < 5) base = "🧥 Heavy coat + layers"
  else if (temp < 12) base = "🧣 Jacket and scarf"
  else if (temp < 18) base = "🧥 Light jacket or hoodie"
  else if (temp < 24) base = "👕 T-shirt weather"
  else base = "🩳 Light clothes, it's warm!"
  if (rainPct > 50) base += " · ☂️ Bring an umbrella"
  else if (code >= 71 && code <= 77) base += " · 🥾 Waterproof boots"
  return base
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id

  // Sleep + readiness from latest HealthLog
  const latestHealth = await prisma.healthLog.findFirst({
    where: { userId },
    orderBy: { date: "desc" },
    select: { sleepDuration: true, sleepScore: true, readinessScore: true },
  }).catch(() => null)

  const sleepHours = latestHealth?.sleepDuration != null ? latestHealth.sleepDuration / 60 : null
  const sleep = {
    hours: sleepHours ? Math.round(sleepHours * 10) / 10 : null,
    sleepScore: latestHealth?.sleepScore ?? null,
    readiness: latestHealth?.readinessScore ?? null,
    adequate: sleepHours != null ? sleepHours >= 7 : null,
  }

  // Calendar — look for Google Calendar integration
  // Try to load via existing calendar lib; gracefully fall back
  let calendar: { id: string; title: string; start: string; end: string }[] = []
  try {
    // Check if there's a calendar token/helper — import dynamically so missing module doesn't crash
    const calMod = await import("@/lib/google-calendar").catch(() => null)
    if (calMod?.getTodayEvents) {
      const events = await calMod.getTodayEvents(userId)
      calendar = (events ?? []).map(e => ({
        id: e.id,
        title: e.title,
        start: e.start ?? "",
        end: e.end ?? "",
      }))
    }
  } catch {}

  // Weather from Open-Meteo
  const wc = await getWeatherCoords(userId)
  let weatherData: { current: { temp: number; code: number }; hourly: { hour: string; temp: number; code: number; rainPct: number }[] } | null = null
  let outfit = "Check the weather to plan your outfit"
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${wc.lat}&longitude=${wc.lon}&hourly=temperature_2m,weathercode,precipitation_probability&current=temperature_2m,weathercode&forecast_days=1&timezone=${wc.tz}`,
      { signal: AbortSignal.timeout(4000), next: { revalidate: 1800 } }
    ).catch(() => null)

    if (res?.ok) {
      const data = await res.json()
      const currentTemp = Math.round(data.current?.temperature_2m ?? 15)
      const currentCode = data.current?.weathercode ?? 0

      const nowHour = new Date().getHours()
      const hours = (data.hourly?.time as string[] ?? [])
        .map((t: string, i: number) => ({
          hour: t.slice(11, 16), // "HH:MM"
          temp: Math.round(data.hourly.temperature_2m[i]),
          code: data.hourly.weathercode[i] as number,
          rainPct: data.hourly.precipitation_probability[i] as number,
        }))
        .filter(h => parseInt(h.hour.split(":")[0]) >= nowHour)
        .slice(0, 8)

      weatherData = { current: { temp: currentTemp, code: currentCode }, hourly: hours }
      const maxRain = Math.max(...hours.map(h => h.rainPct), 0)
      outfit = outfitFromWeather(currentTemp, maxRain, currentCode)
    }
  } catch {}

  return NextResponse.json({ calendar, sleep, weather: weatherData, outfit })
}
