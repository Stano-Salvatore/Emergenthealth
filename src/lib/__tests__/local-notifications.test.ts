import { describe, it, expect } from "vitest"
import { localCoversNow, parseCoverage } from "@/lib/local-notifications"

const at = (iso: string) => new Date(iso)
const synced = (iso: string, windowDays = 7) => ({ syncedAt: iso, windowDays })

describe("localCoversNow", () => {
  it("stays quiet while the phone's window is live", () => {
    // Synced today with a 7-day window — tomorrow is well inside it
    expect(localCoversNow(synced("2026-08-14T09:00:00Z"), at("2026-08-15T09:00:00Z"))).toBe(true)
    expect(localCoversNow(synced("2026-08-14T09:00:00Z"), at("2026-08-18T09:00:00Z"))).toBe(true)
  })

  it("takes over again once the window lapses", () => {
    // 7-day window minus a day of safety = 6 days of trusted coverage
    expect(localCoversNow(synced("2026-08-14T09:00:00Z"), at("2026-08-20T08:59:00Z"))).toBe(true)
    expect(localCoversNow(synced("2026-08-14T09:00:00Z"), at("2026-08-20T09:01:00Z"))).toBe(false)
  })

  it("discounts the final day rather than trusting it to the hour", () => {
    // A 1-day window is entirely safety margin — nothing to trust
    expect(localCoversNow(synced("2026-08-14T09:00:00Z", 1), at("2026-08-14T10:00:00Z"))).toBe(false)
  })

  it("pushes when it has no idea — a missed dose beats a duplicate", () => {
    expect(localCoversNow({ syncedAt: null, windowDays: null })).toBe(false)
    expect(localCoversNow({ syncedAt: "2026-08-14T09:00:00Z", windowDays: null })).toBe(false)
    expect(localCoversNow({ syncedAt: "not a date", windowDays: 7 })).toBe(false)
  })

  it("never treats a past sync as covering the future indefinitely", () => {
    expect(localCoversNow(synced("2026-01-01T09:00:00Z"), at("2026-08-14T09:00:00Z"))).toBe(false)
  })
})

describe("parseCoverage", () => {
  it("reads what the endpoint stores", () => {
    expect(parseCoverage('{"syncedAt":"2026-08-14T09:00:00Z","windowDays":7}'))
      .toEqual({ syncedAt: "2026-08-14T09:00:00Z", windowDays: 7 })
  })

  it("shrugs off anything malformed", () => {
    for (const bad of [null, undefined, "", "{", "[]", '{"syncedAt":42}']) {
      expect(parseCoverage(bad).syncedAt).toBeNull()
    }
  })
})
