import { describe, it, expect } from "vitest"
import { latestThought } from "@/lib/chat-sources"

describe("latestThought", () => {
  it("shows the last sentence, lowercased, without its full stop", () => {
    expect(latestThought("The user wants a comparison. I should pull both stretches and test them.")).toBe("i should pull both stretches and test them")
  })
  it("keeps an in-progress fragment attached to the sentence before it when it is tiny", () => {
    expect(latestThought("Pulling the two stretches now. Then")).toBe("pulling the two stretches now. Then")
  })
  it("trims a long sentence from the front, keeping whole words", () => {
    const long = "This is a very long piece of reasoning that goes on and on about the two stretches of data and how they compare across the split point in August"
    const out = latestThought(long, 40)
    expect(out.length).toBeLessThanOrEqual(42)
    expect(out.startsWith("…")).toBe(true)
    expect(out.endsWith("August")).toBe(true)
  })
  it("is empty for whitespace", () => {
    expect(latestThought("   \n ")).toBe("")
  })
})
