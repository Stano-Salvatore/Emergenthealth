import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

interface GitHubProfileRow {
  userId: string
  username: string
  accessToken: string | null
}

interface PushEvent {
  type: string
  created_at: string
  payload: {
    commits?: { sha: string }[]
    size?: number
  }
}

async function ensureGitHubTable(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "GitHubProfile" (
      "userId"      TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
      "username"    TEXT NOT NULL,
      "accessToken" TEXT,
      "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

function calcStreak(commitsByDay: Record<string, number>): number {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const start = commitsByDay[today] != null ? today : commitsByDay[yesterday] != null ? yesterday : null
  if (!start) return 0
  let streak = 0
  let cur = new Date(start)
  while (commitsByDay[cur.toISOString().slice(0, 10)] != null) {
    streak++
    cur = new Date(cur.getTime() - 86400000)
  }
  return streak
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  await ensureGitHubTable().catch(() => null)

  const rows = await prisma.$queryRaw<GitHubProfileRow[]>`
    SELECT "userId", "username", "accessToken" FROM "GitHubProfile" WHERE "userId" = ${userId}
  `.catch(() => [] as GitHubProfileRow[])

  const profile = rows[0]
  if (!profile) {
    return NextResponse.json({ username: null, commitsByDay: {}, streak: 0, totalThisWeek: 0 })
  }

  const headers: Record<string, string> = {
    "User-Agent": "emergenthealth/1.0",
    Accept: "application/vnd.github+json",
  }
  if (profile.accessToken) {
    headers["Authorization"] = `Bearer ${profile.accessToken}`
  }

  const eventsRes = await fetch(
    `https://api.github.com/users/${profile.username}/events?per_page=100`,
    { headers },
  ).catch(() => null)

  if (!eventsRes || !eventsRes.ok) {
    return NextResponse.json({ username: profile.username, commitsByDay: {}, streak: 0, totalThisWeek: 0 })
  }

  const events: PushEvent[] = await eventsRes.json().catch(() => [])

  const commitsByDay: Record<string, number> = {}
  for (const event of events) {
    if (event.type !== "PushEvent") continue
    const day = event.created_at.slice(0, 10)
    const count = event.payload.commits?.length ?? event.payload.size ?? 0
    commitsByDay[day] = (commitsByDay[day] ?? 0) + count
  }

  const streak = calcStreak(commitsByDay)

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const totalThisWeek = Object.entries(commitsByDay)
    .filter(([day]) => day >= weekAgo)
    .reduce((sum, [, count]) => sum + count, 0)

  return NextResponse.json({ username: profile.username, commitsByDay, streak, totalThisWeek })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => ({}))
  const username: string = typeof body.username === "string" ? body.username.trim() : ""
  const accessToken: string | null = typeof body.accessToken === "string" && body.accessToken.trim()
    ? body.accessToken.trim()
    : null

  await ensureGitHubTable().catch(() => null)

  if (!username) {
    // Disconnect
    await prisma.$executeRaw`
      DELETE FROM "GitHubProfile" WHERE "userId" = ${userId}
    `.catch(() => null)
    return NextResponse.json({ ok: true })
  }

  await prisma.$executeRaw`
    INSERT INTO "GitHubProfile" ("userId", "username", "accessToken", "updatedAt")
    VALUES (${userId}, ${username}, ${accessToken}, NOW())
    ON CONFLICT ("userId") DO UPDATE
      SET "username"    = EXCLUDED."username",
          "accessToken" = EXCLUDED."accessToken",
          "updatedAt"   = NOW()
  `

  return NextResponse.json({ ok: true })
}
