import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { toolActivity } from "@/lib/chat-sources"

// While a tool runs, Emergy says what he is doing. Twelve of forty-one tools
// had no phrase and fell through to "having a look" — among them
// `log_lab_results`, which is the slowest and heaviest thing in the app: it
// reads digits off a photographed printout and reads them back before
// recording anything. That is the wait most in need of a sentence, and it got
// the one that says nothing.
//
// Nobody let that happen; it accreted. Every tool added over a year was one
// more silent fallback, and nothing failed. Hence a test rather than a
// resolution to remember.

const claude = readFileSync("src/lib/claude.ts", "utf8")
const TOOLS = [...new Set(
  [...claude.matchAll(/^\s*name: "([a-z_0-9]+)"/gm)].map(m => m[1]),
)]

describe("every tool says what it is doing", () => {
  it("finds the tool definitions at all", () => {
    // If the shape of the definitions changes this test would pass vacuously,
    // which is the failure mode of every grep-based guard.
    expect(TOOLS.length, "no tools parsed out of claude.ts — this guard is checking nothing")
      .toBeGreaterThan(30)
    expect(TOOLS).toContain("log_lab_results")
  })

  it("none of them falls back to the neutral phrase", () => {
    const silent = TOOLS.filter(t => toolActivity(t) === "having a look")
    expect(silent, `${silent.length} tool(s) have no wait phrase: ${silent.join(", ")}`)
      .toEqual([])
  })

  it("keeps the fallback for a name that is not a tool", () => {
    // It still has a job: never leak a function name onto the screen.
    expect(toolActivity("some_tool_added_after_this_test")).toBe("having a look")
  })
})

describe("and says it in the same voice", () => {
  it("reads as something in progress", () => {
    // "logging your water", not "Log water" — it completes the sentence
    // "Emergy is …".
    for (const t of TOOLS) {
      expect(toolActivity(t), `"${toolActivity(t)}" (${t}) should read as "Emergy is …"`)
        .toMatch(/^[a-z]+ing\b/)
    }
  })

  it("never leaks the function name", () => {
    for (const t of TOOLS) {
      expect(toolActivity(t), `${t} leaks its own name`).not.toContain("_")
    }
  })
})
