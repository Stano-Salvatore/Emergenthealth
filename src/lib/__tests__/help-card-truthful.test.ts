import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { COMPONENTS } from "@/lib/daily-score"

// The Help card's FAQ is prose about how the app works, and prose is the one
// part of the app nothing recompiles. Two answers had gone stale without a
// sound: "the wellness score" still described the score daily-score.ts opens
// by saying it REPLACED — four fixed goals at 25 points each, a metric that
// didn't sync counted as zero — and "how streaks work" said a missed day
// resets the streak, a year after off-days and deliberate skips stopped
// breaking one. Nobody re-reads a FAQ; this does.

const FAQ = readFileSync("src/components/settings/HelpCard.tsx", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/[^\n]*/g, " ")

/** The answer that follows the question containing `q`. */
const answerTo = (q: string): string => {
  const at = FAQ.indexOf(q)
  expect(at, `no FAQ question mentions "${q}"`).toBeGreaterThan(-1)
  const m = /a: "((?:[^"\\]|\\.)*)"/.exec(FAQ.slice(at))
  expect(m, `no answer follows "${q}"`).not.toBeNull()
  return m![1]
}

describe("the Help FAQ describes the app that ships", () => {
  it("the score answer names the components daily-score.ts actually uses, and not the old fixed goals", () => {
    const a = answerTo("score")
    for (const c of COMPONENTS) {
      expect(a, `the score FAQ never mentions the "${c.label}" component`).toContain(c.label)
    }
    expect(a, "the score FAQ is describing the replaced 25/25/25/25 score again").not.toMatch(/25 pts|25 points/)
    // The one property of the new score worth a sentence: absence is not zero.
    expect(a).toMatch(/didn.t sync|left out|not counted as zero/i)
  })

  it("the streak answer knows about off-days and skips", () => {
    const a = answerTo("streak")
    expect(a, "habit-schedule.ts bridges a skipped day; the FAQ still says any missed day resets the streak")
      .toMatch(/skip/i)
    expect(a).toMatch(/scheduled/i)
  })
})
