import { prisma } from "@/lib/prisma"

const DEFAULT_LAT = 48.1486
const DEFAULT_LON = 17.1077
const DEFAULT_TZ  = "Europe%2FBratislava"

export async function getWeatherCoords(userId: string) {
  try {
    const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT "key", "value" FROM "UserPreference"
      WHERE "userId" = ${userId} AND "key" IN ('weather_lat', 'weather_lon')
    `
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
    if (map.weather_lat && map.weather_lon) {
      return { lat: parseFloat(map.weather_lat), lon: parseFloat(map.weather_lon), tz: "auto" }
    }
  } catch {}
  return { lat: DEFAULT_LAT, lon: DEFAULT_LON, tz: DEFAULT_TZ }
}
