import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { parseInsightsCache, insightsCacheState, shareInFlight } from "@/lib/insights-cache"

// Two readers of insights_cache:overall in the SAME file disagreed about its
// shape: the chat context read `payload.insights` (correct — the envelope the
// page and the watch cron write) while the get_analysis patterns tool read
// `parsed.insights`, found undefined, and told the user "the cached pattern
// run is empty" while ten patterns sat in the cache. One parser now, and
// nothing else may hand-roll it.

describe("parseInsightsCache", () => {
  it("reads the envelope shape the writers produce", () => {
    const raw = JSON.stringify({ at: 123, v: 9, payload: { insights: [{ id: "a", tier: "strong" }] } })
    const out = parseInsightsCache(raw)
    expect(out.insights).toHaveLength(1)
    expect(out.at).toBe(123)
  })
  it("still reads a legacy bare shape rather than calling it empty", () => {
    expect(parseInsightsCache(JSON.stringify({ insights: [{ id: "a" }] })).insights).toHaveLength(1)
    expect(parseInsightsCache(JSON.stringify([{ id: "a" }])).insights).toHaveLength(1)
  })
  it("garbage parses to empty, never throws", () => {
    expect(parseInsightsCache("not json").insights).toEqual([])
    expect(parseInsightsCache(null).insights).toEqual([])
  })
})

describe("one parser, everywhere the cache is read", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("claude.ts parses the cache only through the library", () => {
    const chat = stripped("src/lib/claude.ts")
    expect(chat).toMatch(/parseInsightsCache\(/)
    expect(
      /payload\??\.insights/.test(chat),
      "claude.ts still hand-parses the insights cache somewhere — that is how the two readers came to disagree.",
    ).toBe(false)
  })

  it("the health report parses it through the library too", () => {
    const rep = stripped("src/lib/health-report.ts")
    expect(rep).toMatch(/parseInsightsCache\(/)
    expect(/payload\??\.insights/.test(rep)).toBe(false)
  })
})

describe("what changed is stored, and Emergy can read it", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("the watch cron persists the change list it computed", () => {
    // The cron computed exactly which patterns moved, sent one sentence, and
    // discarded the list — so nothing in the app could answer "what else
    // changed", including the page the sentence pointed at.
    const cron = stripped("src/app/api/cron/correlation-watch/route.ts")
    expect(cron).toContain("insights_watch:last_changes")
  })

  it("the patterns tool leads with the recent changes", () => {
    const chat = stripped("src/lib/claude.ts")
    expect(chat).toContain("insights_watch:last_changes")
  })
})

// The watch cron writes the overall run once a day, in the late afternoon UTC,
// and the route treated anything older than six hours as expired. So by the
// next morning it always was: the first open of the day found every period
// stale, started full engine runs side by side (the Insights page and its
// Watched panel each asking for "overall"), and the cards spun for seconds.
// Last evening's run is still the right thing to show while a new one is
// computed behind it.
describe("how old a cached run can be and still be shown", () => {
  const HOUR = 60 * 60 * 1000
  const now = Date.UTC(2026, 8, 27, 5, 30) // 07:30 in Prague
  const cronRun = { at: Date.UTC(2026, 8, 26, 16, 0), v: 21 }

  it("serves the cron's run the next morning, and recomputes behind it", () => {
    expect(insightsCacheState(cronRun, now, 21)).toBe("stale")
  })
  it("serves a recent run as it is", () => {
    expect(insightsCacheState({ at: now - 2 * HOUR, v: 21 }, now, 21)).toBe("fresh")
  })
  it("never serves a run from another engine version", () => {
    expect(insightsCacheState({ at: now - HOUR, v: 21 }, now, 22)).toBe("unusable")
  })
  it("never serves a run days old, or one it cannot date", () => {
    expect(insightsCacheState({ at: now - 72 * HOUR, v: 21 }, now, 21)).toBe("unusable")
    expect(insightsCacheState(null, now, 21)).toBe("unusable")
    expect(insightsCacheState({ v: 21 }, now, 21)).toBe("unusable")
  })
})

describe("one engine run per user and period at a time", () => {
  it("shares a run already in flight instead of starting another", async () => {
    let calls = 0
    let release: () => void = () => {}
    const run = () => {
      calls++
      return new Promise<number>(r => { release = () => r(calls) })
    }
    const a = shareInFlight("u1:overall", run)
    const b = shareInFlight("u1:overall", run)
    release()
    expect(await a).toBe(1)
    expect(await b).toBe(1)
    expect(calls).toBe(1)
    // Once it settles, the next request starts a new one.
    const c = shareInFlight("u1:overall", run)
    release()
    await c
    expect(calls).toBe(2)
  })

  it("the route serves a stale run and shares its computations", () => {
    const route = stripped("src/app/api/insights/correlations/route.ts")
    expect(route).toMatch(/insightsCacheState\(/)
    expect(route).toMatch(/shareInFlight\(/)
    expect(route).toMatch(/\bafter\(/)
  })
})

const stripped = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
