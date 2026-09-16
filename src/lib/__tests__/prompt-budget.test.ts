import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// Every turn pays for the whole prefix before Emergy says a word: the 41 tool
// schemas, then the system prompt. The schemas ARE the inventory — a sentence
// in the prompt saying the same tool exists is bought twice, every turn, and
// the paragraph that did it was 1,574 tokens, 42% of the entire prompt.
//
// What the prompt is still for is the policy no single schema can hold: which
// tool to reach for when two could apply, what to do with a photo, how sure to
// sound on four nights of data. That is why this is a rule about tool NAMES
// rather than a length limit — the prompt may say why, it may not re-list what.

const src = readFileSync("src/lib/claude.ts", "utf8")

/** The tool names, read off the definitions rather than kept in a second list. */
const TOOL_NAMES = [...new Set([...src.matchAll(/^    name: "([a-z_]+)",$/gm)].map(m => m[1]))]

/** The prompt template, from `const prompt = \`` to its closing backtick. */
function promptTemplate(): string {
  const at = src.indexOf("const prompt = `")
  expect(at, "the prompt template moved").toBeGreaterThan(0)
  const from = src.indexOf("`", at) + 1
  for (let i = from; i < src.length; i++) {
    if (src[i] === "\\") { i++; continue }
    if (src[i] === "`") return src.slice(from, i)
  }
  throw new Error("unterminated prompt template")
}

/**
 * The tools the prompt is allowed to name, each because it carries a rule that
 * spans more than one tool and so has nowhere else to live:
 *
 *   log_tag          — the days a tag belongs on, and why the engine needs them
 *   compare_periods  — the question whose answer those days are
 *   get_health_range — read the numbers before answering "why"
 *   log_lab_results  — what to do with a photo of a printout
 *   create_med_schedule — what to do with a photo of a box
 *   remember         — anchor dates, recorded in the same turn they are told
 */
const MAY_BE_NAMED = new Set([
  "log_tag", "compare_periods", "get_health_range",
  "log_lab_results", "create_med_schedule", "remember",
])

describe("the system prompt does not buy the tool list twice", () => {
  it("names only the tools it has cross-tool policy for", () => {
    const template = promptTemplate()
    const named = TOOL_NAMES.filter(n => template.includes(n))
    const extra = named.filter(n => !MAY_BE_NAMED.has(n))
    expect(extra, "these tools are described in their own schema already").toEqual([])
  })

  it("has no inventory sentence to grow back into", () => {
    expect(promptTemplate()).not.toMatch(/You have tools to/)
  })

  it("still carries the policy that has nowhere else to live", () => {
    const template = promptTemplate()
    for (const rule of [
      "not on today",              // which days a tag belongs on
      "only a few nights",         // confidence matched to the evidence
      "Health report",             // the printable page, not a tool
      "Patterns → Experiments",    // where an association becomes evidence
      "blurry number",             // what to say about a photo you cannot read
    ]) expect(template, rule).toContain(rule)
  })
})
