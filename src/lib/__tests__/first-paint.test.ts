import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The native app is the live site in a WebView, and a service worker in that
// shell is a scar, not an option (it pinned phones to dead builds — see
// ServiceWorkerRegistration). So opening the app costs one server render of
// the dashboard, and everything on that page's critical path is felt as
// startup time on the phone. Three things sat there that didn't need to:
//
//  - a LIVE Google Calendar round trip on every open (hundreds of ms of
//    someone else's latency),
//  - the vitals anomaly scan, blocking the whole page's HTML for one card,
//  - three sequential awaits after the parallel batch.
//
// This pins the fixes: the Google half is cached briefly (device/app events
// stay live — an event added in the app must not vanish for two minutes),
// the vitals card streams in behind Suspense, and nothing heavy runs
// sequentially after the batch.

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

describe("the dashboard's first paint", () => {
  const page = strip("src/app/dashboard/page.tsx")

  it("streams the vitals card instead of blocking the page on the scan", () => {
    expect(page).toMatch(/<Suspense[\s\S]{0,600}?<VitalsCard/)
  })
  it("uses the cached calendar read, not the live round trip", () => {
    expect(page).toMatch(/getUpcomingEventsWithStatusCached\(/)
    expect(page).not.toMatch(/getUpcomingEventsWithStatus\(/)
  })
  it("runs no heavy await after the parallel batch", () => {
    expect(page).not.toMatch(/await loadDailyScore/)
    expect(page).not.toMatch(/await latestWeighIn/)
    expect(page).not.toMatch(/await prisma\.reminder\.count/)
  })
})

describe("the calendar cache", () => {
  const cal = strip("src/lib/google-calendar.ts")

  it("exists, with a short TTL written as a named constant", () => {
    expect(cal).toMatch(/GCAL_CACHE_TTL_MS/)
    expect(cal).toMatch(/getUpcomingEventsWithStatusCached/)
  })
  it("caches only a fetch that succeeded — a failure is never served as fresh", () => {
    expect(cal).toMatch(/google === "ok"/)
  })
  it("merges device events live in the cached path too", () => {
    const open = cal.indexOf("export async function getUpcomingEventsWithStatusCached")
    expect(open).toBeGreaterThan(-1)
    const next = cal.indexOf("export async function", open + 1)
    const body = cal.slice(open, next === -1 ? undefined : next)
    expect(body).toMatch(/getDeviceEvents\(/)
  })
})
