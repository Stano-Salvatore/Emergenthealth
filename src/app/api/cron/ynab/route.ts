import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { syncYnabForUser } from "@/lib/ynab-sync"
import { recordSync } from "@/lib/sync-status-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const tokens = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "YnabToken"
    WHERE "budgetId" IS NOT NULL AND "accessToken" IS NOT NULL
  `.catch(() => [] as { userId: string }[])

  let totalSynced = 0
  const errors: string[] = []

  for (const { userId } of tokens) {
    const result = await syncYnabForUser(userId)
    // Record every run, good or bad: the Settings sync screen has to be able
    // to tell "synced and there was nothing new" from "has been failing since
    // Tuesday", and only the run itself knows which.
    // Only users holding a token are iterated, so a failure here is a real
    // failure rather than an unconnected account.
    if (result.ok) {
      totalSynced += result.synced
      await recordSync(userId, "ynab", { ok: true, items: result.synced })
    } else {
      console.error("[cron/ynab] failed for", userId, result.error)
      errors.push(`${userId}: ${result.error}`)
      await recordSync(userId, "ynab", { ok: false, error: result.error })
    }
  }

  return NextResponse.json({
    ok: true,
    users: tokens.length,
    synced: totalSynced,
    ...(errors.length ? { errors } : {}),
  })
}
