// Loading location points for the coarse day/trip analysis.
//
// Apart from lib/day-location so that file stays pure and testable; this is
// the database half, shared by the API route and the MCP tool.

import { prisma } from "./prisma"
import type { DatedPoint } from "./day-location"

// One fix per quarter hour per source is plenty to place a day. A phone
// reporting every five minutes puts 288 rows into a day, and 287 of them say
// the same thing at this resolution. Thinning in SQL is what makes a two-year
// window answerable at all — and it keeps the hours-covered count intact,
// which a LIMIT on raw rows would not.
//
// The 900 is written into the SQL rather than bound as a parameter: Postgres
// requires the DISTINCT ON expression to match the leading ORDER BY one, and
// two occurrences of the same bound parameter are two different expression
// nodes to the planner, which rejects the query.

/**
 * Ceiling on rows returned. Ordered newest-first before the cut, so a window
 * too big to load loses its oldest end rather than its most recent one — the
 * opposite of what a plain `take` on an ascending query does.
 */
const MAX_ROWS = 50_000

export interface LoadedPoint extends DatedPoint {
  source: string
}

export interface LoadedPoints {
  points: LoadedPoint[]
  /** True row counts by source, before thinning — so the UI can be honest. */
  countsBySource: Record<string, number>
  /** Set when the window was too large and its oldest end was dropped. */
  truncated: boolean
}

export async function loadCoarsePoints(userId: string, since: Date): Promise<LoadedPoints> {
  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<{ lat: number; lng: number; trackedAt: Date; source: string }[]>`
      SELECT lat, lng, "trackedAt", source FROM (
        SELECT DISTINCT ON (source, floor(extract(epoch FROM "trackedAt") / 900))
          lat, lng, "trackedAt", source
        FROM "LocationPoint"
        WHERE "userId" = ${userId} AND "trackedAt" >= ${since}
        ORDER BY source, floor(extract(epoch FROM "trackedAt") / 900), "trackedAt"
      ) t
      ORDER BY "trackedAt" DESC
      LIMIT ${MAX_ROWS}
    `.catch(() => []),
    prisma.$queryRaw<{ source: string; n: bigint }[]>`
      SELECT source, COUNT(*) AS n FROM "LocationPoint"
      WHERE "userId" = ${userId} AND "trackedAt" >= ${since}
      GROUP BY source
    `.catch(() => []),
  ])

  const countsBySource: Record<string, number> = {}
  for (const c of counts) countsBySource[c.source] = Number(c.n)

  return {
    points: rows
      .map(r => ({ lat: r.lat, lng: r.lng, at: r.trackedAt, source: r.source }))
      .reverse(),
    countsBySource,
    truncated: rows.length >= MAX_ROWS,
  }
}
