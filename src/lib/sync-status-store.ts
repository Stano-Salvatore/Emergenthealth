import { prisma } from "@/lib/prisma"
import { parseSyncStatus, type SyncRun, type SyncStatus } from "@/lib/sync-status"

// The database half of sync status. Server-only by construction: keeping it
// out of sync-status.ts is what stops the Prisma client being traced into the
// client bundle through SyncStatusCard. See the note there.

const KEY = "sync_status"

export async function readSyncStatus(userId: string): Promise<SyncStatus> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" = ${KEY} LIMIT 1
  `.catch(() => [] as { value: string }[])
  return parseSyncStatus(rows[0]?.value)
}

/**
 * Record how one source's sync went.
 *
 * Deliberately never throws: a status line is worth less than the sync itself,
 * so a failure to write the note must not fail the run it is describing.
 */
export async function recordSync(
  userId: string,
  source: string,
  run: Omit<SyncRun, "at"> & { at?: string },
): Promise<void> {
  try {
    const current = await readSyncStatus(userId)
    const next: SyncStatus = {
      ...current,
      [source]: {
        at: run.at ?? new Date().toISOString(),
        ok: run.ok,
        ...(run.items != null ? { items: run.items } : {}),
        // Truncated: this is a hint for the user, not a stack trace.
        ...(run.error ? { error: String(run.error).slice(0, 200) } : {}),
      },
    }
    const json = JSON.stringify(next)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, ${KEY}, ${json})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${json}
    `
  } catch { /* never let bookkeeping break the sync it describes */ }
}
