import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "OuraTag" (
      "id"        TEXT PRIMARY KEY,
      "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "day"       TEXT NOT NULL,
      "timestamp" TIMESTAMPTZ NOT NULL,
      "text"      TEXT,
      "tags"      TEXT[] NOT NULL DEFAULT '{}'
    )
  `
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OuraTag_userId_day_idx" ON "OuraTag"("userId","day")`
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const filter = searchParams.get("filter") ?? ""

  try {
    await ensureTable()
    const rows = await prisma.$queryRaw<
      { id: string; day: string; timestamp: Date; text: string | null; tags: string[] }[]
    >`
      SELECT "id","day","timestamp","text","tags"
      FROM "OuraTag"
      WHERE "userId" = ${userId}
      ORDER BY "timestamp" DESC
      LIMIT 200
    `

    const items = rows.filter(r => {
      if (!filter) return true
      const lower = filter.toLowerCase()
      return r.text?.toLowerCase().includes(lower) || r.tags.some(t => t.toLowerCase().includes(lower))
    })

    return NextResponse.json({ items })
  } catch (e) {
    console.error("[medications] GET error:", e)
    return NextResponse.json({ items: [], error: String(e) })
  }
}
