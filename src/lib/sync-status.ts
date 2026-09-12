
// What synced, when, and whether it worked.
//
// DELIBERATELY FREE OF PRISMA. `agoLabel`/`isStale` are reached from client
// components, so anything this file pulls in gets traced into the browser
// bundle — importing the database client for two pure helpers shipped the
// whole Prisma runtime to every visitor. The reads and writes live in
// sync-status-store.ts, which only the server imports.
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
  { id: "lastfm", label: "Last.fm", what: "Scrobbles and listening minutes", driver: "server" },
  { id: "rescuetime", label: "RescueTime", what: "Productive and distracting hours", driver: "server" },
  { id: "health-connect", label: "Health Connect", what: "Steps and sleep from other apps", driver: "device" },
  { id: "device-calendar", label: "Phone calendar", what: "Events from the phone's calendars", driver: "device" },
] as const

export type SyncSourceId = (typeof SYNC_SOURCES)[number]["id"]

/**
 * How one endpoint of a multi-endpoint source went.
 *
 * A blank column has four possible causes and only one of them is a bug: we
 * never asked, they refused, they had nothing, or we read the wrong key. The
 * sync already distinguishes them — it just said so to `console.warn`, which on
 * this deployment is readable for about an hour. Keeping the answer means the
 * screen showing the blank can say why it is blank.
 */
export type EndpointOutcome =
  | { state: "ok"; days: number }
  /** The request was rejected: scope, plan, or a genuine failure. */
  | { state: "failed"; reason: string }
  /** It answered, with no rows for the window. Not an error. */
  | { state: "empty" }

export type SyncRun = {
  at: string          // ISO instant the run finished
  ok: boolean
  items?: number      // rows written, when the source counts them
  error?: string      // short reason, shown to the user when ok is false
  /** Per-endpoint detail, for a source that pulls from several. */
  endpoints?: Record<string, EndpointOutcome>
}

/**
 * What to tell someone looking at the empty space where a figure would be.
 *
 * Never invents a fault: "had nothing to send" is the commonest answer here and
 * is not a problem to be fixed, so it does not read like one. The last case is
 * the one that matters to us rather than to the reader — rows arrived and this
 * figure still came out empty, which is what a misread key name looks like.
 *
 * Returns null when nothing was recorded, so a screen with no answer says
 * nothing rather than guessing at one.
 */
export function whyBlank(source: string, outcome: EndpointOutcome | undefined): string | null {
  if (!outcome) return null
  switch (outcome.state) {
    // A colon, not a dash: the screen puts a dash in front of this whole
    // phrase, and "No resilience — Oura refused the request — 403 Forbidden"
    // is two dashes doing two different jobs in one short line.
    case "failed": return `${source} refused the request: ${outcome.reason}`
    case "empty": return `${source} had nothing to send for this window`
    case "ok": return `${source} sent ${outcome.days} ${outcome.days === 1 ? "day" : "days"} of this, none of them this one`
  }
}

/** A figure the screen has room for, and the endpoint that would fill it. */
export type BlankFigure = {
  /** Sentence form, lower case — it is read mid-sentence, not as a heading. */
  label: string
  endpoint: string
}

/**
 * Group blank figures by the reason they are blank, so four empty boxes with
 * one cause between them say it once instead of four times.
 */
export function explainBlanks(
  source: string,
  blanks: BlankFigure[],
  run: SyncRun | undefined,
): { reason: string; labels: string[] }[] {
  const byReason = new Map<string, string[]>()
  for (const b of blanks) {
    const reason = whyBlank(source, run?.endpoints?.[b.endpoint])
    if (!reason) continue
    const labels = byReason.get(reason)
    if (labels) labels.push(b.label)
    else byReason.set(reason, [b.label])
  }
  return [...byReason].map(([reason, labels]) => ({ reason, labels }))
}

/**
 * "a", "a and b", "a, b and c" — for a list read aloud inside a sentence.
 *
 * The conjunction is a parameter because a negative list wants the other one:
 * "No vascular age and pulse wave velocity" says something subtly different
 * from "No vascular age or pulse wave velocity", and only the second is true.
 */
export function listPhrase(items: string[], conjunction = "and"): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`
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
