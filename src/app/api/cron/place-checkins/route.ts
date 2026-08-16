import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { recordPlaceVisits } from "@/lib/place-visits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// Records visits to saved places from stored GPS points, so being somewhere is
// enough to log it — no app open, no tap.
//
// Runs on the Actions tick with the reminder jobs rather than vercel.json:
// Hobby allows one cron a day, and a daily pass would notice yesterday's
// coffee. The look-back is much longer than the tick so a missed run costs
// nothing, and re-detection can't duplicate — recordPlaceVisits skips a visit
// that already has a check-in near it.

const LOOKBACK_HOURS = 12

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000)

  // Only users with points in the window — everyone else costs a query for
  // nothing on every tick.
  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT DISTINCT "userId" FROM "LocationPoint" WHERE "trackedAt" >= ${since}
  `.catch(() => [] as { userId: string }[])

  let created = 0
  let detected = 0
  for (const { userId } of rows) {
    const res = await recordPlaceVisits(userId, since, new Date()).catch(() => ({ created: 0, detected: 0 }))
    created += res.created
    detected += res.detected
  }

  return NextResponse.json({ ok: true, users: rows.length, detected, created })
}
