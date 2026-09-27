import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The floating Emergy on desktop was a second chat client that had fallen
// behind the chat page on every count:
//
//   · it opened on GET /api/chat with no conversation, which returned the
//     OLDEST hundred rows the account ever saved — months-old chats instead
//     of today's thread;
//   · it POSTed only the new message: no history and no conversationId, so
//     "and the night before?" reached the model with nothing before it, and
//     every message started another one-line "New chat";
//   · it appended every event carrying a `text` field, so the model's
//     reasoning ("The user wants their sleep. Let me check…") landed in the
//     bubble and was read aloud;
//   · it split each network chunk on its own, so an event cut across two
//     chunks was dropped, and a failed request left the bubble on "…".

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

describe("the desktop Emergy panel", () => {
  const panel = strip("src/components/emergy/EmergyPanel.tsx")

  it("opens on today's thread, not on an unscoped transcript", () => {
    expect(panel).not.toMatch(/fetch\(\s*"\/api\/chat"\s*\)/)
    expect(panel).toMatch(/\/api\/chat\/conversations/)
    expect(panel).toMatch(/todaysThread\(/)
    expect(panel).toMatch(/\/api\/chat\?conversation=/)
  })

  it("sends the conversation and its history with every message", () => {
    const at = panel.indexOf('fetch("/api/chat", {')
    expect(at).toBeGreaterThan(-1)
    const post = panel.slice(at, at + 600)
    expect(post).toMatch(/\bhistory\b/)
    expect(post).toMatch(/\bconversationId\b/)
  })

  it("adopts the conversation the server filed the turn under", () => {
    expect(panel).toMatch(/parsed\.conversationId/)
    expect(panel).toMatch(/setConversationId\(/)
  })

  it("only the reply's own text reaches the bubble — never thinking or tool events", () => {
    expect(panel).toMatch(/parsed\.type === "text"/)
    expect(panel).not.toMatch(/if \(parsed\.text\)/)
  })

  it("keeps a partial line for the next chunk instead of dropping it", () => {
    expect(panel).toMatch(/buffer \+= decoder\.decode/)
    expect(panel).toMatch(/buffer = lines\.pop\(\)/)
  })

  it("a failed request says so instead of leaving the bubble on '…'", () => {
    expect(panel).toMatch(/!res\.ok/)
  })
})

describe("GET /api/chat returns the newest rows, not the oldest", () => {
  const route = strip("src/app/api/chat/route.ts")
  const get = route.slice(route.indexOf("export async function GET"))

  it("takes from the newest end and hands them back in reading order", () => {
    // Ascending with a take kept the FIRST N rows: a thread over 200
    // messages opened on its beginning and hid everything said since.
    expect(get).toMatch(/orderBy: \{ createdAt: "desc" \}/)
    expect(get).toMatch(/\.reverse\(\)/)
  })
})
