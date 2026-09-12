import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { agoLabel, isOverdue, parseSyncStatus, SYNC_OVERDUE_HOURS } from "@/lib/sync-status"

describe("parseSyncStatus", () => {
  it("treats anything unreadable as nothing recorded", () => {
    // A corrupt blob must not take the whole settings page down with it.
    for (const bad of [null, undefined, "", "not json", "[]", "12"]) {
      expect(parseSyncStatus(bad as string)).toEqual({})
    }
  })

  it("reads what was stored", () => {
    const raw = JSON.stringify({ oura: { at: "2026-08-22T10:00:00Z", ok: true, items: 3 } })
    expect(parseSyncStatus(raw).oura).toEqual({ at: "2026-08-22T10:00:00Z", ok: true, items: 3 })
  })
})

describe("agoLabel", () => {
  const now = Date.parse("2026-08-22T12:00:00Z")

  it("says nothing when a source has never run", () => {
    // Never-run is its own state; it must not read as "0 min ago".
    expect(agoLabel(undefined, now)).toBeNull()
    expect(agoLabel("nonsense", now)).toBeNull()
  })

  it("scales from minutes to days", () => {
    expect(agoLabel("2026-08-22T11:59:30Z", now)).toBe("just now")
    expect(agoLabel("2026-08-22T11:30:00Z", now)).toBe("30 min ago")
    expect(agoLabel("2026-08-22T09:00:00Z", now)).toBe("3h ago")
    expect(agoLabel("2026-08-21T09:00:00Z", now)).toBe("yesterday")
    expect(agoLabel("2026-08-18T12:00:00Z", now)).toBe("4 days ago")
  })

  it("doesn't render a clock skew as a negative age", () => {
    expect(agoLabel("2026-08-22T12:05:00Z", now)).toBe("just now")
  })
})

describe("isOverdue", () => {
  const now = Date.parse("2026-08-22T12:00:00Z")
  const run = (at: string) => ({ at, ok: true })

  it("lets a scheduled source be hours late without complaint", () => {
    // GitHub runs these when it has capacity. The live history has them
    // landing two to five hours apart against a 30-minute schedule, so a
    // threshold built from the schedule would be amber most of the day —
    // which is how a status screen teaches someone to stop reading it.
    expect(isOverdue(run("2026-08-22T07:00:00Z"), "server", now)).toBe(false)
    expect(isOverdue(run("2026-08-21T20:00:00Z"), "server", now)).toBe(false)
  })

  it("flags one that has missed a whole day of them", () => {
    expect(isOverdue(run("2026-08-21T09:00:00Z"), "server", now)).toBe(true)
  })

  it("never calls a phone source late", () => {
    // It runs when the app is opened. A week of silence means a week of not
    // opening the app, and calling that a fault invents one.
    expect(isOverdue(run("2026-08-01T09:00:00Z"), "device", now)).toBe(false)
  })

  it("never calls a source that has never run late", () => {
    // "Never synced" is a different message, and a more useful one.
    expect(isOverdue(undefined, "server", now)).toBe(false)
    expect(isOverdue({ at: "garbage", ok: true }, "server", now)).toBe(false)
  })

  it("is the rule the settings screen actually applies", () => {
    // The bug this replaces: `isStale` was exported, tested and imported by
    // nothing, while the screen carried its own copy of the rule with a
    // different number in it. The test stayed green for months against code
    // no user could reach. A second inline threshold would do it again.
    const screen = readFileSync("src/lib/status-overview.ts", "utf8")
    expect(screen, "the screen must call the shared rule, not re-derive one")
      .toContain("isOverdue(s.run, s.driver)")
    expect(screen).not.toMatch(/ageH > 26/)
  })
})

describe("the copy on that screen matches the rule behind it", () => {
  const card = readFileSync("src/components/settings/StatusOverview.tsx", "utf8")
  const code = card.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")

  it("no longer promises a cadence that has never held", () => {
    // "Server syncs run every 30 minutes" beside "synced 4h ago" hands the
    // reader a fault that isn't there. The schedule is a request; say so.
    expect(code).not.toMatch(/syncs run every/)
    expect(code).toMatch(/queued every/)
  })

  it("states the gap at which a dot actually turns amber", () => {
    expect(code).toContain("{overdueHours}")
    expect(SYNC_OVERDUE_HOURS).toBe(26)
  })
})
