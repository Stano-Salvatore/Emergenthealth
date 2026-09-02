import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getLastfmKey, syncLastfm, syncArtistGenres } from "@/lib/lastfm"

export const runtime = "nodejs"
// The sync pages the Last.fm API, and the genre pass behind it makes one
// request per untagged artist. On the default function budget that pass was
// killed mid-loop, which read as "genres silently don't work".
export const maxDuration = 60

interface LastfmLogRow {
  id: string
  userId: string
  date: string
  tracksPlayed: number
  listeningMin: number
  lateTracks: number | null
  topArtist: string | null
  topTrack: string | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id


  const keyRow = await getLastfmKey(userId).catch(() => null)
  const hasKey = !!keyRow
  const username = keyRow?.username ?? null

  const logs = await prisma.$queryRaw<LastfmLogRow[]>`
    SELECT "id", "userId", "date", "tracksPlayed", "listeningMin", "lateTracks", "topArtist", "topTrack"
    FROM "LastfmLog"
    WHERE "userId" = ${userId}
      AND "date" >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')
    ORDER BY "date" DESC
  `.catch(() => [] as LastfmLogRow[])

  return NextResponse.json({ hasKey, username, logs })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => ({}))
  const action: string = typeof body.action === "string" ? body.action : ""


  if (action === "save") {
    const apiKey: string = typeof body.apiKey === "string" ? body.apiKey.trim() : ""
    const username: string = typeof body.username === "string" ? body.username.trim() : ""
    if (!apiKey || !username) return NextResponse.json({ error: "apiKey and username required" }, { status: 400 })

    await prisma.$executeRaw`
      INSERT INTO "LastfmKey" ("userId", "apiKey", "username", "updatedAt")
      VALUES (${userId}, ${apiKey}, ${username}, NOW())
      ON CONFLICT ("userId") DO UPDATE
        SET "apiKey"    = EXCLUDED."apiKey",
            "username"  = EXCLUDED."username",
            "updatedAt" = NOW()
    `
    return NextResponse.json({ ok: true })
  }

  if (action === "sync") {
    const keyRow = await getLastfmKey(userId)
    if (!keyRow) return NextResponse.json({ error: "Not connected" }, { status: 400 })

    try {
      // The first sync after connecting reaches back a year; every later one
      // only needs the recent window. Without this the history starts on the
      // day the key was pasted, and a correlation needs more days than that.
      const existing = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM "LastfmLog" WHERE "userId" = ${userId}
      `.catch(() => [{ n: BigInt(1) }])
      const first = Number(existing[0]?.n ?? 1) === 0

      // An explicit backfill wins over both. Connecting is not the only moment
      // a longer reach is wanted: anyone who was already syncing when the
      // one-year first sync landed would otherwise be stuck on thirty days for
      // ever, because their table is not empty any more.
      const asked = Number(body.days)
      const days = Number.isFinite(asked) && asked > 0
        ? Math.min(asked, 730)
        : first ? 365 : 30

      const result = await syncLastfm(userId, keyRow.apiKey, keyRow.username, { days })
      // Fill in genres for any artists the sync surfaced — best-effort, capped,
      // and cumulative: a library of hundreds completes over a few syncs.
      const genres = await syncArtistGenres(userId, keyRow.apiKey).catch(() => null)
      return NextResponse.json({
        ...result,
        genresTagged: genres?.tagged ?? 0,
        genresRemaining: genres?.remaining ?? 0,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed"
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  if (action === "delete") {
    await prisma.$executeRaw`
      DELETE FROM "LastfmKey" WHERE "userId" = ${userId}
    `.catch(() => null)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
