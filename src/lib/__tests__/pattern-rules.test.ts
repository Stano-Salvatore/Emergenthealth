import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { CONFIDENT_N, EARLIEST_CONFIDENT_DAY, EARLIEST_TEST_DAY, MIN_GROUP_DAYS, noPatternsYet } from "@/lib/pattern-rules"
import { CONFIDENT_N as ENGINE_CONFIDENT_N } from "@/lib/correlations"

const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

// The onboarding and the Insights empty state tell a new user when patterns
// can appear. Those sentences are only true while they quote the engine's own
// bars — so the bars live in one module and both sides read it.

describe("the numbers the user is told are the engine's own", () => {
  it("compareGroups waits for MIN_GROUP_DAYS a side, not a literal of its own", () => {
    const engine = strip("src/lib/correlations.ts")
    expect(engine).toMatch(/minN = MIN_GROUP_DAYS/)
    expect(engine).not.toMatch(/minN = \d/)
  })

  it("there is one CONFIDENT_N, and the engine re-exports it", () => {
    expect(ENGINE_CONFIDENT_N).toBe(CONFIDENT_N)
    expect(strip("src/lib/correlations.ts")).not.toMatch(/const CONFIDENT_N = /)
  })

  it("the earliest days are both sides at the bar, nothing more hopeful", () => {
    expect(EARLIEST_TEST_DAY).toBe(2 * MIN_GROUP_DAYS)
    expect(EARLIEST_CONFIDENT_DAY).toBe(2 * CONFIDENT_N)
  })
})

describe("what runs in the browser reads the small module, not the engine", () => {
  // The engine imports the database client; a page that imports it for one
  // number drags the server module into the client bundle.
  it.each([
    "src/lib/insight-weakness.ts",
    "src/components/onboarding/PatternsStep.tsx",
    "src/app/onboarding/OnboardingWizard.tsx",
    "src/app/dashboard/insights/page.tsx",
    "src/components/dashboard/InsightsPanel.tsx",
  ])("%s", file => {
    expect(strip(file)).not.toMatch(/import (?!type)[^;]*from "(\.\/|\.\.\/|@\/lib\/)correlations"/)
  })
})

describe("no day counts typed out by hand where the user reads about patterns", () => {
  it.each([
    "src/components/onboarding/PatternsStep.tsx",
    "src/app/onboarding/OnboardingWizard.tsx",
    "src/app/dashboard/insights/page.tsx",
  ])("%s", file => {
    const src = strip(file)
    expect(src).not.toMatch(/\b(5|10|20) days\b/)
    expect(src).not.toMatch(/At least 5 days per group/)
  })

  it.each([
    "src/app/dashboard/insights/page.tsx",
    "src/components/dashboard/InsightsPanel.tsx",
  ])("%s says why it is empty with the shared sentence", file => {
    const src = strip(file)
    expect(src).toMatch(/noPatternsYet\(/)
    expect(src).not.toMatch(/keep logging!/)
  })
})

describe("why a window is empty, in days", () => {
  it("a window shorter than two minimum sides says so, instead of asking for more logging", () => {
    const line = noPatternsYet(7, 7)
    expect(line).toMatch(/^7 days is too short/)
    expect(line).toContain(`${MIN_GROUP_DAYS} days on each side`)
    expect(line).not.toMatch(/keep logging/i)
  })

  it("a new account is told the earliest day, from the rule", () => {
    expect(noPatternsYet(0, 90)).toMatch(/^No days of data yet\./)
    expect(noPatternsYet(1, 90)).toMatch(/^1 day of data so far\./)
    expect(noPatternsYet(3, 90)).toContain(`day ${EARLIEST_TEST_DAY} is the earliest`)
  })

  it("past the earliest day it states the fact and nothing it can't know", () => {
    expect(noPatternsYet(EARLIEST_TEST_DAY, 90)).toBe(`No comparison has ${MIN_GROUP_DAYS} days on each side in this window yet.`)
    expect(noPatternsYet(null, 90)).toBe(`No comparison has ${MIN_GROUP_DAYS} days on each side in this window yet.`)
  })
})

describe("the windows are one table", () => {
  it("the engine and the Insights page read the same one", async () => {
    const { PERIOD_DAYS: engine } = await import("@/lib/correlations")
    const { PERIOD_DAYS: shared } = await import("@/lib/pattern-rules")
    expect(engine).toBe(shared)
    expect(strip("src/app/dashboard/insights/page.tsx")).not.toMatch(/const PERIOD_DAYS/)
  })
})
