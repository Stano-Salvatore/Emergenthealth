import { prisma } from "@/lib/prisma"
import { parseSyncStatus, type EndpointOutcome, type SyncRun, type SyncStatus } from "@/lib/sync-status"

// The database half of sync status. Server-only by construction: keeping it
// out of sync-status.ts is what stops the Prisma client being traced into the
// client bundle through the components that read them. See the note there.

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
        // Why each endpoint of a multi-endpoint source gave what it gave.
        // Overwritten whole on every run rather than merged: a stale outcome
        // from last week would answer "why is this blank" with last week's
        // reason, which is worse than not answering.
        ...(run.endpoints ? { endpoints: run.endpoints } : {}),
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

/**
 * Refresh why each endpoint gave what it gave, without touching when the
 * source last ran.
 *
 * Two fields on the same record, with opposite freshness needs. `at` answers
 * "is the scheduled job alive", so only the cron may write it — an app-open
 * sync stamping it would keep the screen minutes-fresh while the job was dead,
 * which is the one failure the sync screen exists to catch. `endpoints`
 * answers "why is this column empty", and there the cron's pace is the
 * problem: after granting a missing scope the user watches the figures arrive
 * while the line underneath still quotes the refusal that has just been fixed,
 * for as long as it takes the next scheduled run to land. Hours, on this
 * deployment.
 *
 * So the app-open sync refreshes the reasons and leaves the clock alone.
 *
 * A no-op when the source has no record yet, rather than inventing one: `at`
 * is not optional, and a run entry with a made-up timestamp would turn
 * "connected, never synced" into something that looks like a real run.
 * Nothing recorded stays nothing said, which is what the screen already does
 * with it.
 */
export async function recordEndpoints(
  userId: string,
  source: string,
  endpoints: Record<string, EndpointOutcome>,
): Promise<void> {
  try {
    const current = await readSyncStatus(userId)
    const run = current[source]
    if (!run) return
    const next: SyncStatus = { ...current, [source]: { ...run, endpoints } }
    const json = JSON.stringify(next)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, ${KEY}, ${json})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${json}
    `
  } catch { /* never let bookkeeping break the sync it describes */ }
}
