import { describe, it, expect } from "vitest"
import { agoLabel, isStale, parseSyncStatus } from "@/lib/sync-status"

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

describe("isStale", () => {
  const now = Date.parse("2026-08-22T12:00:00Z")

  it("allows a missed tick before crying wolf", () => {
    // GitHub delays scheduled workflows routinely; flagging the first late
    // tick would mean the screen is usually wrong.
    expect(isStale({ at: "2026-08-22T11:00:00Z", ok: true }, now)).toBe(false)
  })

  it("flags a source that has gone quiet for hours", () => {
    expect(isStale({ at: "2026-08-22T09:00:00Z", ok: true }, now)).toBe(true)
  })

  it("never calls a source that has never run stale", () => {
    // "Never synced" is a different message, and a more useful one.
    expect(isStale(undefined, now)).toBe(false)
    expect(isStale({ at: "garbage", ok: true }, now)).toBe(false)
  })
})
