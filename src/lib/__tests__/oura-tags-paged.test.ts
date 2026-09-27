import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Oura pages its collections with next_token. The tag fetch read the first
// page and stopped, which was harmless while the sync only ever added tags —
// and becomes data loss the moment a tag missing from the answer is taken to
// mean "deleted in the Oura app". So the fetch follows every page, and says
// whether it got them all, so the sync can refuse to prune from half an answer.
//
// The activity document carries non_wear_time, which is how the sync tells a
// day the ring sat on its charger from a day of genuinely zero steps.

vi.mock("@/lib/prisma", () => ({
  prisma: { ouraToken: { findUnique: async () => ({ accessToken: "tok", refreshToken: "r" }) } },
}))

import { getOuraTags, getDailyActivity } from "@/lib/oura"

const doc = (id: string) => ({ id, start_day: "2026-09-25", start_time: "2026-09-25T19:30:00+02:00", custom_name: `Tag ${id}` })

let pages: Record<string, { data: unknown[]; next_token?: string | null }>
let seen: URL[]

beforeEach(() => {
  seen = []
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input)
    seen.push(url)
    const body = pages[url.searchParams.get("next_token") ?? "first"]
    return new Response(JSON.stringify(body), { status: 200 })
  })
})
afterEach(() => { vi.unstubAllGlobals() })

describe("getOuraTags", () => {
  it("follows next_token to the last page", async () => {
    pages = {
      first: { data: [doc("a"), doc("b")], next_token: "p2" },
      p2: { data: [doc("c")], next_token: null },
    }
    const out = await getOuraTags("u1", "2026-09-01", "2026-09-26")
    expect(out.tags.map(t => t.id)).toEqual(["a", "b", "c"])
    expect(out.complete).toBe(true)
    // The window stays on every page, not only the first.
    expect(seen[1].searchParams.get("start_date")).toBe("2026-09-01")
  })

  it("says so when it stopped before the end", async () => {
    pages = { first: { data: [doc("a")], next_token: "first" } }
    const out = await getOuraTags("u1", "2026-09-01", "2026-09-26")
    expect(out.complete).toBe(false)
  })
})

describe("getDailyActivity", () => {
  it("carries the ring's non-wear time", async () => {
    pages = { first: { data: [{ day: "2026-09-24", steps: 0, non_wear_time: 86400 }] } }
    const [row] = await getDailyActivity("u1", "2026-09-24", "2026-09-24")
    expect(row.nonWearSeconds).toBe(86400)
  })
})
