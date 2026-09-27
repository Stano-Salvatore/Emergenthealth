import { describe, it, expect } from "vitest"
import { todaysThread, replyLanded, freshConversation, type TurnToFind } from "@/lib/chat-thread"

// The chat screen and the desktop Emergy panel both have to answer two
// questions from the stored transcript rather than from what they happen to
// be holding on screen:
//
//   · which thread do I open on? (today's, if there is one — never the oldest
//     rows the account ever saved, which is what the desktop panel showed)
//   · has the reply to the turn I lost track of landed yet? (a pocketed phone
//     drops the stream while the server finishes the turn — the screen must
//     pick up THAT reply, not an older one that happens to sit last)

const turn = (over: Partial<TurnToFind> = {}): TurnToFind => ({
  userRowId: null, text: "log the goulash, 650 kcal", seenBefore: 0, newThread: false, ...over,
})

describe("todaysThread", () => {
  const now = new Date(2026, 8, 27, 14, 0)

  it("resumes the newest conversation when it was active today", () => {
    expect(todaysThread([
      { id: "c2", updatedAt: new Date(2026, 8, 27, 8, 30).toISOString() },
      { id: "c1", updatedAt: new Date(2026, 8, 20).toISOString() },
    ], now)).toBe("c2")
  })
  it("starts blank when the newest thread is from another day", () => {
    expect(todaysThread([{ id: "c1", updatedAt: new Date(2026, 8, 26, 23, 50).toISOString() }], now)).toBeNull()
  })
  it("never resumes the pre-conversation 'legacy' bucket, which cannot be appended to", () => {
    expect(todaysThread([{ id: "legacy", updatedAt: now.toISOString() }], now)).toBeNull()
  })
  it("starts blank with no history at all", () => {
    expect(todaysThread([], now)).toBeNull()
  })
})

describe("replyLanded", () => {
  it("anchored on this turn's own user row, an assistant row after it is the reply", () => {
    const rows = [
      { id: "u1", role: "user" as const, content: "hi" },
      { id: "a1", role: "assistant" as const, content: "hello" },
      { id: "u2", role: "user" as const, content: "log the goulash, 650 kcal" },
      { id: "a2", role: "assistant" as const, content: "Logged." },
    ]
    expect(replyLanded(rows, turn({ userRowId: "u2" }))).toBe(true)
  })

  it("an earlier answer sitting last does not count while this turn's reply is still being written", () => {
    // The server has stored the user row but is still running the tools.
    const rows = [
      { id: "u1", role: "user" as const, content: "hi" },
      { id: "a1", role: "assistant" as const, content: "hello" },
      { id: "u2", role: "user" as const, content: "log the goulash, 650 kcal" },
    ]
    expect(replyLanded(rows, turn({ userRowId: "u2" }))).toBe(false)
  })

  it("a retry of the same words is not answered by the previous attempt's reply", () => {
    // The retry's user row has not been written yet; the only matching row is
    // the first attempt, already answered. The old poll ("is the last row an
    // assistant?") took that as the new reply.
    const rows = [
      { id: "u1", role: "user" as const, content: "log the goulash, 650 kcal" },
      { id: "a1", role: "assistant" as const, content: "Logged." },
    ]
    expect(replyLanded(rows, turn({ seenBefore: 1 }))).toBe(false)
    expect(replyLanded([...rows,
      { id: "u2", role: "user" as const, content: "log the goulash, 650 kcal" },
      { id: "a2", role: "assistant" as const, content: "Logged again." },
    ], turn({ seenBefore: 1 }))).toBe(true)
  })

  it("an anchor that is not in the transcript is not an answer", () => {
    expect(replyLanded([{ id: "a0", role: "assistant", content: "x" }], turn({ userRowId: "u9" }))).toBe(false)
  })

  it("a turn that started its own thread must be the thread's first message", () => {
    const other = [
      { id: "u1", role: "user" as const, content: "morning" },
      { id: "u2", role: "user" as const, content: "log the goulash, 650 kcal" },
      { id: "a2", role: "assistant" as const, content: "Logged." },
    ]
    expect(replyLanded(other, turn({ newThread: true }))).toBe(false)
    expect(replyLanded(other.slice(1), turn({ newThread: true }))).toBe(true)
  })
})

describe("freshConversation", () => {
  const started = Date.parse("2026-09-27T12:00:00Z")

  it("picks the newest conversation touched since the turn began", () => {
    expect(freshConversation([
      { id: "new", updatedAt: "2026-09-27T12:00:03Z" },
      { id: "old", updatedAt: "2026-09-27T09:00:00Z" },
    ], started)).toBe("new")
  })
  it("tolerates a phone clock a little ahead of the server's", () => {
    expect(freshConversation([{ id: "new", updatedAt: "2026-09-27T11:58:30Z" }], started)).toBe("new")
  })
  it("does not adopt a thread that has been idle since long before the turn", () => {
    expect(freshConversation([{ id: "old", updatedAt: "2026-09-27T09:00:00Z" }], started)).toBeNull()
  })
  it("never adopts the legacy bucket", () => {
    expect(freshConversation([{ id: "legacy", updatedAt: "2026-09-27T12:00:03Z" }], started)).toBeNull()
  })
})
