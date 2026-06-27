import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { syncOuraForUser } from "@/lib/oura-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

// Server-side Oura sync for every connected user — runs on a schedule so
// health data refreshes even when nobody opens the app.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const tokens = await prisma.ouraToken.findMany({ select: { userId: true } }).catch(() => [])

  let totalSynced = 0
  const errors: string[] = []

  for (const { userId } of tokens) {
    const result = await syncOuraForUser(userId)
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
