import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"

export async function ensureLastfmTables(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "LastfmKey" (
      "userId"    TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
      "apiKey"    TEXT NOT NULL,
      "username"  TEXT NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "LastfmLog" (
      "id"           TEXT PRIMARY KEY,
      "userId"       TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "date"         TEXT NOT NULL,
      "tracksPlayed" INTEGER NOT NULL DEFAULT 0,
      "listeningMin" INTEGER NOT NULL DEFAULT 0,
      "topArtist"    TEXT,
      "topTrack"     TEXT,
      UNIQUE("userId", "date")
    )
  `
}

export async function getLastfmKey(userId: string): Promise<{ apiKey: string; username: string } | null> {
  const rows = await prisma.$queryRaw<{ apiKey: string; username: string }[]>`
    SELECT "apiKey", "username" FROM "LastfmKey" WHERE "userId" = ${userId} LIMIT 1
  `.catch(() => [] as { apiKey: string; username: string }[])
  return rows[0] ?? null
}

interface LastfmTrack {
  name: string
  artist: { "#text": string }
  date?: { uts: string }
}

export async function syncLastfm(userId: string, apiKey: string, username: string): Promise<{ synced: number }> {
  const from = Math.floor((Date.now() - 30 * 86400000) / 1000)
  const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=200&from=${from}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Last.fm API error: ${res.status}`)

  const data = await res.json() as { recenttracks?: { track?: LastfmTrack[] } }
  const tracks = data.recenttracks?.track ?? []

  const byDate: Record<string, { count: number; artists: Record<string, number>; latestTrack: string }> = {}

  for (const track of tracks) {
    if (!track.date?.uts) continue
    const date = new Date(Number(track.date.uts) * 1000).toISOString().slice(0, 10)

    if (!byDate[date]) {
      byDate[date] = { count: 0, artists: {}, latestTrack: track.name }
    }

    byDate[date].count++
    const artist = track.artist?.["#text"] ?? ""
    if (artist) {
      byDate[date].artists[artist] = (byDate[date].artists[artist] ?? 0) + 1
    }
    byDate[date].latestTrack = track.name
  }

  let synced = 0
  for (const [date, bucket] of Object.entries(byDate)) {
    const tracksPlayed = bucket.count
    const listeningMin = tracksPlayed * 3
    const topArtist = Object.entries(bucket.artists).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const topTrack = bucket.latestTrack
    const id = randomUUID()

    await prisma.$executeRaw`
      INSERT INTO "LastfmLog" ("id", "userId", "date", "tracksPlayed", "listeningMin", "topArtist", "topTrack")
      VALUES (${id}, ${userId}, ${date}, ${tracksPlayed}, ${listeningMin}, ${topArtist}, ${topTrack})
      ON CONFLICT ("userId", "date") DO UPDATE
        SET "tracksPlayed" = EXCLUDED."tracksPlayed",
            "listeningMin" = EXCLUDED."listeningMin",
            "topArtist"    = EXCLUDED."topArtist",
            "topTrack"     = EXCLUDED."topTrack"
    `
    synced++
  }

  return { synced }
}
