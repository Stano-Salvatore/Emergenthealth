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

  // These assert the branch, the label and the counts — not the sentence that
  // carries them. Pinning exact phrasing made a copy pass that changed no
  // behaviour look like five broken tests, which teaches the next person to
  // reach for the wording rather than the meaning.

  it("names the thin side and its count — the 7-hot-days card", () => {
    const msg = weaknessReason({ ...base, tier: "noise", highGroupN: 7, lowGroupN: 57 })!
    expect(msg).toContain("hot days (25°C+)")
    expect(msg).toContain("7 days")
    expect(msg).not.toContain("cooler days")
    expect(msg, "a thin side is fixed by logging, not by a bigger effect").toMatch(/more days/i)
  })

  it("names the thin LOW side when that's the starved one", () => {
    const msg = weaknessReason({ ...base, tier: "noise", highGroupN: 57, lowGroupN: 7 })!
    expect(msg).toContain("cooler days")
    expect(msg).toContain("7 days")
  })

  it("covers both sides thin — the mood-starved 17/8 shape at week scale", () => {
    const msg = weaknessReason({ ...base, tier: "noise", highGroupN: 6, lowGroupN: 8 })!
    expect(msg).toContain("6")
    expect(msg).toContain("8")
    expect(msg).toMatch(/both sides/i)
    expect(msg).toMatch(/more days/i)
  })

  it("blames the effect, not the sample, when both sides clear the bar", () => {
    const msg = weaknessReason({ ...base, tier: "noise", highGroupN: 40, lowGroupN: 41 })!
    expect(msg).toContain("40")
    expect(msg).toContain("41")
    // The distinguishing claim: the days are fine, so more of them won't help.
    expect(msg).not.toMatch(/more days/i)
    expect(msg).toMatch(/small/i)
  })

  it("handles a single day without a plural", () => {
    const msg = weaknessReason({ ...base, tier: "noise", highGroupN: 1, lowGroupN: 30 })!
    expect(msg).toContain("1 day")
    expect(msg).not.toContain("1 days")
  })
})
