import { describe, it, expect } from "vitest"
import { dominantGenre } from "@/lib/correlations"

// The cases that decide whether a day earns a genre label. The bar is a
// MAJORITY of the day's tagged plays — the alternative was the single top
// artist, which handed 3-track days a confident label and 20-track days none.

const tags = new Map([
  ["psí vojáci", "underground"],
  ["dg 307", "underground"],
  ["wabi danek", "folk"],
  ["hop trop", "folk"],
])

describe("dominantGenre", () => {
  it("labels a day whose tagged plays are mostly one genre", () => {
    // 9 underground vs 4 folk — a real majority, whoever topped the day.
    expect(dominantGenre({ "Psí vojáci": 5, "DG 307": 4, "Wabi Danek": 4 }, tags))
      .toBe("underground")
  })

  it("is decided by share, not by who topped the day", () => {
    // The old label: Wabi Danek tops with 6 plays → "folk". But the two
    // underground acts together hold 10 of 16 tagged plays. The day was an
    // underground day with a folk winner, and share sees that.
    expect(dominantGenre({ "Wabi Danek": 6, "Psí vojáci": 5, "DG 307": 5 }, tags))
      .toBe("underground")
  })

  it("refuses a label when no genre holds a majority", () => {
    // 5 folk vs 5 underground: calling either one "the day" is a coin flip
    // wearing a category. No label beats a wrong one.
    expect(dominantGenre({ "Wabi Danek": 5, "Psí vojáci": 5 }, tags)).toBeNull()
  })

  it("ignores untagged artists rather than letting them dilute the vote", () => {
    // 30 plays of an obscurity Last.fm has never tagged say nothing about
    // genre — the 4 tagged folk plays still speak for what CAN be read.
    expect(dominantGenre({ "Obscure Act": 30, "Hop Trop": 4 }, tags)).toBe("folk")
  })

  it("needs at least 3 tagged plays before a majority means anything", () => {
    expect(dominantGenre({ "Hop Trop": 2 }, tags)).toBeNull()
    expect(dominantGenre({ "Hop Trop": 3 }, tags)).toBe("folk")
  })

  it("matches artists case-insensitively, the way ArtistGenre stores them", () => {
    expect(dominantGenre({ "HOP TROP": 3 }, tags)).toBe("folk")
  })

  it("survives a row whose JSON is not what it should be", () => {
    expect(dominantGenre(null, tags)).toBeNull()
    expect(dominantGenre(undefined, tags)).toBeNull()
    expect(dominantGenre({ "Hop Trop": "many" as unknown as number }, tags)).toBeNull()
    expect(dominantGenre({ "Hop Trop": -5 }, tags)).toBeNull()
  })
})
