import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { parseInsightsCache, insightForModel } from "@/lib/insights-cache"

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

describe("a card's caveats travel with it to the model", () => {
  // The Insights page shows "Weekend pattern?", the confound sentence and the
  // coverage note under a Solid card. The brief and Emergy's system prompt
  // took only `finding`, so a card flagged "nights with caffeine after 16:00
  // typically began 150 minutes later, so some of this gap is bedtime"
  // reached the model as a plain established fact, and the morning brief told
  // the user coffee costs them 12 points of sleep.
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
  const confounded = "Bedtime does not hold still here. Nights with caffeine after 16:00 typically began 150 minutes later, so some of this gap is bedtime."

  it("keeps the confound, the weekend flag and the coverage note", () => {
    const line = insightForModel({
      finding: "After caffeine past 16:00, sleep score averages 70 vs 82",
      weekendDriven: true, confounded, coverage: "Rests on 32 logged days of 90.",
    })
    expect(line).toContain("After caffeine past 16:00, sleep score averages 70 vs 82")
    expect(line).toMatch(/weekend/i)
    expect(line).toContain(confounded)
    expect(line).toContain("Rests on 32 logged days of 90.")
  })

  it("adds nothing to a card with no caveats", () => {
    expect(insightForModel({ finding: "More steps, deeper sleep" })).toBe("More steps, deeper sleep")
  })

  it("the brief and the system prompt both go through it, and the brief through the parser", () => {
    const brief = stripped("src/app/api/briefing/route.ts")
    expect(brief).toMatch(/parseInsightsCache\(/)
    expect(brief).toMatch(/insightForModel\(/)
    expect(/payload\??\.insights/.test(brief), "the brief still hand-parses the insights cache").toBe(false)
    const chat = stripped("src/lib/claude.ts")
    expect(chat.match(/insightForModel\(/g)?.length ?? 0, "the system prompt and the patterns tool must both use it").toBeGreaterThanOrEqual(2)
  })
})
