import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ensureLastfmTables, getLastfmKey, syncLastfm } from "@/lib/lastfm"

interface LastfmLogRow {
  id: string
  userId: string
  date: string
  tracksPlayed: number
  listeningMin: number
  topArtist: string | null
  topTrack: string | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  await ensureLastfmTables().catch(() => null)

  const keyRow = await getLastfmKey(userId).catch(() => null)
  const hasKey = !!keyRow
  const username = keyRow?.username ?? null

  const logs = await prisma.$queryRaw<LastfmLogRow[]>`
    SELECT "id", "userId", "date", "tracksPlayed", "listeningMin", "topArtist", "topTrack"
    FROM "LastfmLog"
    WHERE "userId" = ${userId}
      AND "date" >= (NOW() - INTERVAL '30 days')::TEXT::DATE::TEXT
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

  await ensureLastfmTables().catch(() => null)

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
      const result = await syncLastfm(userId, keyRow.apiKey, keyRow.username)
      return NextResponse.json(result)
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
