import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { lintSentence } from "./insight-lint"

// The cards are the reason this app exists, and they are the only sentences in
// it that nobody wrote. `lintSentence` is the rule; this file proves the rule
// catches what shipped, leaves good writing alone, and then holds the engine's
// own literals to it.

const engine = readFileSync("src/lib/correlations.ts", "utf8")

/** Source with comments stripped — a comment may quote a bug, code may not. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

describe("the lint catches what actually shipped", () => {
  // Every one of these is a real render from the working tree at the time this
  // file was written. If a rule stops firing on its example, the rule broke.
  const SHIPPED = [
    ["the sleep-panel gate",
      "After some caffeine after 16:00 the night scores 62.9; after all of it before 16:00, 73.9"],
    ["a stacked pair of prepositions",
      "After 150mg+ of caffeine the night scores 68.2; after under 150mg, 72.4"],
    ["the symptom card's negative branch",
      "The day after drinking don't bring more headache — 2.4/5 vs 0.6/5"],
    ["the symptom card's positive branch",
      "Headache runs at 2.4/5 150mg+ caffeine days, vs 0.6/5 otherwise"],
    ["an editorialised null result",
      "Interestingly, high caffeine days (150mg+) don't hurt your sleep — avg score 72 vs 71"],
    ["a verdict about travel",
      "You sleep fine away from home — score 71 vs 69 in your own bed"],
    ["the place footnote",
      "Delta = visit-night average vs your all-days baseline. Simpler statistics than the patterns above — a confidence label from visit count, not a permutation test."],
    ["the weakness note",
      "Sample size isn't the problem here — 14 vs 16 days."],
    ["the confounded caveat",
      "Bedtime does not hold still across this comparison: after some caffeine after 16:00 you went to bed 147 minutes later on average. Some of this gap is that."],
  ] as const

  it.each(SHIPPED)("%s", (_label, sentence) => {
    expect(lintSentence(sentence).length,
      `this sentence shipped and the lint must catch it: "${sentence}"`)
      .toBeGreaterThan(0)
  })
})

describe("the lint leaves good writing alone", () => {
  // A lint that fires on sentences like these would be switched off within a
  // week, and it would deserve to be. Repetition across a comparison is not a
  // stumble; these all read aloud without one.
  const FINE = [
    "After 7h+ sleep, your morning energy averages 3.8 vs 3.1 on shorter nights",
    "After 7h+ sleep, your morning mood averages 3.8 vs 3.1 after shorter nights",
    "On high-stress days, your sleep score averages 68 vs 74 on calmer days",
    "On workout days, your sleep score averages 74 vs 70 on rest days",
    "Nights away from your own bed score 66 vs 73 at home",
    "You walk 9,120 steps on weekends vs 7,430 on weekdays",
    "Mood averages 4.1 on days at Kaviareň Vták, 3.6 on other days",
    "On nights after taking Magnesium, sleep score averages 74 vs 70 without it",
  ]

  it.each(FINE)("%s", sentence => {
    const problems = lintSentence(sentence)
    expect(problems.map(p => `${p.kind}: ${p.detail}`), sentence).toEqual([])
  })
})

describe("the rules are each load-bearing", () => {
  // Proving the rule that fires, rather than trusting that something did —
  // a lint whose examples all trip the same check is one rule wearing five
  // names, and the other four could be deleted without a test noticing.
  const kinds = (s: string) => lintSentence(s).map(p => p.kind)

  it("adjacent prepositions", () => {
    expect(kinds("after under 150mg, 72.4")).toContain("adjacent prepositions")
  })

  it("a preposition repeated inside one clause", () => {
    expect(kinds("After some caffeine after 16:00 the night scores 62.9"))
      .toContain("preposition repeated in one clause")
  })

  it("a phrase used as a plural subject", () => {
    expect(kinds("The day after drinking don't bring more headache"))
      .toContain("subject does not agree with its verb")
  })

  it("two numbers with nothing between them", () => {
    expect(kinds("Headache runs at 2.4/5 150mg+ caffeine days"))
      .toContain("two numbers with nothing between them")
  })

  it("a verdict", () => {
    expect(kinds("Interestingly, caffeine doesn't hurt your sleep")).toContain("verdict")
  })

  it("statistics on screen", () => {
    expect(kinds("a confidence label from visit count, not a permutation test"))
      .toContain("statistics on screen")
  })

  it("a sentence nobody finishes", () => {
    expect(kinds(
      "The morning after alcohol, a late meal and heavy screen time together, your sleep score " +
      "averaged 68 vs 76.4 after any other day — a bigger swing than alcohol alone",
    )).toContain("sentence too long")
  })
})

describe("the engine's own words", () => {
  it("never editorialises a finding", () => {
    // The rule `quick-answer-run.ts` has had all along, finally applied to the
    // layer that generates the most sentences in the app.
    expect(strip(engine)).not.toMatch(/\bInterestingly,/)
    expect(strip(engine)).not.toMatch(/isn't buying|cost you|You've barely|You sleep fine/)
  })

  it("keeps the engine's method out of the card", () => {
    const visible = strip(engine)
    for (const term of ["the matched window", "top third"]) {
      expect(visible, `"${term}" is method, not a finding`).not.toContain(term)
    }
  })
})
