// Pure helpers for the Settings "at a glance" card: turning "when did this
// last happen" into a colour and a phrase, with no database in sight so the
// rules can be tested.

export type StatusTone = "ok" | "warn" | "bad" | "off"

export interface StatusRow {
  id: string
  group: "Data" | "Notifications" | "Emergy" | "Server"
  label: string
  tone: StatusTone
  value: string
  /** One short line under the value, only when it adds something. */
  detail?: string
}

/** The latest YYYY-MM-DD anywhere in a stored value, whatever its shape. */
export function latestDayIn(raw: string | null | undefined): string | null {
  if (!raw) return null
  const days = raw.match(/\d{4}-\d{2}-\d{2}/g)
  if (!days || days.length === 0) return null
  return days.reduce((a, b) => (a > b ? a : b))
}

/** Whole days between a YYYY-MM-DD and today's local date (negative never). */
export function daysBetween(day: string, today: string): number {
  const a = Date.parse(day + "T12:00:00Z")
  const b = Date.parse(today + "T12:00:00Z")
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.round((b - a) / 86400000))
}

/** "today", "yesterday", "3 days ago", or "never". */
export function dayLabel(day: string | null, today: string): string {
  if (!day) return "never"
  const d = daysBetween(day, today)
  if (d === 0) return "today"
  if (d === 1) return "yesterday"
  if (d < 14) return `${d} days ago`
  return `on ${day}`
}

/** "2 h ago", "35 min ago", "3 days ago", or "never" for an instant. */
export function agoShort(iso: string | Date | null | undefined, now = Date.now()): string {
  if (!iso) return "never"
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime()
  if (Number.isNaN(t)) return "never"
  const min = Math.max(0, Math.round((now - t) / 60000))
  if (min < 2) return "just now"
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 36) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} days ago`
}

/** A source that should refresh regularly: green until warnAfterDays, amber after. */
export function freshnessTone(day: string | null, today: string, warnAfterDays: number): StatusTone {
  if (!day) return "off"
  return daysBetween(day, today) > warnAfterDays ? "warn" : "ok"
}
