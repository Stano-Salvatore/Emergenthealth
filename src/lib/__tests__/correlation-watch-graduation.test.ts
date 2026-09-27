import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { graduatedNow, watchStateFor, type WatchEntry } from "@/lib/watch-message"

// "New solid pattern" is announced by push, a chat bubble and an email. The
// cron compared only yesterday's tier with today's, so a card sitting on the
// false-discovery cutoff — strong Monday, suggestive Tuesday as one day
// slides through the 90-day window, strong again Wednesday — announced the
// same pattern as new every time it came back.

type Ins = { delta: number; confident: boolean; tier: string }
const ins = (tier: string): Ins => ({ delta: 12, confident: true, tier })

/** Run the cron's state machine over a sequence of daily tiers. */
function announcements(tiers: string[]): number[] {
  let prev: WatchEntry | undefined
  const said: number[] = []
  tiers.forEach((tier, day) => {
    const cur = ins(tier)
    if (graduatedNow(cur, prev)) said.push(day)
    prev = watchStateFor(cur, prev)
  })
  return said
}

describe("a pattern graduates to Solid once", () => {
  it("announces the first climb to strong", () => {
    expect(announcements(["suggestive", "strong"])).toEqual([1])
  })

  it("does not re-announce a card that wobbles across the cutoff", () => {
    expect(announcements(["suggestive", "strong", "suggestive", "strong", "suggestive", "strong"])).toEqual([1])
  })

  it("announces again after the pattern has really gone and come back", () => {
    // Dropping all the way to noise ends the pattern; a later return is news.
    expect(announcements(["suggestive", "strong", "noise", "suggestive", "strong"])).toEqual([1, 4])
  })

  it("never announces on the first sight of a card", () => {
    expect(announcements(["strong", "strong"])).toEqual([])
  })

  it("treats an old baseline already at strong as announced", () => {
    // Stored before the flag existed: { tier: "strong" } with no `graduated`.
    const legacy: WatchEntry = { delta: 12, confident: true, tier: "strong" }
    const afterSlip = watchStateFor(ins("suggestive"), legacy)
    expect(graduatedNow(ins("strong"), afterSlip)).toBe(false)
  })
})

describe("the cron uses the sticky state for every write", () => {
  const src = readFileSync("src/app/api/cron/correlation-watch/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("decides graduation through graduatedNow", () => {
    expect(src).toMatch(/graduatedNow\(/)
  })

  it("never writes a bare { delta, confident, tier } that would drop the flag", () => {
    expect(src).not.toMatch(/=\s*\{\s*delta:\s*ins\.delta,\s*confident:\s*ins\.confident,\s*tier:\s*ins\.tier\s*\}/)
  })
})
