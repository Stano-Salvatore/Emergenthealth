import { describe, it, expect } from "vitest"
import { weaknessReason } from "@/lib/insight-weakness"

// The two stories a bare "Could be chance" fails to tell apart: a verdict
// about the data (a group too thin to test) and a verdict about the effect
// (groups fine, gap within chance). Each case is a real card from the year
// window that prompted this.

const base = { highGroupLabel: "hot days (25°C+)", lowGroupLabel: "cooler days" }

describe("weaknessReason", () => {
  it("says nothing about cards that aren't weak", () => {
    expect(weaknessReason({ ...base, tier: "strong", highGroupN: 30, lowGroupN: 30 })).toBeNull()
    expect(weaknessReason({ ...base, tier: "suggestive", highGroupN: 4, lowGroupN: 60 })).toBeNull()
    expect(weaknessReason({ ...base, tier: undefined, highGroupN: 4, lowGroupN: 60 })).toBeNull()
  })

  it("names the thin side and its count — the 7-hot-days card", () => {
    const msg = weaknessReason({ ...base, tier: "noise", highGroupN: 7, lowGroupN: 57 })
    expect(msg).toContain("“hot days (25°C+)”")
    expect(msg).toContain("only 7 days")
    expect(msg).toContain("more days, not a bigger one")
  })

  it("names the thin LOW side when that's the starved one", () => {
    const msg = weaknessReason({ ...base, tier: "noise", highGroupN: 57, lowGroupN: 7 })
    expect(msg).toContain("“cooler days”")
    expect(msg).toContain("only 7 days")
  })

  it("covers both sides thin — the mood-starved 17/8 shape at week scale", () => {
    const msg = weaknessReason({ ...base, tier: "noise", highGroupN: 6, lowGroupN: 8 })
    expect(msg).toContain("6 and 8 days")
    expect(msg).toContain("More days decide this")
  })

  it("blames the effect, not the sample, when both sides clear the bar", () => {
    const msg = weaknessReason({ ...base, tier: "noise", highGroupN: 40, lowGroupN: 41 })
    expect(msg).toContain("Sample size isn't the problem")
    expect(msg).toContain("40 vs 41 days")
    expect(msg).toContain("it's small")
  })

  it("handles a single day without a plural", () => {
    const msg = weaknessReason({ ...base, tier: "noise", highGroupN: 1, lowGroupN: 30 })
    expect(msg).toContain("only 1 day in")
  })
})
