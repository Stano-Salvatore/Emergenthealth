import { describe, it, expect } from "vitest"
import { rankRecallHits, recallTerms, trimForRecall } from "@/lib/chat-recall"

describe("recallTerms", () => {
  it("keeps the words that identify a conversation and drops the rest", () => {
    expect(recallTerms("hey do you remember me talking about a church tower and beautiful night after meeting Sofia"))
      .toEqual(["church", "tower", "beautiful", "night", "meeting", "sofia"])
  })

  it("keeps accented words whole", () => {
    // Splitting on [^a-z0-9] would cut this into "kaviare" and "vt", and
    // "Blumentál" is exactly the distinctive word in the sentence.
    expect(recallTerms("Kaviareň Vták and the Blumentál church"))
      .toEqual(["kaviareň", "vták", "blumentál", "church"])
  })

  it("has nothing to search for in a question made entirely of filler", () => {
    expect(recallTerms("do you remember what we talked about")).toEqual([])
  })

  it("does not search the same word twice", () => {
    expect(recallTerms("church church tower")).toEqual(["church", "tower"])
  })

  it("stops at six terms", () => {
    expect(recallTerms("alpha bravo charlie delta echo foxtrot golf hotel")).toHaveLength(6)
  })

  it("drops the shortest words when over the limit, not the last ones", () => {
    // A name at the end of a long question is the most identifying word in it,
    // and taking the first six would throw it away to keep a filler word.
    const terms = recallTerms("walking around downtown yesterday evening near riverside with Sofia")
    expect(terms).toContain("sofia")
    expect(terms).toHaveLength(6)
  })
})

describe("rankRecallHits", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 7, day))
  const hit = (day: number, content: string) => ({ createdAt: at(day), content })

  it("prefers the message that matches more of the query, not the newest one", () => {
    const hits = [
      hit(25, "the church tower with Sofia, that night"),
      hit(28, "walked past a church"),
    ]
    const ranked = rankRecallHits(hits, ["church", "tower", "sofia"], 1)
    expect(ranked[0].content).toContain("tower")
  })

  it("breaks a tie on how recent it is", () => {
    const ranked = rankRecallHits(
      [hit(20, "a church"), hit(27, "a church")],
      ["church"],
      1,
    )
    expect(ranked[0].createdAt).toEqual(at(27))
  })

  it("returns what it kept in the order it happened", () => {
    // Chosen by score, read as a story: an exchange out of order is harder to
    // follow than a slightly weaker opening line.
    const ranked = rankRecallHits(
      [hit(28, "church tower"), hit(20, "church tower Sofia"), hit(24, "church")],
      ["church", "tower", "sofia"],
      3,
    )
    expect(ranked.map(h => h.createdAt)).toEqual([at(20), at(24), at(28)])
  })

  it("honours the cap", () => {
    const hits = Array.from({ length: 20 }, (_, i) => hit(i + 1, "church"))
    expect(rankRecallHits(hits, ["church"], 6)).toHaveLength(6)
  })
})

describe("trimForRecall", () => {
  it("flattens the newlines a stored reply is full of", () => {
    expect(trimForRecall("one\n\ntwo   three")).toBe("one two three")
  })

  it("cuts a long message rather than quoting the whole thing back", () => {
    const out = trimForRecall("x".repeat(500))
    expect(out).toHaveLength(321)
    expect(out.endsWith("…")).toBe(true)
  })
})
