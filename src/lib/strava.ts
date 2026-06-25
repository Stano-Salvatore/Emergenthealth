import { prisma } from "@/lib/prisma"

export async function getStravaToken(userId: string): Promise<string> {
  const row = await prisma.stravaToken.findUnique({ where: { userId } })
  if (!row) throw new Error("Strava not connected")

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
  await prisma.stravaToken.update({
    where: { userId },
    data: {
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token ?? refreshToken) as string,
      expiresAt: BigInt(data.expires_at as number),
      updatedAt: new Date(),
    },
  })
  return data.access_token as string
}
