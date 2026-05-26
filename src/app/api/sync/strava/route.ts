import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ensureStravaTable, getStravaToken } from "@/lib/strava"

interface StravaActivity {
  id: number
  type: string
  name: string
  distance: number
  moving_time: number
  elapsed_time: number
  total_elevation_gain: number
  average_heartrate?: number
  max_heartrate?: number
  start_date: string
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  try {
    await ensureStravaTable()

    const accessToken = await getStravaToken(userId)

    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000)
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=50&after=${thirtyDaysAgo}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )

    if (!res.ok) {
      const text = await res.text()
      console.error("[sync/strava] fetch activities error:", text)
      return NextResponse.json({ error: "Failed to fetch activities" }, { status: 502 })
    }

    const activities: StravaActivity[] = await res.json()
    let synced = 0

    for (const activity of activities) {
      const id = crypto.randomUUID()
      const stravaId = String(activity.id)
      const type = activity.type
      const name = activity.name ?? null
      const distanceM = activity.distance ?? null
      const movingTimeSec = activity.moving_time
      const elapsedTimeSec = activity.elapsed_time
      const elevationM = activity.total_elevation_gain ?? null
      const avgHR = activity.average_heartrate != null ? Math.round(activity.average_heartrate) : null
      const maxHR = activity.max_heartrate != null ? Math.round(activity.max_heartrate) : null
      const startDate = new Date(activity.start_date)
      const day = activity.start_date.slice(0, 10)

      await prisma.$executeRaw`
        INSERT INTO "StravaActivity" (
          "id", "userId", "stravaId", "type", "name",
          "distanceM", "movingTimeSec", "elapsedTimeSec", "elevationM",
          "avgHR", "maxHR", "startDate", "day"
        ) VALUES (
          ${id}, ${userId}, ${stravaId}, ${type}, ${name},
          ${distanceM}, ${movingTimeSec}, ${elapsedTimeSec}, ${elevationM},
          ${avgHR}, ${maxHR}, ${startDate}, ${day}
        )
        ON CONFLICT ("userId", "stravaId") DO UPDATE
          SET "type"           = EXCLUDED."type",
              "name"           = EXCLUDED."name",
              "distanceM"      = EXCLUDED."distanceM",
              "movingTimeSec"  = EXCLUDED."movingTimeSec",
              "elapsedTimeSec" = EXCLUDED."elapsedTimeSec",
              "elevationM"     = EXCLUDED."elevationM",
              "avgHR"          = EXCLUDED."avgHR",
              "maxHR"          = EXCLUDED."maxHR",
              "startDate"      = EXCLUDED."startDate",
              "day"            = EXCLUDED."day"
      `
      synced++
    }

    return NextResponse.json({ synced })
  } catch (err) {
    console.error("[sync/strava] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
