import { describe, it, expect } from "vitest"
import { scoreStatus, scoreHex, scoreText, sleepVerdictText, STATUS_HEX, SCORE_EMPTY_HEX } from "@/lib/score-color"

describe("scoreStatus", () => {
  it("puts the thresholds at 85 and 70", () => {
    expect(scoreStatus(85)).toBe("on")
    expect(scoreStatus(84)).toBe("watch")
    expect(scoreStatus(70)).toBe("watch")
    expect(scoreStatus(69)).toBe("off")
  })

  // The whole reason this module exists: 84 used to be lime on one screen,
  // amber on another and yellow on a third.
  it("gives one score exactly one colour", () => {
    expect(scoreHex(84)).toBe(scoreHex(84))
    expect(scoreHex(84)).toBe(STATUS_HEX.watch)
    expect(scoreText(84)).toBe("text-amber-400")
  })

  // Status is three steps and nothing else — a fourth band is how the drift
  // started, and the move hue #a3e635 is identity, never status.
  it("never returns a colour outside the status palette", () => {
    const seen = new Set(Array.from({ length: 101 }, (_, i) => scoreHex(i)))
    expect(seen).toEqual(new Set(Object.values(STATUS_HEX)))
  })
})

describe("a missing score", () => {
  it("is neutral, not off-target", () => {
    expect(scoreHex(null)).toBe(SCORE_EMPTY_HEX)
    expect(scoreHex(null)).not.toBe(STATUS_HEX.off)
  })

  it("takes the caller's empty class rather than a status one", () => {
    expect(scoreText(null, "text-muted-foreground")).toBe("text-muted-foreground")
    expect(scoreText(undefined)).toBe("")
  })
})

describe("sleepVerdictText", () => {
  it("reads a good night as on target", () => {
    expect(sleepVerdictText(true, 8)).toBe("text-emerald-400")
  })

  it("reads a short-but-not-terrible night as watch", () => {
    expect(sleepVerdictText(false, 6.5)).toBe("text-amber-400")
  })

  it("reads under six hours as off target", () => {
    expect(sleepVerdictText(false, 5)).toBe("text-red-400")
  })

  // Preserved from the four hand-written copies this replaced, not endorsed:
  // a night with no data reads as off target rather than neutral, which is the
  // opposite of how a missing SCORE is treated above. Worth deciding, but it is
  // a behaviour change, not a colour one, so it is not being made here.
  it("still reads an unknown night as off target, as it always did", () => {
    expect(sleepVerdictText(null, null)).toBe("text-red-400")
  })
})
