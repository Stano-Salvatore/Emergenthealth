import { describe, it, expect } from "vitest"
import { turnCostUsd } from "@/lib/model-cost"
import { OPUS, HAIKU } from "@/lib/models"

// The point of this file is that the number in the log line is the one the
// effort knob is judged on. A wrong price is worse than no price: it would be
// believed.

describe("turnCostUsd", () => {
  it("prices a cold turn from the token counts", () => {
    // 10,000 in at $5/M, 500 out at $25/M.
    expect(turnCostUsd(OPUS, { input_tokens: 10_000, output_tokens: 500 })).toBe(0.0625)
  })

  it("charges a quarter more for writing the cache and a tenth for reading it", () => {
    const write = turnCostUsd(OPUS, {
      input_tokens: 0, output_tokens: 500, cache_creation_input_tokens: 10_000,
    })
    const read = turnCostUsd(OPUS, {
      input_tokens: 0, output_tokens: 500, cache_read_input_tokens: 10_000,
    })
    // Output is the same in both, so the gap is the input alone: 12,500
    // token-equivalents against 1,000.
    expect(write).toBe(0.0750)
    expect(read).toBe(0.0175)
  })

  it("makes the tool loop's real shape visible", () => {
    // Three model turns inside one user message: the first writes the prefix,
    // the next two read it. 1.25 + 0.1 + 0.1 against 3 uncached.
    const prefix = 11_000
    const cold = turnCostUsd(OPUS, { input_tokens: prefix, output_tokens: 0 })!
    const loop =
      turnCostUsd(OPUS, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: prefix })! +
      2 * turnCostUsd(OPUS, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: prefix })!
    expect(loop).toBeLessThan(3 * cold)
    expect(loop / cold).toBeCloseTo(1.45, 2)
  })

  it("prices Haiku at a fifth of Opus for the same turn", () => {
    const usage = { input_tokens: 10_000, output_tokens: 500 }
    expect(turnCostUsd(HAIKU, usage)! * 5).toBeCloseTo(turnCostUsd(OPUS, usage)!, 6)
  })

  it("returns null for a model it has no price for, not zero", () => {
    // A free turn and an unpriced one are different facts, and summing the
    // second as zero would quietly understate the bill.
    expect(turnCostUsd("claude-something-new", { input_tokens: 10_000, output_tokens: 500 })).toBeNull()
  })
})
