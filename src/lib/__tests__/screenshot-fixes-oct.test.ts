import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { markFigures } from "@/lib/figure-marks"
import { generatedLabel } from "@/lib/generated-label"
import { vitalText } from "@/lib/vital-format"

// Three things the live app showed on 1 Oct.

describe("a clock time with am/pm is one figure", () => {
  it("'past 1:50am' marks 1:50am, not a lone sleep-coloured 1", () => {
    const figs = markFigures("The late night (past 1:50am) catching up").filter(s => s.figure)
    expect(figs).toEqual([{ text: "1:50am", figure: true }])
  })

  it("'10:30 pm' and 'a.m.' forms too", () => {
    expect(markFigures("in bed by 10:30 pm").filter(s => s.figure).map(s => s.text)).toEqual(["10:30 pm"])
    expect(markFigures("up at 6:15 a.m. today").filter(s => s.figure).map(s => s.text)).toEqual(["6:15 a.m."])
  })
})

describe("the brief's timestamp", () => {
  it("is on the 24-hour clock the rest of the app uses", () => {
    const label = generatedLabel(new Date(2026, 9, 1, 13, 30).toISOString())
    expect(label).not.toMatch(/AM|PM/i)
    expect(label).toContain("13:30")
  })
})

describe("skin temperature on the vitals card", () => {
  it("is a change from the usual, so it carries its sign and a decimal", () => {
    expect(vitalText("skinTemp", 0.04, " °C")).toBe("+0.0 °C")
    expect(vitalText("skinTemp", 0.4, " °C")).toBe("+0.4 °C")
    expect(vitalText("skinTemp", -0.3, " °C")).toBe("−0.3 °C")
  })

  it("every other vital reads as before", () => {
    expect(vitalText("restingHR", 52, " bpm")).toBe("52 bpm")
    expect(vitalText("spo2", 93.7, "%")).toBe("93.7%")
  })

  it("the card uses it for the reading and the usual", () => {
    const card = readFileSync("src/components/dashboard/VitalsCard.tsx", "utf8")
    expect(card.match(/vitalText\(/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
