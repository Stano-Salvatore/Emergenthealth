import { prisma } from "@/lib/prisma"

const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection"

async function buildOuraClient(userId: string) {
  const stored = await prisma.ouraToken.findUnique({ where: { userId } })
  if (!stored?.accessToken) throw new Error("Oura Ring not connected. Visit /api/oura/auth to authorize.")
  return { accessToken: stored.accessToken, refreshToken: stored.refreshToken, userId }
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
  if (!response.ok) throw new Error(`Failed to refresh Oura token: ${response.statusText}`)
  const data = await response.json()
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
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v))

  let response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })

  if (response.status === 401) {
    const stored = await prisma.ouraToken.findUnique({ where: { userId } })
    if (!stored?.refreshToken) throw new Error("Oura token expired and no refresh token available")
    const newToken = await refreshAccessToken(userId, stored.refreshToken)
    response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${newToken}` } })
  }

  if (!response.ok) throw new Error(`Oura API error: ${response.status} ${response.statusText}`)
  return response.json()
}

// ── Daily activity (steps, calories, distance, active minutes, score) ─────────

export async function getDailyActivity(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest("/daily_activity", client.accessToken, userId, {
    start_date: startDate, end_date: endDate,
  })
  return (data.data || []).map((item: Record<string, unknown>) => ({
    date: item.day as string,
    steps: (item.steps as number) ?? null,
    activeCalories: item.active_calories != null ? Math.round(item.active_calories as number) : null,
    totalCalories: item.total_calories != null ? Math.round(item.total_calories as number) : null,
    distanceKm: item.equivalent_walking_distance != null
      ? Math.round((item.equivalent_walking_distance as number) / 10) / 100
      : null,
    activeMinutes: item.high_activity_time != null && item.medium_activity_time != null
      ? Math.round(((item.high_activity_time as number) + (item.medium_activity_time as number)) / 60)
      : null,
    activityScore: (item.score as number) ?? null,
    sedentaryTimeSeconds: (item.sedentary_time as number) ?? null,
  }))
}

// ── Daily sleep (duration, stages, efficiency, latency, HRV, resting HR) ─────

export async function getDailySleep(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest("/sleep", client.accessToken, userId, {
    start_date: startDate, end_date: endDate,
  })
  // Group sessions by day, preferring long_sleep type then longest duration
  const byDay: Record<string, Record<string, unknown>> = {}
  for (const item of (data.data || [])) {
    const day = item.day as string
    const existing = byDay[day]
    const itemDur = (item.total_sleep_duration as number) ?? 0
    const existDur = existing ? ((existing.total_sleep_duration as number) ?? 0) : 0
    if (!existing
      || (item.type === "long_sleep" && existing.type !== "long_sleep")
      || (item.type === existing.type && itemDur > existDur)) {
      byDay[day] = item
    }
  }
  return Object.values(byDay).map((item: Record<string, unknown>) => ({
    date: item.day as string,
    totalSleepSeconds: (item.total_sleep_duration as number) ?? null,
    deepSleepSeconds: (item.deep_sleep_duration as number) ?? null,
    remSleepSeconds: (item.rem_sleep_duration as number) ?? null,
    lightSleepSeconds: (item.light_sleep_duration as number) ?? null,
    awakeTimeSeconds: (item.awake_duration as number) ?? null,
    timeInBedSeconds: (item.time_in_bed as number) ?? null,
    restlessPeriods: (item.restless_periods as number) ?? null,
    avgRestingHR: (item.average_heart_rate as number) ?? null,
    breathRate: (item.average_breath as number) ?? null,
    hrv: (item.average_hrv as number) ?? null,
    efficiency: (item.efficiency as number) ?? null,
    latencySeconds: (item.latency as number) ?? null,
    bedtimeStart: (item.bedtime_start as string) ?? null,
    bedtimeEnd: (item.bedtime_end as string) ?? null,
  }))
}

// ── Daily sleep scores (/daily_sleep gives the score; /sleep gives metrics) ──

export async function getDailySleepScores(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest("/daily_sleep", client.accessToken, userId, {
    start_date: startDate, end_date: endDate,
  })
  return (data.data || []).map((item: Record<string, unknown>) => ({
    date: item.day as string,
    score: (item.score as number) ?? null,
  }))
}

// ── Daily readiness (score, skin temperature) ────────────────────────────────

export async function getDailyReadiness(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest("/daily_readiness", client.accessToken, userId, {
    start_date: startDate, end_date: endDate,
  })
  return (data.data || []).map((item: Record<string, unknown>) => ({
    date: item.day as string,
    score: (item.score as number) ?? null,
    skinTemp: (item.temperature_deviation as number) ?? null,
  }))
}

// ── Daily SpO2 ───────────────────────────────────────────────────────────────

export async function getDailySpo2(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest("/daily_spo2", client.accessToken, userId, {
    start_date: startDate, end_date: endDate,
  })
  return (data.data || []).map((item: Record<string, unknown>) => {
    const pct = item.spo2_percentage as Record<string, number> | null
    return {
      date: item.day as string,
      spo2: pct?.average ?? null,
      breathingDisturbance: (item.breathing_disturbance_index as number) ?? null,
    }
  })
}

// ── Daily stress ─────────────────────────────────────────────────────────────

export async function getDailyStress(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest("/daily_stress", client.accessToken, userId, {
    start_date: startDate, end_date: endDate,
  })
  return (data.data || []).map((item: Record<string, unknown>) => ({
    date: item.day as string,
    stressHighMin: item.stress_high != null ? Math.round((item.stress_high as number) / 60) : null,
    recoveryHighMin: item.recovery_high != null ? Math.round((item.recovery_high as number) / 60) : null,
  }))
}

// ── Workouts ─────────────────────────────────────────────────────────────────

export async function getActivitySessions(userId: string, startDate: string, endDate: string) {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest("/workout", client.accessToken, userId, {
    start_date: startDate, end_date: endDate,
  })
  return (data.data || []).map((item: Record<string, unknown>) => ({
    id: item.id,
    name: (item.title as string) ?? "Workout",
    activityType: item.activity,
    start: item.start_datetime,
    end: item.end_datetime,
    durationMinutes: item.duration ? Math.round((item.duration as number) / 60) : null,
    calories: (item.calories as number) ?? null,
    distance: (item.distance as number) ?? null,
  }))
}

// ── Oura Tags (user-created annotations) ─────────────────────────────────────

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function resolveTagName(customName: unknown, typeCode: unknown, comment: unknown): string {
  // 1. custom_name — user-defined label for the tag type
  if (typeof customName === "string" && customName.trim() && !UUID_PATTERN.test(customName.trim())) {
    return customName.trim()
  }
  // 2. tag_type_code starting with "tag_" — strip prefix and title-case
  if (typeof typeCode === "string" && typeCode.startsWith("tag_")) {
    const readable = typeCode.slice(4).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    if (readable) return readable
  }
  // 3. comment / note / text — per-entry description written by the user
  const commentStr = [comment].find(v => typeof v === "string" && (v as string).trim() && !UUID_PATTERN.test((v as string).trim()))
  if (commentStr) return (commentStr as string).trim()
  return ""
}

export interface OuraTagEntry {
  id: string
  day: string
  timestamp: string
  tagName: string
  comment: string | null
  tags: string[]
  uuid: string | null
}

export async function getOuraTags(userId: string, startDate: string, endDate: string): Promise<OuraTagEntry[]> {
  const client = await buildOuraClient(userId)
  const data = await makeOuraRequest("/enhanced_tag", client.accessToken, userId, {
    start_date: startDate, end_date: endDate,
  })
  return (data.data ?? []).map((item: Record<string, unknown>) => {
    // Try all text fields Oura might use for the per-entry description
    const commentText = (item.comment ?? item.note ?? item.text ?? item.label ?? item.title ?? null) as string | null
    const name = resolveTagName(item.custom_name, item.tag_type_code, commentText)
    const uuid = item.tag_type_code && UUID_PATTERN.test(String(item.tag_type_code))
      ? String(item.tag_type_code)
      : null
    return {
      id: item.id as string,
      day: item.day as string,
      timestamp: (item.start_time as string) ?? (item.day as string),
      tagName: name,
      comment: commentText || null,
      tags: item.tag_type_code ? [item.tag_type_code as string] : [],
      uuid,
    }
  })
}

// ── Legacy helpers (used by MCP route) ───────────────────────────────────────

export async function getSteps(userId: string, startDate: string, endDate: string) {
  const rows = await getDailyActivity(userId, startDate, endDate)
  return rows.map((r: Awaited<ReturnType<typeof getDailyActivity>>[number]) => ({ date: r.date, steps: r.steps ?? 0 }))
}

export async function getCalories(userId: string, startDate: string, endDate: string) {
  const rows = await getDailyActivity(userId, startDate, endDate)
  return rows.map((r: Awaited<ReturnType<typeof getDailyActivity>>[number]) => ({ date: r.date, calories: r.activeCalories ?? 0 }))
}

export async function getHeartRate(userId: string, startDate: string, endDate: string) {
  const rows = await getDailySleep(userId, startDate, endDate)
  return rows.map((r: Awaited<ReturnType<typeof getDailySleep>>[number]) => ({ date: r.date, avgBpm: r.avgRestingHR, minBpm: null, maxBpm: null }))
}

export async function getSleep(userId: string, startDate: string, endDate: string) {
  return getDailySleep(userId, startDate, endDate)
}

export async function getWeight(_userId: string, _startDate: string, _endDate: string) {
  return []
}

export async function getDistance(userId: string, startDate: string, endDate: string) {
  const rows = await getDailyActivity(userId, startDate, endDate)
  return rows.map((r: Awaited<ReturnType<typeof getDailyActivity>>[number]) => ({ date: r.date, distanceMeters: r.distanceKm != null ? Math.round(r.distanceKm * 1000) : 0 }))
}

export async function getDailySummary(userId: string, date: string) {
  const [activity, sleep] = await Promise.all([
    getDailyActivity(userId, date, date),
    getDailySleep(userId, date, date),
  ])
  return {
    date,
    steps: activity[0]?.steps ?? 0,
    caloriesBurned: activity[0]?.activeCalories ?? 0,
    avgHeartRateBpm: sleep[0]?.avgRestingHR ?? null,
    distanceMeters: activity[0]?.distanceKm != null ? Math.round(activity[0].distanceKm * 1000) : 0,
  }
}
