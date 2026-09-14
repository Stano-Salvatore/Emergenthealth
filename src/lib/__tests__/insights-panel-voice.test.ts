import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The Patterns panel on the dashboard, held to the rules its neighbours
// already follow.
//
// Both faults here were invisible to every unit test and obvious the moment
// the page was rendered on a phone:
//
//   · the "by location" block belongs to two of the three stacked periods, so
//     an account with no places printed the SAME "import your Timeline"
//     sentence twice, a few rows apart. Repetition reads as a rendering fault,
//     not as a prompt.
//
//   · it labelled the visit count `n=6`, while the place cards one screen over
//     say "6 nights" for the same number on the same data.

const panel = readFileSync("src/components/dashboard/InsightsPanel.tsx", "utf8")
/** A comment may name the notation it keeps out; the rendered code may not. */
const rendered = panel
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
  .replace(/^\s*\/\/.*$/gm, " ")

describe("it says the location prompt once", () => {
  it("only the widest window offers it when there is nothing to show", () => {
    // Two periods carry location; the prompt is about the account rather than
    // the window, so exactly one of them may ask.
    expect(rendered).toContain('locWithData.length > 0 || period === "overall"')
  })

  it("but a period with real places still shows its own", () => {
    // The guard must not turn into "location only on overall" — the numbers
    // genuinely differ per window, and that is the point of stacking them.
    expect(rendered, "month must keep its location rows when it has any")
      .toMatch(/period === "month" \|\| period === "overall"/)
  })

  it("the sentence itself exists exactly once in the file", () => {
    const prompt = [...panel.matchAll(/Import your Google Timeline/g)]
    expect(prompt, "two copies of a prompt drift apart, then contradict")
      .toHaveLength(1)
  })
})

describe("it counts in the same words as the rest of the app", () => {
  it("says nights, not n=", () => {
    expect(rendered, '"n=6" is notation; the place cards say "6 nights" for this number')
      .not.toContain("n={loc.n}")
    expect(rendered).toContain("night{loc.n === 1 ? \"\" : \"s\"}")
  })

  it("matches the place cards' vocabulary", () => {
    // Same quantity, same source, two screens — one word for it.
    const places = readFileSync("src/components/location/PlaceCorrelations.tsx", "utf8")
    expect(places).toMatch(/night\$\{result\.n === 1 \? "" : "s"\}|\{n\} nights/)
  })

  it("keeps the method off the screen, like every other pattern surface", () => {
    for (const term of ["permutation", "p-value", "p <", "significan", "Sample size", "(n="]) {
      expect(rendered, `"${term}" is method, not a finding`).not.toContain(term)
    }
  })
})
