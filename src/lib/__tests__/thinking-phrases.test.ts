import { describe, it, expect } from "vitest"
import { thinkingPhrases } from "../chat-sources"

// The caret this replaces was the same single mark every time, so a ten-second
// wait looked exactly like a dead one. These pin the two properties that fix
// that: it varies between messages, and it never repeats within one wait.

describe("thinkingPhrases", () => {
  it("gives every phrase once, so a wait never repeats itself", () => {
    const p = thinkingPhrases("abc")
    expect(new Set(p).size).toBe(p.length)
    expect(p.length).toBeGreaterThan(5)
  })

  it("opens on a different word for different messages", () => {
    const openers = new Set(
      ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"].map(id => thinkingPhrases(id)[0]),
    )
    // Not all eight — collisions are fine — but plainly not one fixed opener.
    expect(openers.size).toBeGreaterThan(2)
  })

  it("is stable for one message, so a re-render cannot reshuffle mid-sentence", () => {
    expect(thinkingPhrases("same-id")).toEqual(thinkingPhrases("same-id"))
  })

  it("is a rotation, so the same set is always on offer", () => {
    const a = thinkingPhrases("x")
    const b = thinkingPhrases("y")
    expect([...a].sort()).toEqual([...b].sort())
  })

  it("survives an empty seed", () => {
    expect(thinkingPhrases("").length).toBeGreaterThan(0)
  })
})
