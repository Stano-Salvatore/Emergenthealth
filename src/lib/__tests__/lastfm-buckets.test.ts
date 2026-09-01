import { describe, it, expect, afterEach, vi } from "vitest"
import { bucketScrobbles, fetchRecentTracks, pickGenreTag } from "../lastfm"

const TZ = "Europe/Bratislava" // UTC+2 in August

/** A scrobble at a UTC instant, which is what Last.fm actually returns. */
function scrobble(utcISO: string, name = "Song", artist = "Artist") {
  return { name, artist: { "#text": artist }, date: { uts: String(Date.parse(utcISO) / 1000) } }
}

describe("bucketScrobbles", () => {
  it("files a scrobble under the listener's day, not UTC's", () => {
    // 22:30 UTC on the 4th is 00:30 on the 5th in Bratislava.
    const byDate = bucketScrobbles([scrobble("2026-08-04T22:30:00Z")], TZ)
    expect(Object.keys(byDate)).toEqual(["2026-08-05"])
  })

  it("counts the late-night ones separately", () => {
    const byDate = bucketScrobbles([
      scrobble("2026-08-05T10:00:00Z"), // 12:00 local — daytime
      scrobble("2026-08-05T20:30:00Z"), // 22:30 local — late
      scrobble("2026-08-05T21:30:00Z"), // 23:30 local — late
    ], TZ)
    expect(byDate["2026-08-05"].tracks).toBe(3)
    expect(byDate["2026-08-05"].late).toBe(2)
  })

  it("counts 02:00 as the small hours of the day it is, not the evening before", () => {
    // 00:30 UTC = 02:30 local on the 6th: late, and filed on the 6th.
    const byDate = bucketScrobbles([scrobble("2026-08-06T00:30:00Z")], TZ)
    expect(byDate["2026-08-06"].late).toBe(1)
  })

  it("skips a now-playing row, which carries no time", () => {
    const byDate = bucketScrobbles(
      [{ name: "Live", artist: { "#text": "A" } }, scrobble("2026-08-05T10:00:00Z")],
      TZ,
    )
    expect(byDate["2026-08-05"].tracks).toBe(1)
  })

  it("reports the most played artist and track, not the last one seen", () => {
    const byDate = bucketScrobbles([
      scrobble("2026-08-05T09:00:00Z", "Alpha", "Bandy"),
      scrobble("2026-08-05T10:00:00Z", "Alpha", "Bandy"),
      scrobble("2026-08-05T11:00:00Z", "Omega", "Zed"),
    ], TZ)
    const day = byDate["2026-08-05"]
    expect(day.artists).toEqual({ Bandy: 2, Zed: 1 })
    expect(day.titles).toEqual({ Alpha: 2, Omega: 1 })
  })

  it("falls back to UTC rather than throwing on a nonsense timezone", () => {
    const byDate = bucketScrobbles([scrobble("2026-08-04T22:30:00Z")], "Not/AZone")
    expect(Object.keys(byDate)).toEqual(["2026-08-04"])
  })
})

// ─── Paging ──────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** A Last.fm response holding `n` scrobbles and claiming `totalPages`. */
function page(n: number, totalPages: number) {
  return {
    ok: true,
    json: async () => ({
      recenttracks: {
        track: Array.from({ length: n }, (_, i) => scrobble("2026-08-05T10:00:00Z", `T${i}`)),
        "@attr": { totalPages: String(totalPages) },
      },
    }),
  }
}

describe("fetchRecentTracks", () => {
  it("follows every page the API says exists", async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url))
      return page(200, 3)
    }) as unknown as typeof fetch

    const out = await fetchRecentTracks("k", "u", 0)
    expect(out.pages).toBe(3)
    expect(out.tracks).toHaveLength(600)
    expect(seen.map(u => new URL(u).searchParams.get("page"))).toEqual(["1", "2", "3"])
    expect(out.truncated).toBe(false)
  })

  it("stops early when a page comes back empty", async () => {
    let call = 0
    globalThis.fetch = vi.fn(async () => (++call === 1 ? page(200, 5) : page(0, 5))) as unknown as typeof fetch
    const out = await fetchRecentTracks("k", "u", 0)
    expect(out.pages).toBe(2)
    expect(out.tracks).toHaveLength(200)
  })

  it("keeps what it has when a later page fails, and throws when the first does", async () => {
    let call = 0
    globalThis.fetch = vi.fn(async () =>
      ++call === 1 ? page(200, 4) : { ok: false, status: 500 }) as unknown as typeof fetch
    const out = await fetchRecentTracks("k", "u", 0)
    expect(out.tracks).toHaveLength(200)

    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403 })) as unknown as typeof fetch
    await expect(fetchRecentTracks("k", "u", 0)).rejects.toThrow("403")
  })

  it("handles the single-scrobble shape, which is an object not an array", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ recenttracks: { track: scrobble("2026-08-05T10:00:00Z"), "@attr": { totalPages: "1" } } }),
    })) as unknown as typeof fetch
    const out = await fetchRecentTracks("k", "u", 0)
    expect(out.tracks).toHaveLength(1)
  })

  it("says so when there is more history than the page cap allows", async () => {
    globalThis.fetch = vi.fn(async () => page(200, 999)) as unknown as typeof fetch
    const out = await fetchRecentTracks("k", "u", 0)
    expect(out.truncated).toBe(true)
    expect(out.pages).toBe(50)
  })
})

describe("pickGenreTag", () => {
  it("takes the first consensus tag that names a style", () => {
    expect(pickGenreTag([
      { name: "seen live", count: 100 },
      { name: "black metal", count: 87 },
      { name: "metal", count: 60 },
    ])).toBe("black metal")
  })

  it("skips one-person shelf labels below the consensus floor", () => {
    expect(pickGenreTag([
      { name: "songs my cat likes", count: 3 },
      { name: "ambient", count: 45 },
    ])).toBe("ambient")
  })

  it("normalises case", () => {
    expect(pickGenreTag([{ name: "Post-Punk", count: 90 }])).toBe("post-punk")
  })

  it("returns null when nothing usable is tagged", () => {
    expect(pickGenreTag([])).toBeNull()
    expect(pickGenreTag([{ name: "favorites", count: 100 }, { name: "x", count: 2 }])).toBeNull()
  })
})
