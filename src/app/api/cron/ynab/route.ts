import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { syncYnabForUser } from "@/lib/ynab-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const tokens = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "YnabToken"
    WHERE "budgetId" IS NOT NULL AND "accessToken" IS NOT NULL
  `.catch(() => [] as { userId: string }[])

  let totalSynced = 0
  const errors: string[] = []

  for (const { userId } of tokens) {
    const result = await syncYnabForUser(userId)
    if (result.ok) {
      totalSynced += result.synced
    } else {
      console.error("[cron/ynab] failed for", userId, result.error)
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
