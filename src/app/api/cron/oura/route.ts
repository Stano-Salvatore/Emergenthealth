import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { syncOuraForUser } from "@/lib/oura-sync"
import { recordSync } from "@/lib/sync-status-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

// Server-side Oura sync for every connected user — runs on a schedule so
// health data refreshes even when nobody opens the app.
export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const tokens = await prisma.ouraToken.findMany({ select: { userId: true } }).catch(() => [])

  let totalSynced = 0
  const errors: string[] = []

  for (const { userId } of tokens) {
    const result = await syncOuraForUser(userId)
    // Record every run, good or bad: the Settings sync screen has to be
    // able to tell "synced and there was nothing new" from "has been
    // failing since Tuesday", and only the run itself knows which.
    // A user who never connected this source is neither, so is skipped.
    if (result.ok) {
      await recordSync(userId, "oura", { ok: true, items: result.synced })
    } else if (!result.notConnected) {
      await recordSync(userId, "oura", { ok: false, error: result.error })
    }
    if (result.ok) {
      totalSynced += result.synced
    } else if (!result.notConnected) {
      console.error("[cron/oura] failed for", userId, result.error)
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
