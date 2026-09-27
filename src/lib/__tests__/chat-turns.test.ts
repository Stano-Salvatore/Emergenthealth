import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stampTurnGaps, trimToUserTurn } from "@/lib/chat-turns"

const u = (content: string) => ({ role: "user" as const, content })
const a = (content: string) => ({ role: "assistant" as const, content })

describe("trimToUserTurn", () => {
  it("leaves a window that already starts with the user alone", () => {
    const h = [u("hi"), a("hello"), u("how's my sleep")]
    expect(trimToUserTurn(h)).toEqual(h)
  })
  it("drops leading assistant turns so the API never sees one first", () => {
    expect(trimToUserTurn([a("…"), a("…"), u("q"), a("a")])).toEqual([u("q"), a("a")])
  })
  it("is empty when there is no user turn at all", () => {
    expect(trimToUserTurn([a("only me")])).toEqual([])
    expect(trimToUserTurn([])).toEqual([])
  })
})

// A conversation left open overnight reached the model as one sitting: no
// turn carried a time, so yesterday's pending question read as current and a
// true "I had coffee at midnight" was "corrected" against this afternoon.
describe("stampTurnGaps", () => {
  const TZ = "Europe/Bratislava"
  const at = (iso: string) => iso
  const now = new Date("2026-09-27T11:44:00Z") // Sun 13:44 in Bratislava

  it("marks a user turn that follows a long silence, and the current message", () => {
    const { history, current } = stampTurnGaps([
      { role: "user", content: "had a coffee just now", at: at("2026-09-25T22:23:00Z") },
      { role: "assistant", content: "Logged.", at: at("2026-09-25T22:23:30Z") },
      { role: "user", content: "morning — slept badly", at: at("2026-09-26T06:10:00Z") },
      { role: "assistant", content: "Sorry to hear.", at: at("2026-09-26T06:10:20Z") },
    ], now, TZ)
    // The first turn is from another day than today, so it is dated too.
    expect(history[0].content).toMatch(/^\[Sat 26 Sept?, 00:23\]/)
    expect(history[2].content).toMatch(/^\[Sat 26 Sept?, 08:10\]/)
    // Assistant turns are never stamped: he would learn to write the stamps.
    expect(history[1].content).toBe("Logged.")
    expect(current).toMatch(/^\[now Sun 27 Sept?, 13:44 — 30h since the last message\] /)
  })

  it("leaves a conversation happening in one sitting untouched", () => {
    const { history, current } = stampTurnGaps([
      { role: "user", content: "q", at: at("2026-09-27T11:30:00Z") },
      { role: "assistant", content: "a", at: at("2026-09-27T11:30:10Z") },
    ], now, TZ)
    expect(history.map(h => h.content)).toEqual(["q", "a"])
    expect(current).toBe("")
  })

  it("says minutes, not 0h, when the day changed a moment ago", () => {
    // 23:55 → 00:05 Bratislava: a new day, ten minutes on.
    const { current } = stampTurnGaps([
      { role: "user", content: "q", at: at("2026-09-26T21:55:00Z") },
    ], new Date("2026-09-26T22:05:00Z"), TZ)
    expect(current).toMatch(/— 10m since the last message\] $/)
  })

  it("stamps nothing it has no time for", () => {
    const { history, current } = stampTurnGaps([u("q"), a("a")], now, TZ)
    expect(history).toEqual([u("q"), a("a")])
    expect(current).toBe("")
  })
})

describe("the stamps reach the model", () => {
  const code = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
  it("streamChatEvents stamps the history it sends", () => {
    expect(code("src/lib/claude.ts")).toMatch(/stampTurnGaps\(trimToUserTurn\(messageHistory/)
  })
  it("the chat screen and Telegram send each turn's time", () => {
    expect(code("src/app/dashboard/chat/page.tsx")).toMatch(/at: m\.createdAt/)
    expect(code("src/app/api/telegram/webhook/route.ts")).toMatch(/at: m\.createdAt/)
  })
})
