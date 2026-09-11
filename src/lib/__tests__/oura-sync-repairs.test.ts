import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { plausibleSpo2 } from "@/lib/vitals"

// Two things the sync could not say, and one it could not fix.
//
// Three endpoints were added from documentation, three columns stayed empty,
// and the logs had no opinion about why — because `Promise.allSettled` turns a
// rejected request into an empty object and says nothing, and an endpoint that
// returns zero rows looks identical to one that was never granted a scope.
// warnIfEmpty covers the document that ARRIVES and maps to nothing; this is
// the other half.
//
// And 21 nights in this database hold an SpO2 of exactly 0 — written before
// the plausibility guard existed, still drawn on the Health chart as a plunge
// to zero. The guard stopped new ones and could never repair those: omitting
// a field leaves whatever is already stored untouched.

const sync = readFileSync("src/lib/oura-sync.ts", "utf8")

describe("the sync says why a column is empty", () => {
  it("names the endpoint when its request fails", () => {
    expect(sync).toMatch(/result\.status === "rejected"/)
    expect(sync).toContain("request failed")
  })

  it("says so when an endpoint returns no days at all", () => {
    // The case that actually happened: no error, no rows, no explanation —
    // and an afternoon spent wondering whether a key name was wrong.
    expect(sync).toContain("returned no days for this window")
  })

  it("passes every endpoint its own name", () => {
    for (const endpoint of [
      "daily_sleep", "daily_activity", "daily_readiness", "daily_spo2",
      "daily_stress", "daily_cardiovascular_age", "vO2_max", "daily_resilience",
    ]) {
      expect(sync, `${endpoint} would log under the wrong name`).toContain(`byDate("${endpoint}"`)
    }
  })
})

describe("an impossible SpO2 is repaired, not merely refused", () => {
  it("knows 0% is not a measurement", () => {
    expect(plausibleSpo2(0)).toBeNull()
    expect(plausibleSpo2(97.2)).toBe(97.2)
  })

  it("writes an explicit null over a stored impossible value", () => {
    // Omitting the field leaves the bad row exactly as it was, forever.
    expect(sync).toContain("spo2Correction")
    expect(sync).toMatch(/\{ spo2: null \}/)
  })

  it("leaves a stored value alone on a day Oura sent nothing", () => {
    // The window is 30 days. Clearing on absence would erase every reading
    // older than the sync can see, every time it runs.
    expect(sync).toMatch(/if \(value == null\) return \{\}/)
  })
})
