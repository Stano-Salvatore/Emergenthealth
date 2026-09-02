import { prisma } from "@/lib/prisma"
import { readSyncStatus } from "@/lib/sync-status-store"
import { SYNC_SOURCES, SYNC_CADENCE_MINUTES, type SyncRun } from "@/lib/sync-status"

export interface SyncSourceState {
  id: string
  label: string
  what: string
  driver: "server" | "device"
  connected: boolean
  run: SyncRun | null
}

export interface SyncOverview {
  sources: SyncSourceState[]
  cadenceMinutes: number
  newestHealthDate: string | null
}

// What synced, when, and whether it worked — plus whether each source is even
// connected, because "never synced" means something entirely different for a
// source you've hooked up than for one you haven't. Shared by the sync-status
// API and the Settings overview, so the two can never disagree.
export async function loadSyncOverview(userId: string): Promise<SyncOverview> {
  const [status, oura, strava, ynab, truelayer, calendarCount, newest, devicePrefs] = await Promise.all([
    readSyncStatus(userId),
    prisma.ouraToken.count({ where: { userId } }).catch(() => 0),
    prisma.stravaToken.count({ where: { userId } }).catch(() => 0),
    prisma.ynabToken.count({ where: { userId } }).catch(() => 0),
    // The same conditions the sync itself uses, or a half-finished connection
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
    // The phone-driven syncs stamp their own last-success time.
    prisma.userPreference.findMany({
      where: { userId, key: { in: ["health_connect_last_sync", "device_calendar_last_sync"] } },
      select: { key: true, value: true },
    }).catch(() => [] as { key: string; value: string }[]),
  ])

  // These keys are written only after a sync succeeds, so they can say when it
  // last worked but never that it failed.
  const deviceRun = (key: string): SyncRun | null => {
    const at = devicePrefs.find(p => p.key === key)?.value
    return at ? { at, ok: true } : null
  }

  const connected: Record<string, boolean> = {
    oura: oura > 0,
    strava: strava > 0,
    ynab: ynab > 0,
    truelayer: truelayer > 0,
    "health-connect": deviceRun("health_connect_last_sync") != null,
    "device-calendar": calendarCount > 0 || deviceRun("device_calendar_last_sync") != null,
  }

  const deviceRuns: Record<string, SyncRun | null> = {
    "health-connect": deviceRun("health_connect_last_sync"),
    "device-calendar": deviceRun("device_calendar_last_sync"),
  }

  return {
    sources: SYNC_SOURCES.map(s => ({
      ...s,
      connected: connected[s.id] ?? false,
      run: status[s.id] ?? deviceRuns[s.id] ?? null,
    })),
    cadenceMinutes: SYNC_CADENCE_MINUTES,
    newestHealthDate: newest?.date?.toISOString().slice(0, 10) ?? null,
  }
}
