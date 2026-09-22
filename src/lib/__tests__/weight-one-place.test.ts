import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

// Weight lives in two tables, exactly as mood does: the quick "log weight"
// box writes healthLog.weight, the Body page's form writes
// BodyMeasurement.weightKg, and lib/weight-series is the one merge. The
// mood guard walked the tree and found seven lone readers; this walks it for
// weight and found six — "what does the scale say?" answering "No weight
// recorded yet", the substance curve and the quick-log box using a stale or
// missing figure, two achievement counters that never saw a Body-page
// weigh-in, and a Health card labelled "Latest weight" showing a 7-day mean
// of one column.
//
// The idiom that means "weigh-ins" is `weight: { not: null }` on a HealthLog
// query. Any file that uses it must also go through lib/weight-series.

const src = (f: string) => readFileSync(f, "utf8")
const code = (f: string) =>
  src(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(join(dir, e.name))
    return /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []
  })

/** The merge itself, and the one route that only WRITES the column (its GET already merges). */
const OWN = ["src/lib/weight-series.ts"]

describe("every reader of weigh-ins sees both tables", () => {
  it("nobody counts or picks a weigh-in from HealthLog alone", () => {
    const idiom = /weight: \{ not: null \}/
    const readers = walk("src").filter(f => idiom.test(code(f)))
    expect(readers.length, "no weigh-in reader found at all — the idiom must have changed").toBeGreaterThan(0)
    for (const f of readers) {
      if (OWN.some(o => f.endsWith(o))) continue
      expect(code(f), `${f} picks weigh-ins from HealthLog alone — every Body-page weigh-in is invisible to it`)
        .toMatch(/from "@\/lib\/weight-series"/)
    }
  })

  it("the Health card labelled Latest weight shows the latest reading", () => {
    const page = code("src/app/dashboard/health/page.tsx")
    const at = page.indexOf('label="Latest weight"')
    expect(at).toBeGreaterThan(-1)
    const value = page.slice(at, at + 200)
    expect(value, "the \"Latest weight\" card is back to showing a 7-day mean under that label").toMatch(/latestWeight != null/)
  })
})
