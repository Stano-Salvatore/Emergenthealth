import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Weather, on the days nobody opened the app.
//
// `WeatherLog` had exactly one writer: `WeatherWidget.tsx`, in the browser,
// when the dashboard is on screen. So the column recorded the weather on the
// days its owner happened to look at their phone — and the engine and the chat
// prompt both read it as though it recorded the weather.
//
// That is not a gap like a missing ring night. A ring night is missing at
// random with respect to how the day went; this one is missing on exactly the
// days the app was not opened, which are not a random sample of days. A card
// like "on sunny high-UV days readiness averages 72.3 against 57.5 on grey
// days" was computed over the looked-at days alone, and nothing said so.
//
// Two rules hold the honesty of the fill:
//
//   It never overwrites a measurement. The widget stands where the user stands
//   and uses the browser's own fix; this route uses wherever their phone last
//   reported from, which may be yesterday's city. A row written by the device
//   wins, always — see the conflict clause below.
//
//   It asks for exactly the days it is missing. The window is sized per user
//   from the oldest hole in the last ninety days, so a first run fills a long
//   history in one request and every run after it asks for two or three days.

/** Open-Meteo's ceiling for `past_days`, and so the deepest backfill we can ask for. */
const MAX_PAST_DAYS = 92

interface Daily {
  time: string[]
  weathercode: (number | null)[]
  temperature_2m_max: (number | null)[]
  temperature_2m_min: (number | null)[]
  precipitation_sum: (number | null)[]
  uv_index_max: (number | null)[]
  pressure_msl_mean?: (number | null)[]
}

/**
 * Where to ask about. The phone's last fix if there is one, else wherever the
 * dashboard last measured from — both are "a place this person was", which is
 * the most an unattended job can honestly claim.
 */
async function lastKnownPlace(userId: string): Promise<{ lat: number; lon: number } | null> {
  const point = await prisma.locationPoint.findFirst({
    where: { userId },
    orderBy: { trackedAt: "desc" },
    select: { lat: true, lng: true },
  }).catch(() => null)
  if (point) return { lat: point.lat, lon: point.lng }

  const row = await prisma.weatherLog.findFirst({
    where: { userId, lat: { not: null }, lon: { not: null } },
    orderBy: { date: "desc" },
    select: { lat: true, lon: true },
  }).catch(() => null)
  return row?.lat != null && row.lon != null ? { lat: row.lat, lon: row.lon } : null
}

/**
 * How far back to ask, for this user, tonight.
 *
 * Two things the database insisted on, neither visible by reading the code.
 * `generate_series` with an interval step yields timestamps, so `g.d` is cast
 * back to a date before subtracting — `CURRENT_DATE - <timestamp>` is an
 * interval, and casting that to int raises. And the lookback has to go through
 * `make_interval` rather than `CURRENT_DATE - $1`, because a bound integer
 * there makes the whole expression an integer and the series signature stops
 * existing. The first version swallowed both errors and returned 0, which
 * looked exactly like "no gaps" and quietly shrank every backfill to two days.
 *
 * The search stops at the oldest row this user already has. Open-Meteo's
 * forecast endpoint turned out to hand back about 72 days, not the 92 the
 * parameter allows, so the days before that are not a gap anyone can fill —
 * and counting them as one had the job asking for three months every night
 * and rewriting seventy rows to do it. Absent that floor, the backfill never
 * ends, because the thing it is chasing does not exist.
 */
const GAP_QUERY_FAILED = 14

