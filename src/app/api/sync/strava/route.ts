import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getStravaToken } from "@/lib/strava"

interface StravaActivityAPI {
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
    const accessToken = await getStravaToken(userId)

    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000)
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=50&after=${thirtyDaysAgo}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )

    if (!res.ok) {
      console.error("[sync/strava] fetch activities error:", await res.text())
      return NextResponse.json({ error: "Failed to fetch activities" }, { status: 502 })
    }

    const activities: StravaActivityAPI[] = await res.json()
    let synced = 0

    for (const activity of activities) {
      const stravaId = String(activity.id)
      await prisma.stravaActivity.upsert({
        where: { userId_stravaId: { userId, stravaId } },
        create: {
          userId,
          stravaId,
          type: activity.type,
          name: activity.name ?? null,
          distanceM: activity.distance ?? null,
          movingTimeSec: activity.moving_time,
          elapsedTimeSec: activity.elapsed_time,
          elevationM: activity.total_elevation_gain ?? null,
          avgHR: activity.average_heartrate != null ? Math.round(activity.average_heartrate) : null,
          maxHR: activity.max_heartrate != null ? Math.round(activity.max_heartrate) : null,
          startDate: new Date(activity.start_date),
          day: activity.start_date.slice(0, 10),
        },
        update: {
          type: activity.type,
          name: activity.name ?? null,
          distanceM: activity.distance ?? null,
          movingTimeSec: activity.moving_time,
          elapsedTimeSec: activity.elapsed_time,
          elevationM: activity.total_elevation_gain ?? null,
          avgHR: activity.average_heartrate != null ? Math.round(activity.average_heartrate) : null,
          maxHR: activity.max_heartrate != null ? Math.round(activity.max_heartrate) : null,
          startDate: new Date(activity.start_date),
          day: activity.start_date.slice(0, 10),
        },
      })
      synced++
    }

    return NextResponse.json({ synced })
  } catch (err) {
    console.error("[sync/strava] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
