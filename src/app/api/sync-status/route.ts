import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { readSyncStatus, SYNC_SOURCES, SYNC_CADENCE_MINUTES } from "@/lib/sync-status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// What synced, when, and whether it worked — plus whether each source is even
// connected, because "never synced" means something entirely different for a
// source you've hooked up than for one you haven't.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const [status, oura, strava, ynab, truelayer, calendarCount, newest] = await Promise.all([
    readSyncStatus(userId),
    prisma.ouraToken.count({ where: { userId } }).catch(() => 0),
    prisma.stravaToken.count({ where: { userId } }).catch(() => 0),
    prisma.ynabToken.count({ where: { userId } }).catch(() => 0),
    // TruelayerToken lives outside the Prisma schema, so raw SQL — with the
    // same conditions the sync itself uses, or a half-finished connection
    // would show as connected and then never sync.
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::int AS n FROM "TruelayerToken"
      WHERE "userId" = ${userId} AND "accountId" IS NOT NULL AND "accessToken" IS NOT NULL
    `.then(r => Number(r[0]?.n ?? 0)).catch(() => 0),
    prisma.deviceCalendarEvent.count({ where: { userId } }).catch(() => 0),
    // The freshest health day we hold, as a second opinion: a sync can report
    // success and still be bringing back nothing.
    prisma.healthLog.findFirst({
      where: { userId }, orderBy: { date: "desc" }, select: { date: true },
    }).catch(() => null),
  ])

  const connected: Record<string, boolean> = {
    oura: oura > 0,
    strava: strava > 0,
    ynab: ynab > 0,
    truelayer: truelayer > 0,
    calendar: calendarCount > 0,
  }

  return NextResponse.json({
    sources: SYNC_SOURCES.map(s => ({
      ...s,
      connected: connected[s.id] ?? false,
      run: status[s.id] ?? null,
    })),
    cadenceMinutes: SYNC_CADENCE_MINUTES,
    newestHealthDate: newest?.date?.toISOString().slice(0, 10) ?? null,
  })
}