async function backfillDays(userId: string): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ days: number | null }[]>`
      WITH bounds AS (
        SELECT GREATEST(
          CURRENT_DATE - make_interval(days => ${MAX_PAST_DAYS - 1}),
          -- Nothing yet: ask for the whole window once, and learn from what
          -- comes back where the provider's own history begins.
          COALESCE(MIN(to_date(w."date", 'YYYY-MM-DD')), CURRENT_DATE - make_interval(days => ${MAX_PAST_DAYS - 1}))
        )::date AS floor
        FROM "WeatherLog" w WHERE w."userId" = ${userId}
      )
      SELECT MAX(CURRENT_DATE - g.d::date)::int AS days
      FROM bounds, generate_series(bounds.floor, CURRENT_DATE, INTERVAL '1 day') g(d)
      WHERE NOT EXISTS (
        SELECT 1 FROM "WeatherLog" w
        WHERE w."userId" = ${userId} AND w."date" = to_char(g.d, 'YYYY-MM-DD')
          -- A cron row without pressure counts as a gap too, so the column
          -- added in 3.3.1 backfills itself through the machinery that fills
          -- missing days: the ON CONFLICT update only ever touches cron rows,
          -- and a device row is complete as it is (a browser has no
          -- barometer). Bounded to the engine's own 60-day read window, so if
          -- the provider ever declines pressure for a day it otherwise
          -- serves, the chase stays inside the range anything would read
          -- instead of becoming the endless nightly backfill the floor above
          -- exists to prevent.
          AND (
            w."source" <> 'cron'
            OR w."pressureMslHpa" IS NOT NULL
            OR g.d::date < CURRENT_DATE - make_interval(days => 60)
          )
      )
    `
    return rows[0]?.days ?? 0
  } catch (error) {
    // A query that cannot run is not the same fact as a user with nothing
    // missing, so it does not return the same number: it says so, and asks for
    // a fortnight, which is wrong in the safe direction.
    console.error("[weather] gap query failed", error instanceof Error ? error.message : error)
    return GAP_QUERY_FAILED
  }
}

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  // Everyone who has ever given the app a position. Someone who never has gets
  // nothing rather than a guess about where they live.
  const users = await prisma.user.findMany({ select: { id: true } }).catch(() => [])

  let filled = 0
  let covered = 0
  for (const { id: userId } of users) {
    const place = await lastKnownPlace(userId)
    if (!place) continue

    // Today is always asked for, because the widget may not run again today
    // and a provisional row is better than a hole. Yesterday too: the day's
    // maximum temperature and UV are only settled once it is over, and this
    // run is what settles the provisional row the last run wrote.
    const pastDays = Math.min(MAX_PAST_DAYS, Math.max(1, await backfillDays(userId)))

    const url = new URL("https://api.open-meteo.com/v1/forecast")
    url.searchParams.set("latitude", String(place.lat))
    url.searchParams.set("longitude", String(place.lon))
    url.searchParams.set("daily", "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,pressure_msl_mean")
    url.searchParams.set("timezone", "auto")
    url.searchParams.set("past_days", String(pastDays))
    url.searchParams.set("forecast_days", "1")

    const daily = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { daily?: Daily } | null) => d?.daily ?? null)
      .catch(() => null)
    if (!daily?.time?.length) continue
    covered += 1

    for (let i = 0; i < daily.time.length; i++) {
      // A day with no temperature at all is Open-Meteo saying it has nothing,
      // and a row of nulls would read as "we looked and it was nothing".
      if (daily.temperature_2m_max[i] == null && daily.weathercode[i] == null) continue

      const written = await prisma.$executeRaw`
        INSERT INTO "WeatherLog"("id","userId","date","tempMaxC","tempMinC","precipMm","uvIndex","pressureMslHpa","weatherCode","lat","lon","source")
        VALUES (${randomUUID()}, ${userId}, ${daily.time[i]},
                ${daily.temperature_2m_max[i]}, ${daily.temperature_2m_min[i]},
                ${daily.precipitation_sum[i]}, ${daily.uv_index_max[i]},
                ${daily.pressure_msl_mean?.[i] ?? null},
                ${daily.weathercode[i]}, ${place.lat}, ${place.lon}, 'cron')
        ON CONFLICT ("userId","date") DO UPDATE SET
          "tempMaxC" = EXCLUDED."tempMaxC",
          "tempMinC" = EXCLUDED."tempMinC",
          "precipMm" = EXCLUDED."precipMm",
          "uvIndex" = EXCLUDED."uvIndex",
          "pressureMslHpa" = EXCLUDED."pressureMslHpa",
          "weatherCode" = EXCLUDED."weatherCode",
          "lat" = EXCLUDED."lat",
          "lon" = EXCLUDED."lon"
        -- The whole point of the source column. A row the device wrote is a
        -- measurement taken where the user was standing; this job only ever
        -- corrects its own provisional days.
        WHERE "WeatherLog"."source" = 'cron'
      `.catch(() => 0)
      filled += written
    }
  }

  return NextResponse.json({ ok: true, users: covered, daysWritten: filled })
}
