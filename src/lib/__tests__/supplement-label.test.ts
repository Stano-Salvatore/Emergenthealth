import { describe, it, expect } from "vitest"
import { cleanLabel } from "@/lib/supplement-normalize"

// A label is the identity of a substance everywhere in the app: the meds page
// groups by it, and the correlation engine counts days by it against a 5-day
// threshold. "Atarax" and "Atarax - half" splitting in two is enough to leave
// both halves below that line, so a real pattern never surfaces at all.

describe("cleanLabel", () => {
  it("strips a worded or fractional dose from the end", () => {
    expect(cleanLabel("Atarax - half")).toBe("Atarax")
    expect(cleanLabel("Atarax 1/2")).toBe("Atarax")
    expect(cleanLabel("Atarax ½")).toBe("Atarax")
    expect(cleanLabel("Atarax (half)")).toBe("Atarax")
    expect(cleanLabel("Magnesium x2")).toBe("Magnesium")
  })

  it("handles Slovak dose words, accented or not", () => {
    expect(cleanLabel("Frontin pol")).toBe("Frontin")
    expect(cleanLabel("Elicea polovica")).toBe("Elicea")
    expect(cleanLabel("Atarax štvrtina")).toBe("Atarax")
    expect(cleanLabel("Atarax stvrtina")).toBe("Atarax")
  })

  it("still strips numeric doses, and both kinds together", () => {
    expect(cleanLabel("Atarax 25 mg")).toBe("Atarax")
    expect(cleanLabel("Atarax 25 mg - half")).toBe("Atarax")
    expect(cleanLabel("Vitamin D3 2000 IU")).toBe("Vitamin D3")
  })

  it("leaves a name alone when the word is part of it", () => {
    // Only the end of a label is a dose annotation; anywhere else it is a name.
    expect(cleanLabel("Half-life booster")).toBe("Half-life booster")
    expect(cleanLabel("Polprazol")).toBe("Polprazol")
    expect(cleanLabel("Omega 3")).toBe("Omega 3")
    expect(cleanLabel("Vitamin D")).toBe("Vitamin D")
  })

  it("never returns an empty name", () => {
    expect(cleanLabel("half")).toBe("half")
    expect(cleanLabel("25 mg")).toBe("25 mg")
  })
})
