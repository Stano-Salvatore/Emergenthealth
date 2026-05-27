import { prisma } from "@/lib/prisma"

export async function ensureStravaTable(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "StravaToken" (
      "userId"       TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
      "accessToken"  TEXT NOT NULL,
      "refreshToken" TEXT NOT NULL,
      "expiresAt"    BIGINT NOT NULL,
      "athleteId"    TEXT,
      "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "StravaActivity" (
      "id"             TEXT PRIMARY KEY,
      "userId"         TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "stravaId"       TEXT NOT NULL,
      "type"           TEXT NOT NULL,
      "name"           TEXT,
      "distanceM"      FLOAT,
      "movingTimeSec"  INTEGER NOT NULL,
      "elapsedTimeSec" INTEGER NOT NULL,
      "elevationM"     FLOAT,
      "avgHR"          INTEGER,
      "maxHR"          INTEGER,
      "startDate"      TIMESTAMPTZ NOT NULL,
      "day"            TEXT NOT NULL,
      UNIQUE("userId", "stravaId")
    )
  `
}

interface StravaTokenRow {
  userId: string
  accessToken: string
  refreshToken: string
  expiresAt: bigint
  athleteId: string | null
}

export async function getStravaToken(userId: string): Promise<string> {
  const rows = await prisma.$queryRaw<StravaTokenRow[]>`
    SELECT "userId", "accessToken", "refreshToken", "expiresAt", "athleteId"
    FROM "StravaToken"
    WHERE "userId" = ${userId}
  `
  const row = rows[0]
  if (!row) throw new Error("Strava not connected")

  // expiresAt is a Unix timestamp (seconds). Refresh if within 5 minutes.
  const expiresAtMs = Number(row.expiresAt) * 1000
  if (Date.now() >= expiresAtMs - 5 * 60 * 1000) {
    return refreshStravaToken(userId, row.refreshToken)
  }
  return row.accessToken
}

async function refreshStravaToken(userId: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  })
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.statusText}`)
  const data = await res.json()
  await prisma.$executeRaw`
    UPDATE "StravaToken"
    SET "accessToken" = ${data.access_token},
        "refreshToken" = ${data.refresh_token ?? refreshToken},
        "expiresAt" = ${BigInt(data.expires_at)},
        "updatedAt" = NOW()
    WHERE "userId" = ${userId}
  `
  return data.access_token as string
}
