import { google } from "googleapis"
import { prisma } from "@/lib/prisma"

const FIT_CLIENT_ID = process.env.GOOGLE_FIT_CLIENT_ID!
const FIT_CLIENT_SECRET = process.env.GOOGLE_FIT_CLIENT_SECRET!

// Nanoseconds per millisecond
const NS_PER_MS = 1_000_000

export function buildFitOAuthClient() {
  return new google.auth.OAuth2(
    FIT_CLIENT_ID,
    FIT_CLIENT_SECRET,
    process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/mcp/fit-auth/callback`
      : `${process.env.AUTH_URL}/api/mcp/fit-auth/callback`,
  )
}

async function buildFitClient(userId: string) {
  const stored = await prisma.fitToken.findUnique({ where: { userId } })
  if (!stored?.accessToken) throw new Error("Google Fit not connected. Visit /api/mcp/fit-auth to authorize.")

  const oauth2 = buildFitOAuthClient()
  oauth2.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken ?? undefined,
    expiry_date: stored.expiresAt?.getTime(),
  })

  oauth2.on("tokens", async (tokens) => {
    await prisma.fitToken.update({
      where: { userId },
      data: {
        accessToken: tokens.access_token ?? stored.accessToken,
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        ...(tokens.expiry_date && { expiresAt: new Date(tokens.expiry_date) }),
      },
    })
  })

  return google.fitness({ version: "v1", auth: oauth2 })
}

function toNs(ms: number) {
  return String(ms * NS_PER_MS)
}

function dateRangeNs(startDateStr: string, endDateStr: string) {
  const start = new Date(startDateStr).getTime()
  const end = new Date(endDateStr).setHours(23, 59, 59, 999)
  return { startTimeNs: toNs(start), endTimeNs: toNs(end as number) }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sumBuckets(buckets: any[], field: "intVal" | "fpVal"): number[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return buckets.flatMap((b: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b.dataset ?? []).flatMap((ds: any) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ds.point ?? []).flatMap((p: any) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p.value ?? []).map((v: any) => (field === "intVal" ? (v.intVal ?? 0) : (v.fpVal ?? 0))),
      ),
    ),
  )
}

export async function getSteps(userId: string, startDate: string, endDate: string) {
  const fit = await buildFitClient(userId)
  const { startTimeNs, endTimeNs } = dateRangeNs(startDate, endDate)

  const res = await fit.users.dataset.aggregate({
    userId: "me",
    requestBody: {
      aggregateBy: [{ dataTypeName: "com.google.step_count.delta" }],
      bucketByTime: { durationMillis: String(86_400_000) },
      startTimeMillis: String(Math.floor(Number(startTimeNs) / NS_PER_MS)),
      endTimeMillis: String(Math.floor(Number(endTimeNs) / NS_PER_MS)),
    },
  })

  return (res.data.bucket ?? []).map((b) => ({
    date: b.startTimeMillis ? new Date(Number(b.startTimeMillis)).toISOString().split("T")[0] : null,
    steps: sumBuckets([b], "intVal").reduce((a, v) => a + v, 0),
  }))
}

export async function getCalories(userId: string, startDate: string, endDate: string) {
  const fit = await buildFitClient(userId)
  const { startTimeNs: _s, endTimeNs: _e } = dateRangeNs(startDate, endDate)
  const startMs = new Date(startDate).getTime()
  const endMs = new Date(endDate).setHours(23, 59, 59, 999) as number

  const res = await fit.users.dataset.aggregate({
    userId: "me",
    requestBody: {
      aggregateBy: [{ dataTypeName: "com.google.calories.expended" }],
      bucketByTime: { durationMillis: String(86_400_000) },
      startTimeMillis: String(startMs),
      endTimeMillis: String(endMs),
    },
  })

  return (res.data.bucket ?? []).map((b) => ({
    date: b.startTimeMillis ? new Date(Number(b.startTimeMillis)).toISOString().split("T")[0] : null,
    calories: Math.round(sumBuckets([b], "fpVal").reduce((a, v) => a + v, 0)),
  }))
}

export async function getHeartRate(userId: string, startDate: string, endDate: string) {
  const fit = await buildFitClient(userId)
  const startMs = new Date(startDate).getTime()
  const endMs = new Date(endDate).setHours(23, 59, 59, 999) as number

  const res = await fit.users.dataset.aggregate({
    userId: "me",
    requestBody: {
      aggregateBy: [{ dataTypeName: "com.google.heart_rate.bpm" }],
      bucketByTime: { durationMillis: String(86_400_000) },
      startTimeMillis: String(startMs),
      endTimeMillis: String(endMs),
    },
  })

  return (res.data.bucket ?? []).map((b) => {
    const vals = sumBuckets([b], "fpVal")
    return {
      date: b.startTimeMillis ? new Date(Number(b.startTimeMillis)).toISOString().split("T")[0] : null,
      avgBpm: vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) / vals.length) : null,
      minBpm: vals.length ? Math.round(Math.min(...vals)) : null,
      maxBpm: vals.length ? Math.round(Math.max(...vals)) : null,
    }
  })
}

export async function getSleep(userId: string, startDate: string, endDate: string) {
  const fit = await buildFitClient(userId)
  const startMs = new Date(startDate).getTime()
  const endMs = new Date(endDate).setHours(23, 59, 59, 999) as number

  // Sleep segments: type 1=awake, 2=sleep, 3=out-of-bed, 4=light, 5=deep, 6=REM
  const SLEEP_TYPE: Record<number, string> = { 1: "awake", 2: "sleep", 3: "out_of_bed", 4: "light", 5: "deep", 6: "rem" }

  const res = await fit.users.sessions.list({
    userId: "me",
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    activityType: [72], // sleep
  })

  return (res.data.session ?? []).map((s) => {
    const startMs = Number(s.startTimeMillis)
    const endMs = Number(s.endTimeMillis)
    const durationMin = Math.round((endMs - startMs) / 60_000)
    return {
      date: new Date(startMs).toISOString().split("T")[0],
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      durationMinutes: durationMin,
      type: s.activityType != null ? SLEEP_TYPE[s.activityType] ?? "unknown" : "unknown",
    }
  })
}

export async function getWeight(userId: string, startDate: string, endDate: string) {
  const fit = await buildFitClient(userId)
  const startMs = new Date(startDate).getTime()
  const endMs = new Date(endDate).setHours(23, 59, 59, 999) as number

  const res = await fit.users.dataset.aggregate({
    userId: "me",
    requestBody: {
      aggregateBy: [{ dataTypeName: "com.google.weight" }],
      bucketByTime: { durationMillis: String(86_400_000) },
      startTimeMillis: String(startMs),
      endTimeMillis: String(endMs),
    },
  })

  return (res.data.bucket ?? [])
    .map((b) => {
      const vals = sumBuckets([b], "fpVal")
      if (!vals.length) return null
      return {
        date: b.startTimeMillis ? new Date(Number(b.startTimeMillis)).toISOString().split("T")[0] : null,
        weightKg: Math.round(vals.reduce((a, v) => a + v, 0) / vals.length * 10) / 10,
      }
    })
    .filter(Boolean)
}

export async function getDistance(userId: string, startDate: string, endDate: string) {
  const fit = await buildFitClient(userId)
  const startMs = new Date(startDate).getTime()
  const endMs = new Date(endDate).setHours(23, 59, 59, 999) as number

  const res = await fit.users.dataset.aggregate({
    userId: "me",
    requestBody: {
      aggregateBy: [{ dataTypeName: "com.google.distance.delta" }],
      bucketByTime: { durationMillis: String(86_400_000) },
      startTimeMillis: String(startMs),
      endTimeMillis: String(endMs),
    },
  })

  return (res.data.bucket ?? []).map((b) => ({
    date: b.startTimeMillis ? new Date(Number(b.startTimeMillis)).toISOString().split("T")[0] : null,
    distanceMeters: Math.round(sumBuckets([b], "fpVal").reduce((a, v) => a + v, 0)),
  }))
}

export async function getActivitySessions(userId: string, startDate: string, endDate: string) {
  const fit = await buildFitClient(userId)
  const startMs = new Date(startDate).getTime()
  const endMs = new Date(endDate).setHours(23, 59, 59, 999) as number

  const res = await fit.users.sessions.list({
    userId: "me",
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
  })

  // Exclude sleep sessions (type 72)
  return (res.data.session ?? [])
    .filter((s) => s.activityType !== 72)
    .map((s) => ({
      id: s.id,
      name: s.name ?? "Activity",
      activityType: s.activityType,
      start: s.startTimeMillis ? new Date(Number(s.startTimeMillis)).toISOString() : null,
      end: s.endTimeMillis ? new Date(Number(s.endTimeMillis)).toISOString() : null,
      durationMinutes: s.startTimeMillis && s.endTimeMillis
        ? Math.round((Number(s.endTimeMillis) - Number(s.startTimeMillis)) / 60_000)
        : null,
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
