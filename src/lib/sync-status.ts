
// What synced, when, and whether it worked.
//
// DELIBERATELY FREE OF PRISMA. `SyncStatusCard` is a client component and
// imports `agoLabel`/`isStale` from here, so anything this file pulls in gets
// traced into the browser bundle — importing the database client for two pure
// helpers shipped the whole Prisma runtime to every visitor. The reads and
// writes live in sync-status-store.ts, which only the server imports.
//
// Nothing recorded this before. A status screen could have inferred it from the
// newest row each source produced, but that answers a different question: a
// sync that ran and returned nothing looks identical to one that never ran at
// all, and a source that has been failing for a week looks merely quiet. The
// difference matters most exactly when something is broken.
//
// So each run writes its own outcome. Stored as a UserPreference rather than a
// new table: it is one small JSON blob per user, rewritten in place, and it
// rides along with the existing export and backup instead of needing to be
// remembered separately.

/**
 * Everything that syncs, in the order the status screen lists them.
 *
 * `driver` matters to what the screen may claim. Server sources run on a
 * schedule, so silence from one is meaningful and can be called overdue.
 * Device sources only run when the phone runs them, so a long gap means the
 * app has not been opened — not that anything is broken — and saying otherwise
 * would be inventing a fault.
 */
export const SYNC_SOURCES = [
  { id: "oura", label: "Oura Ring", what: "Sleep, readiness, HRV, activity", driver: "server" },
  { id: "strava", label: "Strava", what: "Workouts and routes", driver: "server" },
  { id: "ynab", label: "YNAB", what: "Budget and transactions", driver: "server" },
  { id: "truelayer", label: "TrueLayer", what: "Bank transactions", driver: "server" },
  { id: "health-connect", label: "Health Connect", what: "Steps and sleep from other apps", driver: "device" },
  { id: "device-calendar", label: "Phone calendar", what: "Events from the phone's calendars", driver: "device" },
] as const

export type SyncSourceId = (typeof SYNC_SOURCES)[number]["id"]

export type SyncRun = {
  at: string          // ISO instant the run finished
  ok: boolean
  items?: number      // rows written, when the source counts them
  error?: string      // short reason, shown to the user when ok is false
}

export type SyncStatus = Partial<Record<string, SyncRun>>

export function parseSyncStatus(raw: string | null | undefined): SyncStatus {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    // Arrays are objects too, and an array is not a status map — without this
    // one would flow through and every lookup on it would quietly be undefined.
    if (!v || typeof v !== "object" || Array.isArray(v)) return {}
    return v as SyncStatus
  } catch {
    return {}
  }
}

// The Actions schedules that drive these. GitHub delays scheduled workflows
// under load — sometimes by many minutes — so this describes the cadence and
// the screen shows the last real run beside it, rather than printing a
// confident next-run time the platform never promised.
export const SYNC_CADENCE_MINUTES = 30
export const REMINDER_CADENCE_MINUTES = 10

/** Human phrasing for how long ago something happened, or null if never. */
export function agoLabel(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const mins = Math.floor((now - then) / 60000)
  if (mins < 0) return "just now"
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? "yesterday" : `${days} days ago`
}

/**
 * Is a source overdue? Only meaningful for the ones on the 30-minute loop, and
 * only once we have seen it run at least once — "never run" is its own state
 * and says so, rather than being reported as late.
 */
export function isStale(run: SyncRun | undefined, now = Date.now()): boolean {
  if (!run?.at) return false
  const then = Date.parse(run.at)
  if (Number.isNaN(then)) return false
  // Three cadences of grace: one missed tick is normal on GitHub's scheduler.
  return now - then > SYNC_CADENCE_MINUTES * 3 * 60_000
}
