import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { TRACKED_METRICS } from "@/lib/anomalies"
import { DRIFT_METRICS } from "@/lib/drift"

// A tracked metric is named in four places by hand: the spec list, the Prisma
// select, the empty series map, and the push call. Miss one and the metric is
// silently never detected — no error, no empty chart, just a signal that never
// fires for anyone.
//
// Sleep latency and efficiency sat in the database for months for a related
// reason: stored faithfully by the sync, read by nothing. This is the guard
// that stops the next one, and it is deliberately a source grep rather than a
// behaviour test, because the failure mode is an omission, not a wrong answer.

const scan = readFileSync("src/lib/anomaly-scan.ts", "utf8")
const driftLoad = readFileSync("src/lib/drift-load.ts", "utf8")

/** Metrics that do not come off a HealthLog column, so the loader selects them elsewhere. */
const NOT_FROM_HEALTH_LOG = new Set(["mood", "energy"])

describe("every tracked metric is actually loaded", () => {
  it.each(TRACKED_METRICS.map(m => m.key))("the anomaly scan loads %s", key => {
    expect(scan, `${key} is in TRACKED_METRICS but never selected`).toContain(`${key}: true`)
    expect(scan, `${key} has no series to push into`).toContain(`${key}: []`)
    expect(scan, `${key} is selected but never pushed`).toContain(`push("${key}"`)
  })

  it.each(DRIFT_METRICS.map(m => m.key).filter(k => !NOT_FROM_HEALTH_LOG.has(k)))(
    "the drift comparison loads %s",
    key => {
      expect(driftLoad, `${key} is in DRIFT_METRICS but never selected`).toContain(`${key}: true`)
      expect(driftLoad, `${key} is selected but never pushed`).toContain(`series.${key}.push`)
    }
  )
})
