import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// "add 100ml beer 1h ago" was logged as now, and Emergy had to explain his own
// tool's limitation back and offer to correct it afterwards. log_dose had
// accepted minutesAgo since it was written; the drinks and meals never got it.
//
// Source assertions rather than behaviour, because these handlers are one
// 1,800-line switch over a live Anthropic client and a live database. That is
// its own problem, but not one to fix at the same time as this.

const src = readFileSync("src/lib/claude.ts", "utf8")

/** Every tool that records something the user consumed. */
const INTAKE_TOOLS = ["log_water", "log_coffee", "log_drink", "log_food", "log_usual"]

describe("backdating an intake", () => {
  it.each(INTAKE_TOOLS)("%s offers minutesAgo", tool => {
    // The schema block runs from the tool's name to its `required`/close.
    const block = src.slice(src.indexOf(`name: "${tool}"`), src.indexOf(`name: "${tool}"`) + 1400)
    expect(block).toContain("minutesAgo")
  })

  it("stamps the caffeine row with the same instant as the drink", () => {
    // Caffeine is read as a decay curve against bedtime. A cup backdated an
    // hour whose caffeine row says "now" reports an hour more of it still
    // circulating — the backdating would make the sleep read worse, not truer.
    const caffeineWrites = [...src.matchAll(/caffeineLog\.create\(\{[\s\S]{0,220}?\}\)/g)].map(m => m[0])
    expect(caffeineWrites.length).toBeGreaterThan(0)
    for (const w of caffeineWrites) {
      expect(w, `a caffeineLog write without loggedAt:\n${w}`).toMatch(/loggedAt/)
    }
  })

  it("bounds how far back a log can be filed", () => {
    // A mistyped "600" should not file a beer into last week's sleep analysis.
    expect(src).toMatch(/clampInt\(input\.minutesAgo, 0, 48 \* 60, 0\)/)
  })

  it("says the time back, so a misread one is visible", () => {
    expect(src).toContain("function agoSuffix")
    expect(src.match(/agoSuffix\(/g)?.length ?? 0).toBeGreaterThanOrEqual(6)
  })
})
