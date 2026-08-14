// Does the phone already have this covered?
//
// Habits are scheduled twice over: the native app lays down local
// notifications at the exact reminder time, and the server cron pushes for the
// same incomplete habit within ten minutes. Different ids, so both land — the
// phone buzzes twice for one habit.
//
// Deleting the server push isn't right either. The local schedule is a rolling
// window refreshed when the app is opened, so a week without opening it and the
// local reminders run dry. The push is a genuinely useful backstop; it just
// shouldn't fire while the local ones are live.
//
// So the server asks whether the phone's window still covers now, and only
// pushes when it doesn't. No setting to get wrong, and it heals itself: stop
// opening the app and the push resumes on its own.

export interface LocalCoverage {
  syncedAt: string | null
  windowDays: number | null
}

/**
 * The last day of a window is only partly useful — it was scheduled from the
 * sync moment, so its later hours may already have passed. Treating coverage
 * as one day shorter than claimed means the handover errs towards a duplicate
 * rather than a silent gap, which is the right way round for medication.
 */
const SAFETY_DAYS = 1

export function parseCoverage(raw: string | null | undefined): LocalCoverage {
  if (!raw) return { syncedAt: null, windowDays: null }
  try {
    const v = JSON.parse(raw)
    const syncedAt = typeof v?.syncedAt === "string" ? v.syncedAt : null
    const windowDays = Number.isFinite(Number(v?.windowDays)) ? Number(v.windowDays) : null
    return { syncedAt, windowDays }
  } catch {
    return { syncedAt: null, windowDays: null }
  }
}

/**
 * True when the device's locally scheduled notifications still cover `now`,
 * meaning the server should stay quiet. Unknown or unparseable state is false:
 * a duplicate notification is a nuisance, a missed one is a missed dose.
 */
export function localCoversNow(coverage: LocalCoverage, now: Date = new Date()): boolean {
  if (!coverage.syncedAt || !coverage.windowDays) return false
  const synced = new Date(coverage.syncedAt).getTime()
  if (!Number.isFinite(synced)) return false

  const effectiveDays = coverage.windowDays - SAFETY_DAYS
  if (effectiveDays <= 0) return false

  const expiresAt = synced + effectiveDays * 86400000
  return now.getTime() < expiresAt
}
