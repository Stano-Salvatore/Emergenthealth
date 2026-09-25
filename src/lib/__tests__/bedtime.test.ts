import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { medianStartMin, suggestFromNights, formatStart, MIN_NIGHTS } from "@/lib/bedtime"

// Samsung recommends tonight's bedtime from your own recent nights. The data
// for the same sentence has been sitting here for months: sleep starts, sleep
// scores, and now the phone-down history. The rule: tonight's target is when
// YOUR better nights started — never a poster's 22:00.

// Minutes since noon, so midnight doesn't split a bedtime cluster in half.
const m = (hhmm: string) => {
  const [h, mm] = hhmm.split(":").map(Number)
  return ((h + 12) % 24) * 60 + mm
}

describe("bedtimes around midnight are one cluster, not two", () => {
  it("23:50, 00:10 and 23:30 average near midnight, not near noon", () => {
    const med = medianStartMin([m("23:50"), m("00:10"), m("23:30")])
    expect(formatStart(med)).toBe("23:50")
  })
})

describe("suggestFromNights", () => {
  it("aims at the better-scored nights' start", () => {
    const nights = [
      ...Array(5).fill(0).map(() => ({ startMin: m("23:00"), score: 85 })),
      ...Array(5).fill(0).map(() => ({ startMin: m("01:30"), score: 60 })),
    ]
    const out = suggestFromNights(nights)
    expect(out).not.toBeNull()
    expect(formatStart(out!.targetMin)).toBe("23:00")
    expect(out!.sample).toBe(5)
  })

  it("with no scores it still answers from the median start", () => {
    const nights = [m("23:10"), m("23:40"), m("00:05"), m("23:20"), m("23:55")]
      .map(startMin => ({ startMin, score: null }))
    const out = suggestFromNights(nights)
    expect(formatStart(out!.targetMin)).toBe("23:40")
  })

  it("too few nights is no answer, not a made-up one", () => {
    expect(MIN_NIGHTS).toBeGreaterThanOrEqual(5)
    const nights = [{ startMin: m("23:00"), score: 80 }, { startMin: m("23:30"), score: 70 }]
    expect(suggestFromNights(nights)).toBeNull()
  })
})

describe("the suggestion reaches the evening surfaces", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("/api/today carries a bedtime", () => {
    expect(stripped("src/app/api/today/route.ts")).toMatch(/suggestBedtime\(/)
  })
  it("Tonight's brief says it out loud", () => {
    expect(readFileSync("src/components/dashboard/BriefView.tsx", "utf8")).toMatch(/aim for/i)
  })
  it("the evening briefing prompt knows it", () => {
    expect(stripped("src/app/api/briefing/route.ts")).toMatch(/suggestBedtime\(|suggested bedtime/i)
  })
})
