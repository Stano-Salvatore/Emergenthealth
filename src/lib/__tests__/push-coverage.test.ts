import { describe, it, expect } from "vitest"
import { localCoversNow, parseCoverage } from "@/lib/local-notifications"

// The bug: the native app schedules a morning check-in locally AND the server
// pushed one for the same hour, so a phone with the app installed got a second
// nudge through the browser. habit-reminders had gated on local coverage since
// it was written; morning, noon, evening and med never did.

describe("local coverage gate", () => {
  const synced = (at: string, days = 7) =>
    parseCoverage(JSON.stringify({ syncedAt: at, windowDays: days }))

  it("stands the server down while the phone's window is live", () => {
    expect(localCoversNow(synced("2026-08-20T09:00:00Z"), new Date("2026-08-22T09:00:00Z"))).toBe(true)
  })

  it("lets the push resume once the window runs dry", () => {
    // Stop opening the app and the local schedule lapses; the backstop has to
    // come back on its own, with no setting to remember.
    expect(localCoversNow(synced("2026-08-20T09:00:00Z"), new Date("2026-08-27T09:00:00Z"))).toBe(false)
  })

  it("treats a never-synced user as uncovered", () => {
    // Browser-only users have no phone at all — they must keep getting pushes.
    expect(localCoversNow(parseCoverage(null), new Date())).toBe(false)
    expect(localCoversNow(parseCoverage("not json"), new Date())).toBe(false)
    expect(localCoversNow(parseCoverage("{}"), new Date())).toBe(false)
  })

  it("errs toward a duplicate rather than a silent gap at the handover", () => {
    // The last day of the window was scheduled from the sync moment, so its
    // later hours may already be spent. One day of safety margin means the
    // seam produces a repeat, not a missed dose.
    expect(localCoversNow(synced("2026-08-20T09:00:00Z", 1), new Date("2026-08-20T10:00:00Z"))).toBe(false)
  })
})
