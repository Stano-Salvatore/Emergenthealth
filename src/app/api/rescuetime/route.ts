import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ensureRescuetimeTable, getRescuetimeKey, syncRescuetime } from "@/lib/rescuetime"

interface RescuetimeLogRow {
  id: string
  userId: string
  date: string
  productivityScore: number | null
  totalActiveH: number | null
  productiveH: number | null
  neutralH: number | null
  distractingH: number | null
  topCategory: string | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  await ensureRescuetimeTable().catch(() => null)

  const keyRows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "RescuetimeKey" WHERE "userId" = ${userId} LIMIT 1
  `.catch(() => [] as { userId: string }[])
  const hasKey = keyRows.length > 0

  const logs = await prisma.$queryRaw<RescuetimeLogRow[]>`
    SELECT "id", "userId", "date", "productivityScore", "totalActiveH", "productiveH", "neutralH", "distractingH", "topCategory"
    FROM "RescuetimeLog"
    WHERE "userId" = ${userId}
      AND "date" >= (NOW() - INTERVAL '30 days')::TEXT::DATE::TEXT
    ORDER BY "date" DESC
  `.catch(() => [] as RescuetimeLogRow[])

  return NextResponse.json({ hasKey, logs })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => ({}))
  const action: string = typeof body.action === "string" ? body.action : ""

  await ensureRescuetimeTable().catch(() => null)

  if (action === "save_key") {
    const apiKey: string = typeof body.apiKey === "string" ? body.apiKey.trim() : ""
    if (!apiKey) return NextResponse.json({ error: "apiKey required" }, { status: 400 })

    await prisma.$executeRaw`
      INSERT INTO "RescuetimeKey" ("userId", "apiKey", "updatedAt")
      VALUES (${userId}, ${apiKey}, NOW())
      ON CONFLICT ("userId") DO UPDATE
        SET "apiKey"    = EXCLUDED."apiKey",
            "updatedAt" = NOW()
    `
    return NextResponse.json({ ok: true })
  }

  if (action === "sync") {
    const apiKey = await getRescuetimeKey(userId)
    if (!apiKey) return NextResponse.json({ error: "No API key configured" }, { status: 400 })

    try {
      const result = await syncRescuetime(userId, apiKey)
      return NextResponse.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed"
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  if (action === "delete_key") {
    await prisma.$executeRaw`
      DELETE FROM "RescuetimeKey" WHERE "userId" = ${userId}
    `.catch(() => null)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
