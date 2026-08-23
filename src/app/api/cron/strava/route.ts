import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { syncStravaForUser } from "@/lib/strava-sync"
import { recordSync } from "@/lib/sync-status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

// Server-side Strava sync for every connected user. Until this cron existed,
// activities only synced when the user pressed the button on the Strava page —
// so workout correlations and timelines quietly ran on stale data.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const tokens = await prisma.stravaToken.findMany({ select: { userId: true } }).catch(() => [])

  let totalSynced = 0
  const errors: string[] = []

  for (const { userId } of tokens) {
    const result = await syncStravaForUser(userId)
    // Record every run, good or bad: the Settings sync screen has to be
    // able to tell "synced and there was nothing new" from "has been
    // failing since Tuesday", and only the run itself knows which.
    // A user who never connected this source is neither, so is skipped.
    if (result.ok) {
      await recordSync(userId, "strava", { ok: true, items: result.synced })
    } else if (!result.notConnected) {
      await recordSync(userId, "strava", { ok: false, error: result.error })
    }
    if (result.ok) {
      totalSynced += result.synced
    } else if (!result.notConnected) {
      console.error("[cron/strava] failed for", userId, result.error)
      errors.push(`${userId}: ${result.error}`)
    }
  }

  return NextResponse.json({
    ok: true,
    users: tokens.length,
    synced: totalSynced,
    ...(errors.length ? { errors } : {}),
  })
}
