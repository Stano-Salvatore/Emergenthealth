import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { ensureLastfmTables, bucketScrobbles, getLastfmKey, syncArtistGenres, MINUTES_PER_TRACK, type DayBucket } from "@/lib/lastfm"
import { randomUUID } from "crypto"

// YouTube Music history from a Takeout, folded into the same per-day rows
// Last.fm scrobbles land in — so the music correlations, the Last.fm page and
// Emergy's context all reach months further back without learning a new table.
//
// Import NEVER overwrites: a day that already has a row (from Last.fm, or an
// earlier run of this import) keeps it. Last.fm is the richer, live source
// where the two overlap, and re-importing the same Takeout must not
// double-count anything. Backfill fills silence; it does not argue.

export const runtime = "nodejs"
// Months of day-rows plus a genre-tagging pass — more than the default
// function budget allows.
export const maxDuration = 60

interface IncomingPlay { name: string; artist: string; uts: number }

const MAX_PLAYS = 200_000

/** The most-played name in a tally — same tie-break the Last.fm sync uses. */
function topOf(tally: Record<string, number>): string | null {
  const entries = Object.entries(tally)
  if (entries.length === 0) return null
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return entries[0][0]
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as { plays?: unknown } | null
  if (!body || !Array.isArray(body.plays)) {
    return NextResponse.json({ error: "plays[] required" }, { status: 400 })
  }
  if (body.plays.length > MAX_PLAYS) {
    return NextResponse.json({ error: `Too many plays in one request (max ${MAX_PLAYS})` }, { status: 400 })
  }

  const nowSec = Math.floor(Date.now() / 1000) + 86_400
  const plays: IncomingPlay[] = []
  for (const raw of body.plays) {
    const p = raw as Partial<IncomingPlay>
    if (typeof p?.name !== "string" || !p.name.trim()) continue
    if (typeof p?.uts !== "number" || !Number.isFinite(p.uts)) continue
    // Plausible listening only: nothing before Last.fm existed, nothing from
    // the future — a garbled timestamp must not mint a phantom day.
    if (p.uts < 946_684_800 || p.uts > nowSec) continue
    plays.push({
      name: p.name.slice(0, 300),
      artist: typeof p.artist === "string" ? p.artist.slice(0, 300) : "",
      uts: Math.floor(p.uts),
    })
  }
  if (plays.length === 0) {
    return NextResponse.json({ error: "No usable plays in the file" }, { status: 400 })
  }

  await ensureLastfmTables().catch(() => null)
  const timezone = await getUserTimezone(userId).catch(() => "UTC")

  // Same shape the Last.fm API returns, so the exact same bucketing runs —
  // listener-local days, the 22:00–04:00 late window, top artist and track.
  const byDate = bucketScrobbles(
    plays.map(p => ({ name: p.name, artist: { "#text": p.artist }, date: { uts: String(p.uts) } })),
    timezone,
  )

  let inserted = 0
  let skipped = 0
  const dates = Object.keys(byDate).sort()
  for (const date of dates) {
    const bucket: DayBucket = byDate[date]
    const wrote = await prisma.$executeRaw`
      INSERT INTO "LastfmLog" ("id", "userId", "date", "tracksPlayed", "listeningMin", "topArtist", "topTrack", "lateTracks")
      VALUES (${randomUUID()}, ${userId}, ${date}, ${bucket.tracks}, ${bucket.tracks * MINUTES_PER_TRACK},
              ${topOf(bucket.artists)}, ${topOf(bucket.titles)}, ${bucket.late})
      ON CONFLICT ("userId", "date") DO NOTHING
    `
    if (wrote > 0) inserted++
    else skipped++
  }

  // The import can bring months of artists the genre table has never seen.
  // Tagging needs a Last.fm API key; without one connected this quietly waits
  // for the first Last.fm sync to catch the same artists up.
  const keyRow = await getLastfmKey(userId).catch(() => null)
  if (keyRow) await syncArtistGenres(userId, keyRow.apiKey).catch(() => null)

  return NextResponse.json({
    days: inserted,
    skippedDays: skipped,
    tracks: plays.length,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
  })
}
