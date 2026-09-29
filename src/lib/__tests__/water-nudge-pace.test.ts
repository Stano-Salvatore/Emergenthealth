import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { waterNudgeLevel } from "@/lib/hydration"

// The afternoon push screamed "I HAVE SEEN 1000ml GO IN TODAY AND I AM
// WILTING" at five o'clock: anything under a fixed 1500 ml was the worst
// case, whatever the clock said and whatever the user's goal was. A litre by
// five against a two-litre goal is on pace. The level is now read against
// where the user's own goal says they should be by now.

describe("waterNudgeLevel", () => {
  it("leaves a litre by five o'clock alone on a two-litre goal", () => {
    expect(waterNudgeLevel(1000, 2000, "16:59")).toBe("fine")
  })

  it("nudges, without screaming, when behind but drinking", () => {
    expect(waterNudgeLevel(1000, 3000, "17:00")).toBe("nudge")
  })

  it("keeps the scream for a day that has barely started drinking", () => {
    expect(waterNudgeLevel(0, 2000, "15:00")).toBe("scream")
    expect(waterNudgeLevel(300, 2500, "17:00")).toBe("scream")
  })

  it("expects more the later it gets", () => {
    expect(waterNudgeLevel(1000, 2000, "15:00")).toBe("fine")
    expect(waterNudgeLevel(1000, 2000, "20:30")).toBe("nudge")
  })

  it("is fine once the goal is met", () => {
    expect(waterNudgeLevel(2000, 2000, "20:59")).toBe("fine")
  })
})

describe("the emergy-push cron", () => {
  const raw = readFileSync("src/app/api/cron/emergy-push/route.ts", "utf8")
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("judges water by pace against the user's goal, not a fixed line", () => {
    expect(src).not.toMatch(/water\s*<\s*1500/)
    expect(src).toMatch(/waterNudgeLevel\(/)
    expect(src).toMatch(/resolveWaterGoal\(/)
  })
})
