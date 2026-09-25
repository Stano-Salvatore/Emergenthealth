// What was listened to, for readers that speak — the chat tool and the MCP
// tool. The correlation engine keeps its own read of the same table because
// it wants day-shaped factors; this wants the story of a stretch: how much,
// what, and who dominated.
//
// The nullable columns stay nullable on the way out. listeningMin null means
// "imported before minutes were counted", and presenting it as 0 would tell
// the reader a day of music was silence — the same lie the schema comment
// warns about.

import { prisma } from "@/lib/prisma"

export interface MusicDay {
  date: string
  tracksPlayed: number
  listeningMin: number | null
  topArtist: string | null
  topTrack: string | null
  /** Tracks after 22:00 local; null on rows older than the column. */
  lateTracks: number | null
}

export interface MusicRange {
  days: MusicDay[]
  totalTracks: number
  /** Sum of the KNOWN minutes only — null days contribute nothing, not zero. */
  totalMin: number
  topArtists: { artist: string; plays: number; genre: string | null }[]
}

/** Inclusive [from, to] as local YYYY-MM-DD strings, the way the table is keyed. */
export async function musicRange(userId: string, from: string, to: string): Promise<MusicRange> {
  const rows = await prisma.lastfmLog.findMany({
    where: { userId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
    select: {
      date: true, tracksPlayed: true, listeningMin: true,
      topArtist: true, topTrack: true, lateTracks: true, artistPlays: true,
    },
  }).catch(() => [] as {
    date: string; tracksPlayed: number; listeningMin: number | null
    topArtist: string | null; topTrack: string | null; lateTracks: number | null
    artistPlays: unknown
  }[])

  // Per-artist counts where the rows carry them; the old topArtist as a
  // one-per-day vote where they do not. Mixed histories mix the two, which
  // undercounts the old days — better than inventing counts for them.
  const plays = new Map<string, number>()
  for (const r of rows) {
    const ap = r.artistPlays
    if (ap && typeof ap === "object" && !Array.isArray(ap)) {
      for (const [artist, n] of Object.entries(ap as Record<string, unknown>)) {
        const count = Number(n)
        if (Number.isFinite(count) && count > 0) plays.set(artist.toLowerCase(), (plays.get(artist.toLowerCase()) ?? 0) + count)
      }
    } else if (r.topArtist) {
      const a = r.topArtist.toLowerCase()
      plays.set(a, (plays.get(a) ?? 0) + 1)
    }
  }

  const ranked = [...plays.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  const genres = ranked.length
    ? await prisma.artistGenre.findMany({
        where: { artist: { in: ranked.map(([a]) => a) } },
        select: { artist: true, genre: true },
      }).catch(() => [] as { artist: string; genre: string | null }[])
    : []
  const genreOf = new Map(genres.map(g => [g.artist, g.genre]))

  return {
    days: rows.map(r => ({
      date: r.date,
      tracksPlayed: r.tracksPlayed,
      listeningMin: r.listeningMin,
      topArtist: r.topArtist,
      topTrack: r.topTrack,
      lateTracks: r.lateTracks,
    })),
    totalTracks: rows.reduce((s, r) => s + r.tracksPlayed, 0),
    totalMin: rows.reduce((s, r) => s + (r.listeningMin ?? 0), 0),
    topArtists: ranked.map(([artist, n]) => ({ artist, plays: n, genre: genreOf.get(artist) ?? null })),
  }
}
