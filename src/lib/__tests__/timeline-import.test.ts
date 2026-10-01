import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import {
  DETECTION_LOOKBACK_MIN, MIN_DWELL_MIN, backfillWindows, dedupeWindow, detectDwells,
  visitCheckInAt, visitsAtPlaces,
} from "../place-visits"
import { extractPoints } from "@/components/location/TimelineImport"

// What a Google Timeline import turns into, and what saving a place does to
// the history already stored.

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")
const source = (path: string) => stripComments(readFileSync(path, "utf8"))

const HOME = { id: "home", name: "Home", emoji: "🏠", lat: 48.175421976678, lng: 17.126068557003457, radiusM: 150 }
const PARENTS = { id: "parents", name: "Parents", emoji: "👪", lat: 48.3965142, lng: 17.3227352, radiusM: 150 }
const PLACES = [HOME, PARENTS]

/** A phone Timeline.json holding one visit and nothing else. */
const phoneExport = (place: { lat: number; lng: number }, start: string, end: string) => ({
  semanticSegments: [{
    startTime: start,
    endTime: end,
    visit: { topCandidate: { placeLocation: { latLng: `${place.lat}°, ${place.lng}°` } } },
  }],
})

describe("the import's reported date range", () => {
  // Takeout timestamps end in Z. Slicing one gives the UTC day, so a last
  // point at 00:40 in Bratislava on 1 January reported "→ 2024-12-31".
  it("does not slice the UTC day out of a timestamp", () => {
    expect(source("src/components/location/TimelineImport.tsx")).not.toMatch(/trackedAt\.slice\(0, ?10\)/)
  })

  it("formats both ends on the device's own calendar", () => {
    const src = source("src/components/location/TimelineImport.tsx")
    expect(src).toMatch(/from:\s*todayLocalISO\(new Date\(points\[0\]\.trackedAt\)\)/)
    expect(src).toMatch(/to:\s*todayLocalISO\(new Date\(points\[points\.length - 1\]\.trackedAt\)\)/)
  })
})

