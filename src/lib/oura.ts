import { prisma } from "@/lib/prisma"

const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection"

async function buildOuraClient(userId: string) {
  const stored = await prisma.ouraToken.findUnique({ where: { userId } })
  if (!stored?.accessToken) throw new Error("Oura Ring not connected. Visit /api/oura/auth to authorize.")

  return {
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    userId,
  }
}

async function refreshAccessToken(userId: string, refreshToken: string): Promise<string> {
  const response = await fetch("https://api.ouraring.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.OURA_CLIENT_ID!,
      client_secret: process.env.OURA_CLIENT_SECRET!,
    }).toString(),
  })

  if (!response.ok) {
    throw new Error(`Failed to refresh Oura token: ${response.statusText}`)
  }

  const data = await response.json()

  // Update stored token
  await prisma.ouraToken.update({
    where: { userId },
    data: {
      accessToken: data.access_token,
      ...(data.refresh_token && { refreshToken: data.refresh_token }),
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    },
  })

  return data.access_token
}

async function makeOuraRequest(
  endpoint: string,
  accessToken: string,
  userId: string,
  params?: Record<string, string>,
) {
  const url = new URL(`${OURA_API_BASE}${endpoint}`)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value)
    })
  }

  let response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // If 401, try refreshing token
  if (response.status === 401) {
    const stored = await prisma.ouraToken.findUnique({ where: { userId } })
    if (!stored?.refreshToken) throw new Error("Oura token expired and no refresh token available")

    const newToken = await refreshAccessToken(userId, stored.refreshToken)
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${newToken}` },
    })
  }

  if (!response.ok) {
    throw new Error(`Oura API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export async function getSteps(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest(
    "/daily_activity",
    client.accessToken,
    userId,
    { start_date: startDate, end_date: endDate },
  )

  return (data.data || []).map((item: Record<string, unknown>) => ({
    date: item.day,
    steps: item.steps ?? 0,
  }))
}

export async function getCalories(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest(
    "/daily_activity",
    client.accessToken,
    userId,
    { start_date: startDate, end_date: endDate },
  )

  return (data.data || []).map((item: Record<string, unknown>) => ({
    date: item.day,
    calories: Math.round((item.active_calories as number) ?? 0),
  }))
}

export async function getHeartRate(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest(
    "/sleep",
    client.accessToken,
    userId,
    { start_date: startDate, end_date: endDate },
  )

  // Oura provides heart rate data in sleep sessions
  return (data.data || []).map((item: Record<string, unknown>) => {
    const heartRate = item.heart_rate as number | null
    return {
      date: item.day,
      avgBpm: heartRate ?? null,
      minBpm: null, // Oura doesn't provide min/max in sleep summary
      maxBpm: null,
    }
  })
}

export async function getSleep(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest(
    "/sleep",
    client.accessToken,
    userId,
    { start_date: startDate, end_date: endDate },
  )

  const SLEEP_TYPE: Record<string, string> = {
    deep: "deep",
    light: "light",
    rem: "rem",
    awake: "awake",
  }

  return (data.data || []).map((item: Record<string, unknown>) => {
    const startMs = new Date(item.bedtime_start as string).getTime()
    const endMs = new Date(item.bedtime_end as string).getTime()
    const durationMin = Math.round((endMs - startMs) / 60_000)

    return {
      date: item.day,
      start: item.bedtime_start,
      end: item.bedtime_end,
      durationMinutes: durationMin,
      type: SLEEP_TYPE[(item.type as string) ?? ""] ?? "unknown",
    }
  })
}

export async function getWeight(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest(
    "/personal_info",
    client.accessToken,
    userId,
  )

  // Oura personal_info endpoint doesn't provide historical weight data
  // This would require a separate weight tracking integration
  // For now, return empty array
  return []
}

export async function getDistance(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest(
    "/daily_activity",
    client.accessToken,
    userId,
    { start_date: startDate, end_date: endDate },
  )

  return (data.data || []).map((item: Record<string, unknown>) => ({
    date: item.day,
    distanceMeters: Math.round((item.meters as number) ?? 0),
  }))
}

export async function getActivitySessions(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest(
    "/workout",
    client.accessToken,
    userId,
    { start_date: startDate, end_date: endDate },
  )

  return (data.data || []).map((item: Record<string, unknown>) => ({
    id: item.id,
    name: (item.title as string) ?? "Workout",
    activityType: item.type,
    start: item.start_datetime,
    end: item.end_datetime,
    durationMinutes: item.duration_total_seconds ? Math.round((item.duration_total_seconds as number) / 60) : null,
  }))
}

export async function getDailySummary(userId: string, date: string) {
  const [steps, calories, heartRate, distance] = await Promise.all([
    getSteps(userId, date, date),
    getCalories(userId, date, date),
    getHeartRate(userId, date, date),
    getDistance(userId, date, date),
  ])

  return {
    date,
    steps: steps[0]?.steps ?? 0,
    caloriesBurned: calories[0]?.calories ?? 0,
    avgHeartRateBpm: heartRate[0]?.avgBpm ?? null,
    distanceMeters: distance[0]?.distanceMeters ?? 0,
  }
}
