import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The ring covers every day of the 90; background location only some of them
// — the service was undeclared on every phone from 2 September, and Samsung
// kills it besides. So for "Home", the visit side was the tracked days and the
// "other days" side was mostly days nothing was tracked at all, and the place
// card and Emergy both reported "readiness +6 at Home" for what was really
// "recent weeks vs older ones". A day with no check-in of any kind is not a
// day spent elsewhere; the correlation engine already leaves those out
// (correlations.ts: `if (d.places == null) continue`), and these two did not.

const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

describe("place comparisons leave untracked days out of both sides", () => {
  it("the location page's correlation", () => {
    const src = code("src/app/api/location/correlation/route.ts")
    // Coverage comes from every check-in, not only the place's own auto ones.
    expect(src).toMatch(/SELECT "checkedAt" FROM "CheckIn"\s+WHERE "userId" = \$\{userId\} AND "checkedAt" >= \$\{since\}\s*`/)
    expect(src).toMatch(/nonVisitHealth = health\.filter\([^\n]*covered\.has/)
    expect(src).toMatch(/nonVisitMoods\s*= \[\.\.\.moods\]\.filter\([^\n]*covered\.has/)
    expect(src).toMatch(/nonVisitDates = [^\n]*covered\.has/)
  })

  it("Emergy's get_location_correlations", () => {
    const src = code("src/app/api/mcp/route.ts")
    const tool = src.slice(src.indexOf('"get_location_correlations"'), src.indexOf('"get_trips"'))
    expect(tool).toMatch(/nonVisitH = [^\n]*covered\.has/)
    expect(tool).toMatch(/nonVisitM = [^\n]*covered\.has/)
    expect(tool).toMatch(/no location data are excluded from both sides/i)
  })
})
