import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { nightQuestion, isNightQuestion, type Anomaly } from "@/lib/anomalies"

// At 08:30 Emergy asks "Your HRV dipped (night to Fri 26 Sep). Did something
// happen yesterday — a drink…?" and the user answers "had 0.5l of wine". The
// quick-log path recognised the shape of a drink and filed 500 ml of wine at
// 08:30 TODAY: ethanol in the blood this morning, today's totals up, and the
// correlation engine pinning it to tonight's sleep rather than the night that
// dipped. An answer to that question belongs to that night, and only the
// model reads the question and backdates — so it goes to him.

const anomaly = (over: Partial<Anomaly>): Anomaly => ({
  metric: "hrv", date: "2026-09-26", runLength: 1, concerning: true,
  summary: "Your HRV dipped to 31 ms, well under your usual", emoji: "💓",
  ...over,
} as Anomaly)

describe("isNightQuestion", () => {
  it("recognises both phrasings nightQuestion produces", () => {
    const bad = nightQuestion(anomaly({ concerning: true }))
    const good = nightQuestion(anomaly({ concerning: false }))
    expect(bad).not.toBeNull()
    expect(good).not.toBeNull()
    expect(isNightQuestion(bad!)).toBe(true)
    expect(isNightQuestion(good!)).toBe(true)
  })
  it("still recognises the question after sayAsEmergy collapses its whitespace", () => {
    expect(isNightQuestion(nightQuestion(anomaly({}))!.replace(/\s+/g, " "))).toBe(true)
  })
  it("ignores an ordinary reply", () => {
    expect(isNightQuestion("Logged 300 ml water — 1.2 L so far today.")).toBe(false)
    expect(isNightQuestion("Did something happen yesterday? You seem tired.")).toBe(false)
  })
})

describe("the chat route leaves an answer to a night question to the model", () => {
  const route = readFileSync("src/app/api/chat/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("checks the last thing Emergy said before trying the quick path", () => {
    const check = route.indexOf("isNightQuestion(")
    const quick = route.indexOf("runQuickLog(")
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(quick)
    expect(route).toMatch(/role: "assistant" \}[\s\S]{0,40}orderBy: \{ createdAt: "desc" \}/)
  })
})