describe("Google's own visits become check-ins", () => {
  // The importer turns a visit into two points, arrival and departure. Two
  // fixes further apart than MAX_GAP_MIN are two separate zero-length runs to
  // the dwell detector, so a long stay produced nothing at all.
  it("is needed: an evening at home is invisible to the dwell detector", () => {
    const doc = phoneExport(HOME, "2025-03-04T18:00:00+01:00", "2025-03-04T23:30:00+01:00")
    const points = extractPoints(doc).map(p => ({ ...p, accuracyM: null, trackedAt: new Date(p.trackedAt) }))
    expect(points).toHaveLength(2)
    expect(detectDwells(points, PLACES)).toHaveLength(0)
  })

  it("keeps a long visit as one stay at the saved place it falls in", () => {
    const visits = visitsAtPlaces([
      { lat: HOME.lat, lng: HOME.lng, start: "2025-03-04T18:00:00+01:00", end: "2025-03-04T23:30:00+01:00" },
      { lat: PARENTS.lat + 0.0003, lng: PARENTS.lng, start: "2025-03-09T11:00:00+01:00", end: "2025-03-09T17:00:00+01:00" },
    ], PLACES)
    expect(visits.map(v => v.placeId)).toEqual(["home", "parents"])
    expect((visits[0].end.getTime() - visits[0].start.getTime()) / 60_000).toBe(330)
    expect(visits[1].start.toISOString()).toBe("2025-03-09T10:00:00.000Z")
  })

  it("skips visits outside every saved place, and ones too short to be a stay", () => {
    expect(visitsAtPlaces([
      { lat: 50, lng: 20, start: "2025-03-04T18:00:00Z", end: "2025-03-04T20:00:00Z" },
      { lat: HOME.lat, lng: HOME.lng, start: "2025-03-04T18:00:00Z", end: new Date(Date.parse("2025-03-04T18:00:00Z") + (MIN_DWELL_MIN - 1) * 60_000).toISOString() },
      { lat: HOME.lat, lng: HOME.lng, start: "not a time", end: "2025-03-04T20:00:00Z" },
      { lat: HOME.lat, lng: HOME.lng, start: "2025-03-04T20:00:00Z", end: "2025-03-04T18:00:00Z" },
    ], PLACES)).toEqual([])
  })

  it("covers a partial check-in the point batches already wrote for the same stay", () => {
    // The visits go up after the points, so any shorter view of the stay the
    // dwell detector found first sits inside the whole visit's window.
    const [visit] = visitsAtPlaces([
      { lat: HOME.lat, lng: HOME.lng, start: "2025-03-04T20:00:00Z", end: "2025-03-05T06:00:00Z" },
    ], PLACES)
    const partial = visitCheckInAt({ start: new Date("2025-03-05T04:00:00Z"), end: new Date("2025-03-05T05:00:00Z") })
    const w = dedupeWindow(visit)
    expect(partial >= w.gte && partial <= w.lte).toBe(true)
  })

  it("is what the importer sends and the route records", () => {
    expect(source("src/components/location/TimelineImport.tsx")).toMatch(/JSON\.stringify\(\{\s*visits:/)
    expect(source("src/app/api/import/timeline/route.ts")).toMatch(/recordTimelineVisits\(userId,/)
  })
})

describe("stays that cross a 500-point upload batch", () => {
  // The route used to detect over exactly [first, last] of the batch. A night
  // split by a batch boundary was then two stays: the first batch wrote a
  // check-in for 22:00–03:00, and the second saw 03:15–07:30, whose dedupe
  // window did not reach back to it. Walk the real batching with each window.
  function checkInsAcrossBatches(lookbackMin: number): number {
    const T = (hhmm: string, day = 4) => Date.parse(`2025-01-0${day}T${hhmm}:00Z`)
    const times: number[] = []
    for (let t = T("22:00"); t <= T("07:30", 5); t += 15 * 60_000) times.push(t)
    const all = times.map(t => ({ lat: HOME.lat, lng: HOME.lng, accuracyM: 20, trackedAt: new Date(t) }))

    const boundary = times.indexOf(T("03:00", 5)) + 1
    const batches = [all.slice(0, boundary), all.slice(boundary)]
    const written: Date[] = []
    for (const batch of batches) {
      const from = batch[0].trackedAt.getTime() - lookbackMin * 60_000
      const to = batch[batch.length - 1].trackedAt.getTime()
      const stored = all.filter(p => p.trackedAt.getTime() >= from && p.trackedAt.getTime() <= to)
      for (const v of detectDwells(stored, PLACES)) {
        const w = dedupeWindow(v)
        if (written.some(d => d >= w.gte && d <= w.lte)) continue
        written.push(visitCheckInAt(v))
      }
    }
    return written.length
  }

  it("records the night once with the shared look-back", () => {
    expect(checkInsAcrossBatches(DETECTION_LOOKBACK_MIN)).toBe(1)
  })

  it("would record it twice with a window of exactly the batch", () => {
    expect(checkInsAcrossBatches(0)).toBe(2)
  })

  it("is the look-back the import route uses", () => {
    expect(source("src/app/api/import/timeline/route.ts"))
      .toMatch(/new Date\(Math\.min\(\.\.\.times\) - DETECTION_LOOKBACK_MIN \* 60_000\)/)
  })
})

describe("saving a place back-fills its visits from stored history", () => {
  const DAY = 86_400_000
  const now = new Date("2026-09-30T12:00:00Z")
  const earliest = new Date(now.getTime() - 730 * DAY)

  it("covers everything from the first stored point to now", () => {
    const windows = backfillWindows(earliest, now)
    expect(Math.min(...windows.map(w => w.from.getTime()))).toBeLessThanOrEqual(earliest.getTime())
    expect(Math.max(...windows.map(w => w.to.getTime()))).toBeGreaterThanOrEqual(now.getTime())
  })

  it("starts with the most recent month, which matters most if time runs out", () => {
    const windows = backfillWindows(earliest, now)
    expect(windows[0].to.getTime()).toBeGreaterThanOrEqual(now.getTime())
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].from.getTime()).toBeLessThan(windows[i - 1].from.getTime())
    }
  })

  it("overlaps neighbours by a full look-back, so a stay across a seam is seen whole by both", () => {
    const windows = backfillWindows(earliest, now)
    for (let i = 1; i < windows.length; i++) {
      const newer = windows[i - 1], older = windows[i]
      expect(older.to.getTime() - newer.from.getTime()).toBeGreaterThanOrEqual(2 * DETECTION_LOOKBACK_MIN * 60_000)
    }
  })

  it("is nothing when there is no history", () => {
    expect(backfillWindows(now, now).length).toBeLessThanOrEqual(1)
  })

  it("runs after a place is created, and after its radius changes", () => {
    const src = source("src/app/api/saved-places/route.ts")
    expect(src).toMatch(/after\(\(\) => backfillPlaceVisits\(userId, place\.id\)/)
    const patch = src.slice(src.indexOf("export async function PATCH"))
    expect(patch.slice(0, patch.indexOf("export async function DELETE"))).toMatch(/backfillPlaceVisits\(/)
  })
})

describe("Settings imports Timeline through the importer that writes check-ins", () => {
  // It used to have its own importer, which wrote the visits into a
  // UserPreference blob that the correlations read only for an account with no
  // check-ins at all — so it reported "312 visits imported" and changed
  // nothing, and a second upload replaced the first.
  it("renders the Location page's importer", () => {
    const src = source("src/app/dashboard/settings/page.tsx")
    expect(src).toMatch(/<TimelineImport\b/)
    expect(src).not.toMatch(/<TimelineImporter\b/)
  })

  it("has nothing left writing the blob", () => {
    expect(existsSync("src/app/api/import/timeline-visits/route.ts")).toBe(false)
  })
})

describe("a place saved through Emergy", () => {
  it("back-fills its visits like one saved from the app", () => {
    const src = readFileSync("src/lib/claude.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
    const block = src.slice(src.indexOf('name === "save_place"'), src.indexOf('name === "create_experiment"'))
    expect(block).toMatch(/backfillPlaceVisits\(userId, place\.id\)/)
  })
})
