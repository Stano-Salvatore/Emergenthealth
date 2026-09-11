import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ALCOHOL_TYPES, isAlcohol, ethanolGrams } from "@/lib/body-load"

// A standing guard, not a unit test.
//
// The Intake screen has its own button for beer, for wine and for spirits,
// because the ABV table needs to know which. "alcohol" is the fourth button,
// for a cocktail or anything unlabelled, and it is the one nobody taps.
//
// Every analysis path in the app was written as `type: "alcohol"`. On this
// account that is 19 beers and 3 glasses of wine across 10 evenings in a
// 90-day window — and the correlation engine reported, in good faith, that
// there had been no drinking at all. It was not a thin signal being honestly
// filed as weak. The rows were never read.
//
// The failure mode is that the obvious spelling is the wrong one, and it fails
// silently, in the direction of "no effect found" — which looks exactly like a
// correct answer.

const FILES = [
  "src/lib/correlations.ts",
  "src/lib/lab-trends-load.ts",
  "src/lib/claude.ts",
  "src/app/dashboard/page.tsx",
  "src/app/api/stats/route.ts",
  "src/app/api/body-load/route.ts",
  "src/lib/quick-answer-run.ts",
]

/** Files that may legitimately name a drink type, but not re-list the set. */
const NO_SECOND_COPY = [
  ...FILES,
  "src/app/dashboard/intake/page.tsx",
]

describe("alcohol is four types, not one", () => {
  it("names all of them in one place", () => {
    expect([...ALCOHOL_TYPES].sort()).toEqual(["alcohol", "beer", "spirits", "wine"])
    expect(isAlcohol("beer")).toBe(true)
    expect(isAlcohol("Wine")).toBe(true)
    expect(isAlcohol("coffee")).toBe(false)
    expect(isAlcohol(null)).toBe(false)
  })

  it.each(NO_SECOND_COPY)("%s keeps no second copy of the list", file => {
    // Four copies of ["beer","wine","spirits","alcohol"] existed at once, in
    // four files, agreeing by luck. A fifth added tomorrow would not.
    //
    // Matched as a complete bracketed list, so the Intake screen's full drink
    // picker — which really does offer those four among ten — is not a copy of
    // this set and does not trip.
    const source = readFileSync(file, "utf8")
    expect(source, "import ALCOHOL_TYPES rather than re-listing it")
      .not.toMatch(/\[\s*"beer",\s*"wine",\s*"spirits",\s*"alcohol",?\s*\]/)
  })

  it.each(FILES)("%s never filters on the one literal type", file => {
    const source = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    expect(source, `use ALCOHOL_TYPES / isAlcohol — "alcohol" is one of four`)
      .not.toMatch(/type:\s*"alcohol"/)
    expect(source, `use isAlcohol() — "alcohol" is one of four`)
      .not.toMatch(/\.type\s*===\s*"alcohol"/)
  })
})

describe("a dose is grams of ethanol, not millilitres", () => {
  it("reads the strength off the note when the log carries one", () => {
    // Real notes from this account: "Beer 4.8%", "Beer 12° (4.8%)".
    expect(ethanolGrams("beer", 500, "Beer 4.8%")).toBeCloseTo(500 * 0.048 * 0.789, 3)
    // Degrees are Plato, not ABV — no percent sign, so the type's ABV stands.
    expect(ethanolGrams("beer", 500, "13°")).toBeCloseTo(500 * 0.05 * 0.789, 3)
  })

  it("separates the same volume of two different drinks", () => {
    const beer = ethanolGrams("beer", 300)
    const wine = ethanolGrams("wine", 300)
    expect(wine).toBeGreaterThan(beer * 2)
  })

  it("gives a non-alcoholic type nothing", () => {
    expect(ethanolGrams("coffee", 500)).toBe(0)
    expect(ethanolGrams("water", 500)).toBe(0)
  })

  it("never prints a threshold it stopped applying", () => {
    // The split moved to grams of ethanol and four cards went on saying
    // "(50ml+)" — a number the engine no longer used to decide anything. The
    // rule is already written down beside balancedCut: a card never claims a
    // threshold it did not apply.
    const engine = readFileSync("src/lib/correlations.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    expect(engine, "an alcohol card is quoting millilitres").not.toMatch(/drinking days \(\d+\s*ml/i)
    expect(engine).toContain("DRINKING_DAYS_LABEL")
  })

  it("the engine reasons in grams", () => {
    const engine = readFileSync("src/lib/correlations.ts", "utf8")
    expect(engine).toContain("STANDARD_DRINK_G")
    // The volume is deliberately not carried: a millilitre threshold is two
    // different questions depending on what was in the glass.
    expect(engine).not.toMatch(/alcoholMl/)
  })
})
