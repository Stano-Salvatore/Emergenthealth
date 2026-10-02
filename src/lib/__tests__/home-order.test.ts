import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "")

// The phone's first screen: how last night went, then what is left of today.
// The brief and the vitals card were stacked above both, and once the vitals
// card arrived the sleep numbers and the day had slid below the fold.

describe("the phone's home screen order", () => {
  it("inside the Today view: score and sleep, then the day, then the calendar", () => {
    const src = strip("src/components/dashboard/MobileToday.tsx")
    const sleep = src.indexOf("🌙 Sleep")
    const day = src.indexOf("Your day")
    const calendar = src.indexOf("Up next")
    expect(sleep).toBeGreaterThan(-1)
    expect(day).toBeGreaterThan(sleep)
    expect(calendar).toBeGreaterThan(day)
  })

  it("Emergy's brief and last night's vitals come after the Today view on a phone, as before on desktop", () => {
    const src = strip("src/app/dashboard/page.tsx")
    // The brief block is its own element, ordered last below md.
    expect(src).toMatch(/max-md:order-last[^>]*>[\s\S]*?<DailyBriefing \/>[\s\S]*?<VitalsCard/)
  })
})
