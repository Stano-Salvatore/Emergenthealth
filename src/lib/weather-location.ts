import { prisma } from "@/lib/prisma"

export interface WeatherCoords { lat: number; lon: number; tz: string }

/**
 * Where to ask for this user's weather — or null, when nobody has said.
 *
 * It used to fall back to Bratislava (48.1486, 17.1077). For the one account
 * that lives there the guess was invisible and right; for everybody else the
 * Brief opened on a confident hourly forecast for a city they have never been
 * to, with an outfit line underneath telling them it was t-shirt weather.
 * Nothing on the screen said where any of it was measured.
 *
 * That is the rule the nightly weather cron already states about itself — a
 * user who has given no position gets **no row rather than a guessed city** —
 * and the two screens that ask this function were quietly doing the opposite.
 *
 * Both callers already had a no-weather path, because the Open-Meteo request
 * can fail. Returning null simply routes into it: the card disappears and the
 * Brief says how to fix it, which a wrong city never would have.
 *
 * Set from Settings → Weather location (`components/settings/WeatherLocation`),
 * which writes `weather_lat` / `weather_lon` off a one-tap browser fix.
 */
export async function getWeatherCoords(userId: string): Promise<WeatherCoords | null> {
  try {
    const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT "key", "value" FROM "UserPreference"
      WHERE "userId" = ${userId} AND "key" IN ('weather_lat', 'weather_lon')
    `
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
    // The emptiness check has to happen on the STRING. `Number("")` is 0, and
    // 0 is finite — so a blank preference would have come back as a perfectly
    // plausible pair of coordinates in the Gulf of Guinea, which is a worse
    // guess than Bratislava was.
    const raw = (v: string | undefined) => (v != null && v.trim() !== "" ? Number(v) : NaN)
    const lat = raw(map.weather_lat)
    const lon = raw(map.weather_lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
    return { lat, lon, tz: "auto" }
  } catch {
    return null
  }
}
