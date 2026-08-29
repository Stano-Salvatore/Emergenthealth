import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { randomUUID } from "crypto"

// Last.fm scrobbles, summarised into one row per day.
//
// Three things here are less obvious than they look:
//
//  · The API returns at most 200 tracks per request, newest first. Asking once
//    and stopping meant that anyone who played more than 200 tracks inside the
//    window got only the most recent ones — the older days of the window came
//    back empty and were filed as silence. Every "quiet day" in the music
//    correlations could be an artefact of that. So this pages.
//  · A scrobble is bucketed into the LISTENER'S day, not UTC's. Half an hour
//    past midnight in Bratislava is still 22:30 UTC, and late-night listening
//    is exactly the listening you would want to compare against sleep.
//  · Minutes are an ESTIMATE — three per track. Last.fm does not return track
//    durations on this endpoint, and fetching them would be one extra request
//    per track. Anything shown to the user says so.

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
  // Added after the table existed, so it needs its own statement — CREATE
  // TABLE IF NOT EXISTS does nothing to a table that is already there.
  await prisma.$executeRaw`
    ALTER TABLE "LastfmLog" ADD COLUMN IF NOT EXISTS "lateTracks" INTEGER NOT NULL DEFAULT 0
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

/** Rough minutes per scrobble. See the note at the top — it is an estimate. */
export const MINUTES_PER_TRACK = 3

/** Local hours that count as listening into the night. */
const LATE_FROM_HOUR = 22
const LATE_UNTIL_HOUR = 4

/** Newest-first, 200 at a time; the cap stops a runaway backfill. */
const PAGE_SIZE = 200
const MAX_PAGES = 50

export interface DayBucket {
  tracks: number
  late: number
  artists: Record<string, number>
  titles: Record<string, number>
}

/** The most-played name in a tally, or null. Ties break alphabetically so the
 * same day always reports the same winner. */
function topOf(tally: Record<string, number>): string | null {
  const entries = Object.entries(tally)
  if (entries.length === 0) return null
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return entries[0][0]
}

/**
 * Fold scrobbles into per-day buckets, in the listener's own timezone.
 *
 * Exported and pure so the bucketing can be tested without the network.
 */
export function bucketScrobbles(tracks: LastfmTrack[], timezone: string): Record<string, DayBucket> {
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    })
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    })
  }

  const byDate: Record<string, DayBucket> = {}
  for (const track of tracks) {
    if (!track.date?.uts) continue // a "now playing" row has no time
    const at = new Date(Number(track.date.uts) * 1000)
    if (Number.isNaN(at.getTime())) continue

    const parts: Record<string, string> = {}
    for (const part of fmt.formatToParts(at)) {
      if (part.type !== "literal") parts[part.type] = part.value
    }
    const date = `${parts.year}-${parts.month}-${parts.day}`
    const hour = Number(parts.hour) % 24 // some ICU builds render midnight as 24

    const bucket = byDate[date] ?? (byDate[date] = { tracks: 0, late: 0, artists: {}, titles: {} })
    bucket.tracks++
    if (hour >= LATE_FROM_HOUR || hour < LATE_UNTIL_HOUR) bucket.late++

    const artist = track.artist?.["#text"] ?? ""
    if (artist) bucket.artists[artist] = (bucket.artists[artist] ?? 0) + 1
    if (track.name) bucket.titles[track.name] = (bucket.titles[track.name] ?? 0) + 1
  }
  return byDate
}

/**
 * Every scrobble since `from`, following the pagination.
 *
 * Split out from the sync so the paging can be tested without a database: the
 * bug this replaces was that there was no paging at all, and the 201st track
 * back simply did not exist as far as this app was concerned.
 */
export async function fetchRecentTracks(
  apiKey: string,
  username: string,
  from: number,
): Promise<{ tracks: LastfmTrack[]; pages: number; truncated: boolean }> {
  const tracks: LastfmTrack[] = []
  let totalPages = 1
  let read = 0

  for (let page = 1; page <= totalPages && page <= MAX_PAGES; page++) {
    const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks`
      + `&user=${encodeURIComponent(username)}&api_key=${encodeURIComponent(apiKey)}`
      + `&format=json&limit=${PAGE_SIZE}&from=${from}&page=${page}`

    const res = await fetch(url)
    // A failure on the first page is a real failure; on a later one, keep the
    // pages already read rather than throwing the whole sync away.
    if (!res.ok) {
      if (page === 1) throw new Error(`Last.fm API error: ${res.status}`)
      break
    }
    read = page

    const data = await res.json() as {
      recenttracks?: { track?: LastfmTrack[] | LastfmTrack; "@attr"?: { totalPages?: string } }
    }
    const raw = data.recenttracks?.track
    // A single scrobble comes back as an object rather than a one-element array.
    const batch = Array.isArray(raw) ? raw : raw ? [raw] : []
    tracks.push(...batch)

    const reported = Number(data.recenttracks?.["@attr"]?.totalPages)
    if (page === 1 && Number.isFinite(reported) && reported > 0) totalPages = reported
    if (batch.length === 0) break
  }

  return { tracks, pages: read, truncated: totalPages > MAX_PAGES }
}

export interface LastfmSyncResult {
  synced: number
  tracks: number
  pages: number
  /** True when the page cap was hit — there is more history than was read. */
  truncated: boolean
}

export async function syncLastfm(
  userId: string,
  apiKey: string,
  username: string,
  opts: { days?: number } = {},
): Promise<LastfmSyncResult> {
  const days = Math.min(Math.max(opts.days ?? 30, 1), 730)
  const from = Math.floor((Date.now() - days * 86400000) / 1000)

  const { tracks: all, pages, truncated } = await fetchRecentTracks(apiKey, username, from)

  const timezone = await getUserTimezone(userId).catch(() => "UTC")
  const byDate = bucketScrobbles(all, timezone)

  let synced = 0
  for (const [date, bucket] of Object.entries(byDate)) {
    const tracksPlayed = bucket.tracks
    const listeningMin = tracksPlayed * MINUTES_PER_TRACK
    const topArtist = topOf(bucket.artists)
    const topTrack = topOf(bucket.titles)
    const id = randomUUID()

    await prisma.$executeRaw`
      INSERT INTO "LastfmLog" ("id", "userId", "date", "tracksPlayed", "listeningMin", "topArtist", "topTrack", "lateTracks")
      VALUES (${id}, ${userId}, ${date}, ${tracksPlayed}, ${listeningMin}, ${topArtist}, ${topTrack}, ${bucket.late})
      ON CONFLICT ("userId", "date") DO UPDATE
        SET "tracksPlayed" = EXCLUDED."tracksPlayed",
            "listeningMin" = EXCLUDED."listeningMin",
            "topArtist"    = EXCLUDED."topArtist",
            "topTrack"     = EXCLUDED."topTrack",
            "lateTracks"   = EXCLUDED."lateTracks"
    `
    synced++
  }

  return { synced, tracks: all.length, pages, truncated }
}
