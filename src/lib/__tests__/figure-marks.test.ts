import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { markFigures, figureClass } from "@/lib/figure-marks"

// Sentences Emergy actually wrote, from the phone. Each figure must be
// found, and take the hue of what it measures — or no hue, never a guess.

const figures = (text: string) => markFigures(text).filter(s => s.figure).map(s => [s.text, s.domain ?? null])

describe("markFigures", () => {
  it("sleep hours and clock-style durations are sleep", () => {
    expect(figures("You got 8.5 hours last night")).toEqual([["8.5 hours", "sleep"]])
    expect(figures("you're running on 6.0h and 5.9h the last two nights")).toEqual([["6.0h", "sleep"], ["5.9h", "sleep"]])
    expect(figures("nights that start after 23:30 average 5h 54m; earlier ones 7h 48m"))
      .toEqual([["23:30", null], ["5h 54m", "sleep"], ["7h 48m", "sleep"]])
  })

  it("heart units and readiness are heart", () => {
    expect(figures("a park and 122ms of HRV")).toEqual([["122ms", "heart"]])
    expect(figures("your readiness is up at 73")).toEqual([["73", "heart"]])
    expect(figures("resting HR 55 bpm")).toEqual([["55 bpm", "heart"]])
  })

  it("movement is move, fluid and caffeine are fuel, mood is mind", () => {
    expect(figures("That's 235km of moving today")).toEqual([["235km", "move"]])
    expect(figures("11,9k steps and 9,100 steps")).toEqual([["11,9k steps", "move"], ["9,100 steps", "move"]])
    expect(figures("Logged 400ml beer. That's 1.4L of fluid today.")).toEqual([["400ml", "fuel"], ["1.4L", "fuel"]])
    expect(figures("Mood logged at 5/5")).toEqual([["5/5", "mind"]])
  })

  it("\"min\" takes its domain from the words before it", () => {
    expect(figures("REM sleep averages 65 min; with an earlier start, 87 min"))
      .toEqual([["65 min", "sleep"], ["87 min", "sleep"]])
    expect(figures("a 38 min walk")).toEqual([["38 min", null]])
    expect(figures("you walked for 38 min")).toEqual([["38 min", "move"]])
  })

  it("percentages and weights are bold but carry no hue", () => {
    expect(figures("98% circulating")).toEqual([["98%", null]])
    expect(figures("down to 81.2 kg")).toEqual([["81.2 kg", null]])
  })

  it("a bare number is only a figure when a domain word introduces it", () => {
    expect(figures("Two small things, or 2 small things")).toEqual([])
    expect(figures("walking hasn't shown up in 14 days")).toEqual([])
    expect(figures("mood at 5 and energy 4")).toEqual([["5", "mind"], ["4", "mind"]])
  })

  it("keeps the prose around the figures intact", () => {
    const text = "You got 8.5 hours and 122ms of HRV."
    expect(markFigures(text).map(s => s.text).join("")).toBe(text)
  })
})

describe("figureClass is identity, never status", () => {
  it("uses the domain tokens and no status colour", () => {
    for (const d of ["sleep", "heart", "move", "fuel", "mind"] as const) {
      expect(figureClass(d)).toContain(`text-${d}`)
    }
    expect(figureClass(undefined)).toBe("font-semibold tabular-nums")
    const src = readFileSync("src/lib/figure-marks.ts", "utf8")
    expect(src, "a status colour has crept into the figure treatment").not.toMatch(/emerald|amber|red-|green-/)
  })
})

describe("both prose surfaces use it", () => {
  const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
  it("chat replies and the daily brief render figures through the same component", () => {
    expect(strip("src/components/emergy/ChatMarkdown.tsx")).toMatch(/markFigures\(/)
    expect(strip("src/components/dashboard/DailyBriefing.tsx"), "the brief is back to a bare <p>{briefing}</p>")
      .toMatch(/<ChatMarkdown text=\{briefing\}/)
  })
})
