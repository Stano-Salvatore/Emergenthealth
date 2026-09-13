import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { userToday } from "@/lib/user-timezone"
import { dailyTagsKey, normaliseTags } from "@/lib/daily-tags"

// Kept as a function so both handlers share it; it needs the user now.
async function todayStr(userId: string): Promise<string> {
  return userToday(userId)
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const date = searchParams.get("date") ?? await todayStr(userId)


  const key = dailyTagsKey(date)
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" = ${key}
    LIMIT 1
  `

  const tags: string[] = rows.length > 0 ? (JSON.parse(rows[0].value) as string[]) : []
  return NextResponse.json({ date, tags })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json() as { date?: unknown; tags?: unknown }
  const date = typeof body.date === "string" ? body.date : await todayStr(userId)
  if (!Array.isArray(body.tags)) {
    return NextResponse.json({ error: "tags must be an array" }, { status: 400 })
  }
  // The shaping rule lives in daily-tags.ts, not here. Emergy writes these
  // too now, and the onset family compares tags by string — two writers with
  // two rules make "Travel" and "travel" two tags with half the days each,
  // neither of which clears the threshold that would have made it testable.
  const tags = normaliseTags(body.tags)

  const key = dailyTagsKey(date)
  const value = JSON.stringify(tags)

  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, ${key}, ${value})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
  `

  return NextResponse.json({ ok: true })
}
