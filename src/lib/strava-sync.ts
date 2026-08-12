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

export type StravaSyncResult =
  | { ok: true; synced: number }
  | { ok: false; notConnected?: boolean; error: string }

// Pulls the last 30 days of activities for one user. Shared by the manual
// sync endpoint and the daily cron (mirroring how oura-sync is structured).
export async function syncStravaForUser(userId: string): Promise<StravaSyncResult> {
  let accessToken: string
  try {
    accessToken = await getStravaToken(userId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, notConnected: msg.includes("not connected"), error: msg }
  }

  const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000)
  const res = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=50&after=${thirtyDaysAgo}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  ).catch(() => null)

  if (!res?.ok) {
    const detail = res ? await res.text().catch(() => res.statusText) : "network error"
    return { ok: false, error: `Failed to fetch activities: ${detail}` }
  }

  const activities: StravaActivityAPI[] = await res.json()
  let synced = 0

  for (const activity of activities) {
    const stravaId = String(activity.id)
    const fields = {
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
    }
    await prisma.stravaActivity.upsert({
      where: { userId_stravaId: { userId, stravaId } },
      create: { userId, stravaId, ...fields },
      update: fields,
    })
    synced++
  }

  return { ok: true, synced }
}
