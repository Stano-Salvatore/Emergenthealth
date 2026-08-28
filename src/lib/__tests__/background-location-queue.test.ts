import { describe, it, expect } from "vitest"
import { parseStoredQueue } from "../native/background-location"

// The queue lives in module state, and module state dies with the page —
// Android suspends and eventually kills a backgrounded WebView whenever it
// likes. Everything collected since the last successful upload went with it,
// silently, and precisely while tracking was doing the thing it exists for.
// These pin what survives a round trip through disk.

describe("parseStoredQueue", () => {
  const point = {
    lat: 48.1486, lng: 17.1077,
    trackedAt: "2026-08-28T17:46:00.000Z",
    accuracyM: 12, altitudeM: 140, speedKmh: 4.2,
  }

  it("brings a stored backlog back intact", () => {
    expect(parseStoredQueue(JSON.stringify([point]))).toEqual([point])
  })

  it("treats nothing stored as nothing owed", () => {
    expect(parseStoredQueue(null)).toEqual([])
    expect(parseStoredQueue("")).toEqual([])
  })

  it("does not throw on whatever it finds", () => {
    // Written by some earlier version of the app, or half-written when the
    // process died. Refusing to start over an unreadable backlog would be
    // worse than losing it.
    expect(parseStoredQueue("not json at all")).toEqual([])
    expect(parseStoredQueue('{"not":"an array"}')).toEqual([])
    expect(parseStoredQueue("[null, 3, \"x\"]")).toEqual([])
  })

  it("drops one bad row rather than the backlog behind it", () => {
    const raw = JSON.stringify([point, { lat: "48", lng: 17 }, { ...point, trackedAt: "nope" }, point])
    expect(parseStoredQueue(raw)).toHaveLength(2)
  })

  it("keeps optional readings missing rather than inventing zeros", () => {
    // Number(null) is 0 and 0 metres is a perfect fix — the same trap the
    // ingest route had. Absent has to stay absent.
    const [p] = parseStoredQueue(JSON.stringify([{ lat: 1, lng: 2, trackedAt: point.trackedAt }]))
    expect(p.accuracyM).toBeNull()
    expect(p.altitudeM).toBeNull()
    expect(p.speedKmh).toBeNull()
  })

  it("keeps the NEWEST points when a stored queue is oversized", () => {
    // The server keeps the first MAX_BATCH of an oversized post and answers ok,
    // so trimming from the wrong end discards what it would have accepted.
    const many = Array.from({ length: 260 }, (_, i) => ({
      ...point, trackedAt: new Date(Date.parse(point.trackedAt) + i * 60_000).toISOString(),
    }))
    const kept = parseStoredQueue(JSON.stringify(many))
    expect(kept).toHaveLength(200)
    expect(kept.at(-1)!.trackedAt).toBe(many.at(-1)!.trackedAt)
  })
})
