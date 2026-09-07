import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { syncRescuetime } from "@/lib/rescuetime"
import { recordSync } from "@/lib/sync-status-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

// Server-side RescueTime sync for every connected user. Same gap Last.fm had:
// the only thing that fetched productive and distracting hours was opening the
// app, inside a Promise.allSettled that swallowed the failure. A screen-time
// correlation computed over a month where the last two weeks never synced is
// not a weaker answer, it is a wrong one.
export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const keys = await prisma.$queryRaw<{ userId: string; apiKey: string }[]>`
    SELECT "userId", "apiKey" FROM "RescuetimeKey"
  `.catch(() => [] as { userId: string; apiKey: string }[])

  let totalSynced = 0
  const errors: string[] = []

  for (const { userId, apiKey } of keys) {
    // syncRescuetime throws on a non-200 from the API; catch per user so one
    // bad key doesn't end the run for everyone behind it.
    try {
      const { synced } = await syncRescuetime(userId, apiKey)
      await recordSync(userId, "rescuetime", { ok: true, items: synced })
      totalSynced += synced
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : "sync failed"
      await recordSync(userId, "rescuetime", { ok: false, error })
      console.error("[cron/rescuetime] failed for", userId, error)
      errors.push(`${userId}: ${error}`)
    }
  }

  return NextResponse.json({
    ok: true,
    users: keys.length,
    synced: totalSynced,
    ...(errors.length ? { errors } : {}),
  })
}
