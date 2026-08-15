import { describe, it, expect } from "vitest"
import { mergeGoals, DEFAULT_GOALS } from "../goals"

describe("mergeGoals", () => {
  it("fills every gap from the defaults", () => {
    expect(mergeGoals(DEFAULT_GOALS, {})).toEqual(DEFAULT_GOALS)
    expect(mergeGoals(DEFAULT_GOALS, null).steps).toBe(8000)
    expect(mergeGoals(DEFAULT_GOALS, "nonsense").sleepH).toBe(7.5)
  })

  it("applies a partial patch without disturbing the rest", () => {
    const out = mergeGoals(DEFAULT_GOALS, { steps: 12000 })
    expect(out.steps).toBe(12000)
    expect(out.sleepH).toBe(DEFAULT_GOALS.sleepH)
  })

  it("reads the legacy blob's string numbers", () => {
    // The old JSON blob was written straight from form inputs.
    const out = mergeGoals(DEFAULT_GOALS, { steps: "9500", sleepH: "8" })
    expect(out.steps).toBe(9500)
    expect(out.sleepH).toBe(8)
  })

  it("rounds the fields the schema stores as integers", () => {
    expect(mergeGoals(DEFAULT_GOALS, { steps: 8500.7 }).steps).toBe(8501)
    // …and leaves the ones that are genuinely fractional alone
    expect(mergeGoals(DEFAULT_GOALS, { sleepH: 7.25 }).sleepH).toBe(7.25)
  })

  it("refuses values a goal can't survive", () => {
    // A zero step goal is a divide-by-zero in every progress bar that reads it.
    expect(mergeGoals(DEFAULT_GOALS, { steps: 0 }).steps).toBe(8000)
    expect(mergeGoals(DEFAULT_GOALS, { sleepH: 99 }).sleepH).toBe(7.5)
    expect(mergeGoals(DEFAULT_GOALS, { coffeeMax: -5 }).coffeeMax).toBe(400)
    expect(mergeGoals(DEFAULT_GOALS, { steps: "abc" }).steps).toBe(8000)
  })

  it("ignores keys that aren't goals", () => {
    const out = mergeGoals(DEFAULT_GOALS, { userId: "someone-else", nope: 1 }) as Record<string, unknown>
    expect(out.userId).toBeUndefined()
    expect(out.nope).toBeUndefined()
  })

  it("allows clearing the optional body fields", () => {
    const withBody = mergeGoals(DEFAULT_GOALS, { weightKg: 80, heightCm: 180, sex: "male" })
    expect(withBody).toMatchObject({ weightKg: 80, heightCm: 180, sex: "male" })
    const cleared = mergeGoals(withBody, { weightKg: null, sex: "" })
    expect(cleared.weightKg).toBeNull()
    expect(cleared.sex).toBeNull()
    expect(cleared.heightCm).toBe(180)
  })

  it("only accepts the two sex values the body calculations understand", () => {
    expect(mergeGoals(DEFAULT_GOALS, { sex: "female" }).sex).toBe("female")
    expect(mergeGoals(DEFAULT_GOALS, { sex: "other" }).sex).toBeNull()
  })
})
