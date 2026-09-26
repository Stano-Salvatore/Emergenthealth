import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// "log gulas diviaci" — Emergy said "Logged 🍲", counted it into the day's
// calories, and the row never existed: the create's .catch(() => null)
// swallowed the failure and the success line ran anyway (26 Sept, live).
// A write the user is told about has to be a write that happened. Every
// chat tool that stores something must check its own write and say
// "didn't write — worth retrying" when it didn't, and the error must reach
// the server log so the next vanished meal has a cause attached.
//
// The read in `remember`/`forget` is held to the same bar for a worse
// reason: a failed read parsed as "no facts yet" makes the following
// upsert replace the whole memory list with one fact.

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

const src = strip("src/lib/claude.ts")

// A handler's text runs from its `if (name === "...")` to the next one.
const handler = (tool: string) => {
  const open = src.indexOf(`if (name === "${tool}")`)
  expect(open, `handler for ${tool} not found`).toBeGreaterThan(-1)
  const next = src.indexOf(`if (name === "`, open + 1)
  return src.slice(open, next === -1 ? undefined : next)
}

const WRITERS = [
  "log_food",
  "log_mood",
  "log_weight",
  "log_tag",
  "write_daily_note",
  "log_morning_checkin",
  "remember",
  "forget",
]

describe("chat writes tell the truth", () => {
  for (const tool of WRITERS) {
    it(`${tool} never swallows a failed write and still claims success`, () => {
      expect(handler(tool)).not.toContain(".catch(() => null)")
    })
    it(`${tool} owns up when the write did not land`, () => {
      expect(handler(tool)).toMatch(/[Ww]orth retrying/)
    })
  }

  it("a failed write reaches the server log with a cause", () => {
    expect(src).toMatch(/console\.error\(`\[chat-tools\] \$\{what\} write failed/)
  })

  it("a failed memory read aborts instead of impersonating an empty list", () => {
    expect(handler("remember")).toMatch(/memory read failed/)
    expect(handler("forget")).toMatch(/memory read failed/)
  })
})
