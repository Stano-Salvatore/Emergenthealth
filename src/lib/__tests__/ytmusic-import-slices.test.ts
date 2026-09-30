import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"

// A multi-year Takeout went up as one JSON body: past roughly 50k plays that
// is over Vercel's 4.5 MB request limit and fails before the route runs. And
// the genre pass took a fresh 25 s after however long the day rows had
// taken, inside a 60 s function — killed after every day was written, so the
// client showed a failure and a retry reported "0 days".

const realNow = Date.now()
const clock = { now: realNow, perQuery: 0 }
const syncArtistGenres = vi.fn(async (..._args: unknown[]) => ({ looked: 0, tagged: 0, remaining: 0 }))

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/user-timezone", () => ({ getUserTimezone: async () => "Europe/Bratislava" }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: async () => {
      clock.now += clock.perQuery
      return [{ inserted: true }]
    },
  },
}))
vi.mock("@/lib/lastfm", async orig => ({
  ...(await orig<typeof import("@/lib/lastfm")>()),
  getLastfmKey: async () => ({ apiKey: "k" }),
  syncArtistGenres: (...args: unknown[]) => syncArtistGenres(...args),
}))

import { slicePlaysByDay, type YtMusicPlay } from "@/lib/ytmusic-import"
import { POST } from "@/app/api/import/ytmusic/route"

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

const dayIn = (tz: string, uts: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(uts * 1000))

/** `perDay` plays a day for `n` days from 2022-01-01, every 20 minutes from 16:00 UTC — over Bratislava midnight. */
function history(n: number, perDay: number): YtMusicPlay[] {
  const out: YtMusicPlay[] = []
  const start = Date.UTC(2022, 0, 1, 16) / 1000
  for (let d = 0; d < n; d++) {
    for (let i = 0; i < perDay; i++) {
      out.push({ name: `Track ${d}-${i} ${"x".repeat(60)}`, artist: `Artist ${i % 40}`, uts: start + d * 86_400 + i * 1200 })
    }
  }
  return out
}

describe("slicePlaysByDay", () => {
  it("keeps every upload well under the platform's 4.5 MB body limit", () => {
    const plays = history(1500, 60) // 90k plays, ~10 MB as one body
    const slices = slicePlaysByDay(plays, "Europe/Bratislava")
    expect(slices.length).toBeGreaterThan(1)
    for (const s of slices) expect(Buffer.byteLength(JSON.stringify({ plays: s }))).toBeLessThan(4_500_000)
    expect(slices.flat()).toHaveLength(plays.length)
  })

  it("never splits one of the user's days across two uploads", () => {
    // The route never overwrites an existing day, so a day cut in two would
    // keep only the first half's count.
    const slices = slicePlaysByDay(history(400, 30), "Europe/Bratislava", 1000)
    const owner = new Map<string, number>()
    slices.forEach((s, i) => {
      for (const p of s) {
        const day = dayIn("Europe/Bratislava", p.uts)
        expect(owner.get(day) ?? i, `${day} is in two uploads`).toBe(i)
        owner.set(day, i)
      }
    })
    expect(slices.length).toBeGreaterThan(1)
  })
})

describe("the import route's genre pass fits in what is left of the function", () => {
  const post = (plays: YtMusicPlay[]) =>
    POST(new NextRequest("http://x/api/import/ytmusic", { method: "POST", body: JSON.stringify({ plays }) }))

  beforeEach(() => {
    syncArtistGenres.mockClear()
    clock.now = realNow
    vi.spyOn(Date, "now").mockImplementation(() => clock.now)
  })

  it("gets only the time the day rows left, not a fresh 25 s", async () => {
    clock.perQuery = 15_000
    const res = await post(history(2, 3)) // two days, 30 s of writes
    expect(res.status).toBe(200)
    expect(syncArtistGenres).toHaveBeenCalledTimes(1)
    const opts = syncArtistGenres.mock.calls[0][2] as { budgetMs?: number } | undefined
    expect(opts?.budgetMs).toBeDefined()
    expect(opts!.budgetMs!).toBeLessThanOrEqual(25_000)
  })

  it("is skipped when the day rows used the time up", async () => {
    clock.perQuery = 30_000
    const res = await post(history(2, 3))
    expect(res.status).toBe(200)
    expect(syncArtistGenres).not.toHaveBeenCalled()
  })
})

describe("the importer uploads in slices", () => {
  it("posts one slice at a time rather than every play in one body", () => {
    const src = strip("src/components/lastfm/YtMusicImport.tsx")
    expect(src).toMatch(/slicePlaysByDay\(/)
    expect(src).not.toMatch(/JSON\.stringify\(\{\s*plays\s*\}\)/)
  })
})
