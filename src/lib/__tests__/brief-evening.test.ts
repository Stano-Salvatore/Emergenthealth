import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The evening brief reads four things the route did not use to send:
// tomorrow's events, a two-day outlook, today's targets and the newest
// sync. The fetch boundary is untyped, so this holds the two files to one
// vocabulary — the placeName lesson, applied before the drift rather than
// after it.

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

const ROUTE = strip("src/app/api/today/route.ts")
const VIEW = strip("src/components/dashboard/BriefView.tsx")

describe("the evening brief and /api/today agree", () => {
  it("the route returns every key the view reads", () => {
    const ret = /NextResponse\.json\(\{([^}]*)\}\)\s*$/m.exec(ROUTE.trim())
    expect(ret, "no final NextResponse.json({...}) found in the today route").not.toBeNull()
    const keys = ret![1].split(",").map(s => s.split(":")[0].trim()).filter(Boolean)
    for (const k of ["calendar", "tomorrow", "sleep", "weather", "daily", "outfit", "targets"]) {
      expect(keys, `/api/today no longer returns "${k}", which BriefView reads`).toContain(k)
    }
  })

  it("the view's targets match the route's Targets", () => {
    for (const field of ["steps", "hydrationMl", "habits", "lastSyncedAt"]) {
      expect(ROUTE, `route's Targets lost "${field}"`).toMatch(new RegExp(`${field}:`))
      expect(VIEW, `BriefView's Targets lost "${field}"`).toMatch(new RegExp(`${field}:`))
    }
  })

  it("says nothing about tomorrow's calendar when it holds nothing", () => {
    // No calendar linked and an empty day look identical here, so the honest
    // move is silence — "nothing on tomorrow" over an unlinked calendar
    // would be the scope-narrower-than-its-words bug.
    expect(VIEW).toMatch(/tomorrowEvents\.length > 0 &&/)
    expect(VIEW).not.toMatch(/Nothing (on|in) tomorrow/i)
  })
})
