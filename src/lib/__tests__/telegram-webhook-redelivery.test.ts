import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// Telegram redelivers any update it did not get a 2xx for. The webhook ran
// the whole Emergy turn — model calls and write tools — before answering,
// inside a 60-second budget. "Log 2 beers and 500 ml water, then tell me how
// this month compared to last" logged the drinks, ran past 60 s, was killed
// with a 504, and Telegram sent the same message again: the beers and water
// logged twice, and again on every retry, with no reply ever arriving.

const src = readFileSync("src/app/api/telegram/webhook/route.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

describe("the Telegram webhook", () => {
  it("answers Telegram before the turn runs, and runs the turn in after()", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*"next\/server"/)
    const afterAt = src.search(/\bafter\(\s*async/)
    const turnAt = src.indexOf("streamChatResponse(")
    expect(afterAt, "no after(async …) found").toBeGreaterThan(-1)
    expect(turnAt, "the model turn is not inside after()").toBeGreaterThan(afterAt)
  })

  it("gives the turn as long as the chat route gets, at least", () => {
    const m = /export const maxDuration = (\d+)/.exec(src)
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(120)
  })

  it("claims each update_id once, so a redelivered update is not run again", () => {
    expect(src).toMatch(/update_id/)
    expect(src).toMatch(/telegram_update:\$\{updateId\}/)
    expect(src).toMatch(/ON CONFLICT \("userId", "key"\) DO NOTHING/)
  })

  it("claims ids one by one, not as a high-water mark that drops out-of-order updates", () => {
    // Telegram delivers over parallel connections; three forwarded messages
    // can arrive 102, 101, 103. A "larger than the last one" claim would
    // silently drop 101.
    expect(src).not.toMatch(/telegram_last_update/)
    expect(src).not.toMatch(/::bigint\s*<\s*EXCLUDED/)
  })
})
