import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { SONNET, OPUS, HAIKU } from "../models"
import { turnCostUsd } from "../model-cost"

// One week of the ledger said it plainly: chat was $4.53 of a $4.91 bill —
// 92% — with meal photos and briefings as rounding. Chat, photos and the
// weekly review are conversational tool work the mid-tier model does well;
// what earns the top-tier price is the analysis where being subtly wrong
// matters: a photographed lab printout and the health report. This pins the
// assignment so a refactor cannot quietly promote the cheap paths back to
// five-dollar tokens, or demote the two accuracy-critical ones.

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

describe("who runs on which model", () => {
  it("chat runs on the mid-tier model, and prices its own turns as it", () => {
    const s = strip("src/lib/claude.ts")
    expect(s).toMatch(/model: SONNET/)
    expect(s).not.toMatch(/model: OPUS/)
    expect(s).not.toMatch(/turnCostUsd\(OPUS/)
  })
  it("meal photos and the weekly review follow chat", () => {
    expect(strip("src/lib/food-analyze.ts")).toMatch(/model: SONNET/)
    expect(strip("src/lib/weekly-review.ts")).toMatch(/model: SONNET/)
  })
  it("lab documents and the health report keep the top-tier model", () => {
    expect(strip("src/lib/lab-analyze.ts")).toMatch(/model: OPUS/)
    expect(strip("src/lib/health-report.ts")).toMatch(/model: OPUS/)
  })
  it("the briefing and the garden stay on the small model", () => {
    expect(strip("src/app/api/briefing/route.ts")).toMatch(/model: HAIKU/)
    expect(strip("src/app/api/garden/emergy/route.ts")).toMatch(/model: HAIKU/)
  })
})

describe("chat effort steps down by default", () => {
  it("unset means medium, 'default' hands the choice back to the model", async () => {
    const { chatEffort } = await import("../claude")
    const prev = process.env.EMERGY_CHAT_EFFORT
    try {
      delete process.env.EMERGY_CHAT_EFFORT
      expect(chatEffort()).toBe("medium")
      process.env.EMERGY_CHAT_EFFORT = "high"
      expect(chatEffort()).toBe("high")
      process.env.EMERGY_CHAT_EFFORT = "default"
      expect(chatEffort()).toBeNull()
    } finally {
      if (prev === undefined) delete process.env.EMERGY_CHAT_EFFORT
      else process.env.EMERGY_CHAT_EFFORT = prev
    }
  })
})

describe("the ledger can price every model in use", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 }
  it("sonnet", () => expect(turnCostUsd(SONNET, usage)).toBe(12))
  it("opus", () => expect(turnCostUsd(OPUS, usage)).toBe(30))
  it("haiku", () => expect(turnCostUsd(HAIKU, usage)).toBe(6))
  it("an unknown model is null, never zero", () =>
    expect(turnCostUsd("some-future-model", usage)).toBeNull())
})
