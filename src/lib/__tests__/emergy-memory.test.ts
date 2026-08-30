import { describe, it, expect } from "vitest"
import {
  addFact, forgetFact, MAX_FACTS, parseFacts, renderFacts, serialiseFacts, type MemoryFact,
} from "@/lib/emergy-memory"

const f = (fact: string, at: string | null = "2026-08-30"): MemoryFact => ({ fact, at })

describe("parseFacts", () => {
  it("reads the bare string array facts used to be stored as", () => {
    // These rows still exist. A migration that dropped them would delete
    // everything Emergy knew to add a date field to it.
    expect(parseFacts('["hates mornings","trains for a marathon"]')).toEqual([
      { fact: "hates mornings", at: null },
      { fact: "trains for a marathon", at: null },
    ])
  })

  it("reads dated facts", () => {
    expect(parseFacts('[{"fact":"hates mornings","at":"2026-03-01"}]'))
      .toEqual([{ fact: "hates mornings", at: "2026-03-01" }])
  })

  it("survives a mixed array, junk entries and a corrupt row", () => {
    expect(parseFacts('["old",{"fact":"new","at":"2026-01-01"},null,42,{"at":"x"},{"fact":"  "}]'))
      .toEqual([{ fact: "old", at: null }, { fact: "new", at: "2026-01-01" }])
    expect(parseFacts("not json at all")).toEqual([])
    expect(parseFacts('{"fact":"not an array"}')).toEqual([])
    expect(parseFacts(null)).toEqual([])
  })

  it("round-trips", () => {
    const facts = [f("hates mornings", "2026-03-01"), f("no dairy", null)]
    expect(parseFacts(serialiseFacts(facts))).toEqual(facts)
  })
})

describe("addFact", () => {
  it("keeps a genuinely new fact", () => {
    const out = addFact([f("hates mornings")], "allergic to penicillin", "2026-08-30")
    expect(out).toHaveLength(2)
  })

  it("replaces the same fact said differently instead of storing it twice", () => {
    // Differs by a pronoun and a tense; it is one fact, and storing both spends
    // two of fifty slots to say one thing.
    const out = addFact([f("I hate mornings", "2026-01-01")], "hates mornings", "2026-08-30")
    expect(out).toEqual([{ fact: "hates mornings", at: "2026-08-30" }])
  })

  it("treats a fact restated with extra detail as the same fact, and keeps the newer wording", () => {
    const out = addFact(
      [f("hates mornings", "2026-01-01")],
      "hates mornings, especially in winter",
      "2026-08-30",
    )
    expect(out).toEqual([{ fact: "hates mornings, especially in winter", at: "2026-08-30" }])
  })

  it("does not conflate two facts that differ only in a number", () => {
    // The number is the whole content of a fact about a dose or an hour.
    const out = addFact([f("takes 5 mg of atarax")], "takes 25 mg of atarax", "2026-08-30")
    expect(out).toHaveLength(2)
  })

  it("does not conflate two different facts that share a word", () => {
    const out = addFact([f("trains for a marathon")], "hates running in the rain", "2026-08-30")
    expect(out).toHaveLength(2)
  })

  it("ignores an empty fact", () => {
    const before = [f("hates mornings")]
    expect(addFact(before, "   ", "2026-08-30")).toBe(before)
  })

  it("drops the oldest once full", () => {
    let facts: MemoryFact[] = []
    // Genuinely unrelated facts: sharing content words would make them one
    // fact, which is the behaviour the tests above pin down.
    const words = "apple bridge cactus dolphin ember fossil granite harbour ivory jasmine kettle lantern marble nectar opal pewter quartz ribbon saffron tundra umber violet walnut xenon yarrow zephyr".split(" ")
    for (let i = 0; i < MAX_FACTS + 5; i++) {
      facts = addFact(facts, `${words[i % words.length]}${i} likes ${words[(i * 7) % words.length]}${i}`, "2026-08-30")
    }
    expect(facts).toHaveLength(MAX_FACTS)
    // The first five have fallen off the front.
    expect(facts[0].fact).toMatch(/^fossil5 /)
  })

  it("truncates something too long to be a fact", () => {
    const [only] = addFact([], "x".repeat(400), "2026-08-30")
    expect(only.fact).toHaveLength(280)
  })
})

describe("forgetFact", () => {
  const facts = [
    f("trains for a marathon in October", "2026-01-01"),
    f("allergic to penicillin", "2026-02-01"),
    f("hates mornings", "2026-03-01"),
  ]

  it("removes the one meant, without needing the exact wording", () => {
    const out = forgetFact(facts, "the marathon training")
    expect(out.removed?.fact).toBe("trains for a marathon in October")
    expect(out.facts).toHaveLength(2)
  })

  it("removes nothing when nothing matches", () => {
    const out = forgetFact(facts, "plays the trombone")
    expect(out.removed).toBeNull()
    expect(out.facts).toBe(facts)
  })

  it("refuses to guess between equally good matches", () => {
    // Deleting the wrong memory is worse than deleting none: nobody finds out
    // until he says something odd weeks later, cause invisible.
    const twins = [f("drinks coffee at work"), f("drinks coffee at home")]
    const out = forgetFact(twins, "drinks coffee")
    expect(out.removed).toBeNull()
    expect(out.facts).toEqual(twins)
    expect(out.ambiguous).toHaveLength(2)
  })

  it("has nothing to go on when the query is all filler", () => {
    const out = forgetFact(facts, "that thing about the you")
    expect(out.removed).toBeNull()
  })
})

describe("renderFacts", () => {
  it("dates what it can and does not invent a date for what it cannot", () => {
    expect(renderFacts([f("hates mornings", "2026-03-01"), f("no dairy", null)]))
      .toBe("- hates mornings (told me 2026-03-01)\n- no dairy")
  })
})
